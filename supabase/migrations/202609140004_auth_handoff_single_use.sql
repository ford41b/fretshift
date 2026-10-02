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
  delete from public.auth_handoffs
  where id = p_id
    and secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
    and completed_at is not null
    and expires_at > timezone('utc', now())
  returning refresh_token into token;
  return token;
end
$$;

revoke all on function public.claim_auth_handoff(uuid,text) from public;
grant execute on function public.claim_auth_handoff(uuid,text) to anon, authenticated;
