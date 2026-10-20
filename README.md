# Aurix Piped Player — Vercel API Relay edition

Phone-first black Aurix player prototype with real Piped audio/video stream metadata, search, queue, and upright 9:16 video mode.

## What changed

- `app.js` stays at the site root because it runs in the browser and owns the UI. It no longer contacts public Piped API hosts directly.
- `/api/piped/search` and `/api/piped/streams` are Vercel serverless functions. They forward JSON API requests server-side to an allowlist of public Piped instances, trying small parallel batches with short timeouts. This can avoid browser CORS blocks on the Piped JSON endpoints.
- Audio/video media URLs returned by Piped are still loaded directly by the browser. The relay intentionally does not proxy entire media files through Vercel; doing that can create high bandwidth/function usage and buffering problems.
- No iTunes preview or fake audio fallback is used. If Piped does not return a playable stream, the player shows an error.
- Video defaults to portrait crop (`object-fit: cover`) without rotating the phone; the Fit control restores the original frame.

## Project layout

```text
aurix-piped-player/
├── index.html
├── styles.css
├── app.js
├── vercel.json
├── lib/
│   └── piped.js
├── api/
│   └── piped/
│       ├── search.js
│       └── streams.js
└── README.md
```

## Deploy on Vercel

Import this folder as the project root. No build command or environment variables are required. Vercel serves the static player and deploys the two files under `api/piped/` as serverless functions.

## Limitations

Piped is community-run infrastructure: instances may be down, rate-limited, or reject traffic from Vercel. The server-side relay can help when the problem is browser CORS, but it cannot make an unavailable upstream work. Actual media URLs can also expire, fail, or be unsupported by the browser. If metadata loads but media playback still fails, inspect the returned `audioStreams`/`videoStreams` URL and media-host response separately.
