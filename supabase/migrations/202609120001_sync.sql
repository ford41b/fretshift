create extension if not exists pgcrypto;
-- Owner-scoped opaque application records. Payload is intentionally flexible so
-- schema migrations remain client-owned and invalid data can be quarantined.
create table if not exists public.sync_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('song','setlist','tuning','preference','session','heat','pair','strum')),
  record_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  revision bigint not null default 1,
  primary key (owner_id, kind, record_id)
);
alter table public.sync_records enable row level security;
create policy "owner reads own sync records" on public.sync_records for select using (auth.uid() = owner_id);
drop policy if exists "owner inserts own sync records" on public.sync_records;
drop policy if exists "owner updates own sync records" on public.sync_records;
drop policy if exists "owner deletes own sync records" on public.sync_records;
grant select on public.sync_records to authenticated;
revoke insert, update, delete on public.sync_records from anon, authenticated;

create or replace function public.sync_record_timestamp() returns trigger language plpgsql as $$
begin new.updated_at = timezone('utc', now()); new.revision = old.revision + 1; return new; end $$;
drop trigger if exists sync_record_timestamp on public.sync_records;
create trigger sync_record_timestamp before update on public.sync_records for each row execute function public.sync_record_timestamp();

-- Atomic compare-and-swap. Returning the current row makes a concurrent edit a
-- deterministic conflict without trusting client timestamps.
create or replace function public.sync_cas(p_kind text, p_record_id text, p_payload jsonb, p_deleted_at timestamptz, p_expected_revision bigint)
returns table(ok boolean, kind text, record_id text, payload jsonb, updated_at timestamptz, deleted_at timestamptz, revision bigint)
language plpgsql security definer set search_path = public as $$
declare current_row public.sync_records%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_expected_revision is null then
    insert into public.sync_records(owner_id,kind,record_id,payload,deleted_at) values(auth.uid(),p_kind,p_record_id,p_payload,p_deleted_at)
    on conflict (owner_id,kind,record_id) do nothing returning * into current_row;
  else
    update public.sync_records r set payload=p_payload, deleted_at=p_deleted_at
    where r.owner_id=auth.uid() and r.kind=p_kind and r.record_id=p_record_id and r.revision=p_expected_revision returning r.* into current_row;
  end if;
  if found then return query select true,current_row.kind,current_row.record_id,current_row.payload,current_row.updated_at,current_row.deleted_at,current_row.revision; return; end if;
  return query select false,r.kind,r.record_id,r.payload,r.updated_at,r.deleted_at,r.revision from public.sync_records r where r.owner_id=auth.uid() and r.kind=p_kind and r.record_id=p_record_id;
end $$;
revoke all on function public.sync_cas(text,text,jsonb,timestamptz,bigint) from public, anon;
grant execute on function public.sync_cas(text,text,jsonb,timestamptz,bigint) to authenticated;

create table if not exists public.song_shares (
  token text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  song jsonb not null,
  tuning jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz
);
alter table public.song_shares enable row level security;
drop policy if exists "owner manages shares" on public.song_shares;
create policy "owner reads own shares" on public.song_shares for select using (auth.uid() = owner_id);
grant select on public.song_shares to authenticated;
revoke insert, update, delete on public.song_shares from anon, authenticated;

create or replace function public.create_song_share(p_song jsonb, p_tuning jsonb)
returns table(token text) language plpgsql security definer set search_path = public as $$
declare generated text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  generated := encode(gen_random_bytes(32), 'hex');
  insert into public.song_shares(token,owner_id,song,tuning) values(generated,auth.uid(),p_song - 'ownerId' - 'referenceAudio',p_tuning);
  return query select generated;
end $$;
create or replace function public.read_song_share(p_token text)
returns table(song jsonb, tuning jsonb) language sql security definer set search_path = public as $$
  select s.song - 'ownerId' - 'referenceAudio', s.tuning from public.song_shares s where s.token=p_token and s.revoked_at is null
$$;
create or replace function public.revoke_song_share(p_token text) returns void language sql security definer set search_path = public as $$
  update public.song_shares set revoked_at=timezone('utc',now()) where token=p_token and owner_id=auth.uid()
$$;
revoke all on function public.create_song_share(jsonb,jsonb), public.revoke_song_share(text) from public, anon;
revoke all on function public.read_song_share(text) from public;
grant execute on function public.create_song_share(jsonb,jsonb), public.revoke_song_share(text) to authenticated;
grant execute on function public.read_song_share(text) to anon, authenticated;
