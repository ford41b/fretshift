import { createVisionHandler } from "./handler.ts";

// All logic lives in handler.ts (unit-tested with Vitest). The per-user page
// quota needs migration 202610020001_rate_limits.sql and the automatically
// provided SUPABASE_SERVICE_ROLE_KEY; without them the function fails closed.
Deno.serve(createVisionHandler({ env: (name) => Deno.env.get(name) }));
