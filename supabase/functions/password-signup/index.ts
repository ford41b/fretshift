import { createSignupHandler } from "./handler.ts";

// All logic lives in handler.ts (unit-tested with Vitest). Requires the
// rate-limit migration 202610020001_rate_limits.sql; without it the function
// fails closed with 503.
Deno.serve(createSignupHandler({ env: (name) => Deno.env.get(name) }));
