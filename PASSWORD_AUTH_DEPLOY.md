# FretShift password auth

FretShift supports:
1. 8-digit verification code
2. Magic link
3. Email + password

## Creating a password account (changed 2026-10-02)

Password sign-up now proves email ownership before the account can be used:

1. The app calls the `password-signup` Edge Function with the email only. The
   function checks the Origin, rate-limits per IP and per email, then asks
   Supabase Auth to email the usual 8-digit code (`/auth/v1/otp`,
   `create_user: true`). A new account is **unconfirmed** and has a random
   password nobody knows. The response is identical whether or not the email
   is already registered.
2. The user enters the code. The app verifies it (`/auth/v1/verify`), which
   signs them in, and only then saves the chosen password (`PUT /auth/v1/user`).

The password never reaches `password-signup`. This prevents account
pre-hijacking: registering someone else's email no longer gives the caller a
working password. Password sign-up therefore needs email delivery (configure
SMTP; the built-in Supabase mailer has a very low hourly quota).

If the user opens the emailed link instead of entering the code (including the
iPhone Home Screen handoff), they are signed in without a password and can set
one under **Set or change password**.

Existing users who originally signed in with a verification code or magic link
do not automatically have a password. They should sign in with their existing
method once, open Account & sync, expand **Set or change password**, and save a
password. After that, the same account can use Email + password sign-in.

## Deploy order

1. Apply `supabase/migrations/202610020001_rate_limits.sql` (without it the
   function fails closed with 503).
2. `supabase functions deploy password-signup` (config.toml keeps
   `verify_jwt = false` for it).
3. Deploy the web app build that contains the two-step sign-up UI.

Optional Edge Function secrets: `SIGNUP_IP_LIMIT_PER_HOUR` (default 10),
`SIGNUP_EMAIL_LIMIT_PER_HOUR` (default 3), `ALLOWED_ORIGINS` (extra exact
origins, comma-separated).
