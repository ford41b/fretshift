-- The callback completion RPC requires a verified Supabase session. Keep the
-- anonymous create/claim endpoints intentionally available for the PWA handoff,
-- but do not expose completion to the anon role.
revoke execute on function public.complete_auth_handoff(uuid, text) from anon;
grant execute on function public.complete_auth_handoff(uuid, text) to authenticated;
