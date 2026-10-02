-- Incremental sync pulls filter each owner's rows by updated_at
-- (`updated_at=gte.<cursor - overlap>`). RLS already restricts to owner_id, so
-- this index lets that filter avoid scanning every row (and payload) the
-- account owns. Safe to apply before or after deploying the new client.
create index if not exists sync_records_owner_updated_at_idx
  on public.sync_records (owner_id, updated_at);
