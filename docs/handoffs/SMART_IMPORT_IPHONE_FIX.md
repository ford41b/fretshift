# Smart Import iPhone Fix & Unified Liquid Glass Switches

- The iPhone Safari `Load failed` error may occur when `createImageBitmap` cannot decode an otherwise displayable canvas-generated PDF page JPEG. Image preparation now falls back to a normal image element, properly releasing the blob URL. If both decoders fail, the page-specific message names image preparation and offers a local PDF text route.
- A failed OCR PDF page with a local text layer now offers **Use local PDF text instead**. The user must review and correct chord alignment; this is not claimed as OCR success.
- Network/Edge Function failures now identify the need to check the active Supabase `vision-import` deployment and its `ALLOWED_ORIGINS` environment setting, as opposed to misidentifying every `Load failed` as a server error.
- Existing `GlassSwitch` replaces remaining plain checkboxes (force visual, page boundaries, PDF boundaries, rhythm/loop, strumming), retaining native keyboard/screen-reader semantics. Its visible glass track is now shared on desktop and mobile. No audio/scoring/business logic changed.

## Deployment and validation

Deploy the updated Vercel bundle. If network errors persist, deploy the included `supabase/functions/vision-import` function and verify its `OCR_SPACE_API_KEY` and `ALLOWED_ORIGINS` include the exact deployed web-app origin. A Vercel ZIP upload does not deploy the Supabase function. Confirm on a physical iPhone using the original PDF: visual OCR of one page, then two pages, manual local-text fallback, and page retries. No live iPhone or OCR.space provider test is implied by offline checks.
