import { createYouTubeImportHandler } from "./handler.ts";

// Pure logic lives in core.ts and handler.ts (Deno tests: *_test.ts). The
// per-user call quota needs migration 202610020001_rate_limits.sql and the
// automatically provided SUPABASE_SERVICE_ROLE_KEY; without them the function
// fails closed. GEMINI_API_KEY is a server-only secret.
Deno.serve(createYouTubeImportHandler({ env: (name) => Deno.env.get(name) }));
