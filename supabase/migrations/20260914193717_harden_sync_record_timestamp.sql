create or replace function public.sync_record_timestamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  new.revision = old.revision + 1;
  return new;
end
$$;
