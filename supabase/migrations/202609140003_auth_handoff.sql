create table if not exists public.auth_handoffs (
  id uuid primary key,
  secret_hash text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  refresh_token text,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  expires_at timestamptz not null default timezone('utc', now()) + interval '10 minutes'
);

alter table public.auth_handoffs enable row level security;
revoke all on public.auth_handoffs from public, anon, authenticated;

create or replace function public.create_auth_handoff(p_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_secret is null or length(p_secret) < 32 then
    raise exception 'invalid handoff secret';
  end if;
  delete from public.auth_handoffs where expires_at <= timezone('utc', now());
  insert into public.auth_handoffs(id, secret_hash, expires_at)
  values (
    p_id,
    encode(extensions.digest(p_secret, 'sha256'), 'hex'),
    timezone('utc', now()) + interval '10 minutes'
  );
end
$$;

create or replace function public.complete_auth_handoff(
  p_id uuid,
  p_refresh_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_refresh_token is null or length(p_refresh_token) < 20 then
    raise exception 'invalid refresh token';
  end if;
  update public.auth_handoffs
  set owner_id = auth.uid(),
      refresh_token = p_refresh_token,
      completed_at = timezone('utc', now())
  where id = p_id
    and expires_at > timezone('utc', now());
  if not found then
    raise exception 'handoff expired or missing';
  end if;
end
$$;

create or replace function public.claim_auth_handoff(
  p_id uuid,
  p_secret text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare token text;
begin
  delete from public.auth_handoffs where expires_at <= timezone('utc', now());
  select refresh_token into token
  from public.auth_handoffs
  where id = p_id
    and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    and completed_at is not null
    and expires_at > timezone('utc', now());
  return token;
end
$$;

revoke all on function public.create_auth_handoff(uuid,text) from public;
revoke all on function public.complete_auth_handoff(uuid,text) from public;
revoke all on function public.claim_auth_handoff(uuid,text) from public;
grant execute on function public.create_auth_handoff(uuid,text) to anon, authenticated;
grant execute on function public.complete_auth_handoff(uuid,text) to authenticated;
grant execute on function public.claim_auth_handoff(uuid,text) to anon, authenticated;
