# Vision import Edge Function

This authenticated Supabase Edge Function proxies preprocessed chart images to OCR.space Engine 3. The browser never receives the provider key. Request and response bodies use `Cache-Control: no-store`, and the function does not log image data.

Set Edge Function secrets:

```sh
supabase secrets set OCR_SPACE_API_KEY=... ALLOWED_ORIGINS=https://your-app.example
```

Deploy with the committed function configuration:

```sh
supabase functions deploy vision-import
```

`supabase/config.toml` sets `verify_jwt = false` for this function. This is intentional: FretShift verifies the bearer token against Supabase Auth inside the function, which avoids the legacy platform JWT gate rejecting projects that use current asymmetric Auth signing keys. `SUPABASE_URL` plus Supabase public-key environment variables are supplied by Supabase. The function accepts the legacy `SUPABASE_ANON_KEY` and current publishable-key environment forms. Review OCR.space's current privacy and retention terms before production use.

Limits: 1–10 JPEG pages, 1600 px maximum edge, 1 MB per prepared page, approximately 40 MB total encoded input, and a 25-second upstream timeout. Each page is sent separately because the browser has already rasterized scanned PDFs.
