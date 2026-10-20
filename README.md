# Aurix Piped Player Prototype

A phone-first static web prototype for testing a black, premium Aurix-style music player with a Piped-powered search, audio playback and immersive portrait video mode.

## Run locally

Open `index.html` in a modern browser, or use a local static server (recommended for consistent browser behavior):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` from this directory.

## What it does

- Searches public Piped instances with `/search?q=...&filter=music_videos`.
- Requests stream metadata from `/streams/:videoId`.
- Uses Piped `audioStreams` for the regular audio player; no iTunes preview or unrelated audio fallback is used.
- Uses a compatible combined MP4 video stream where available. If an instance only provides video-only MP4, it attempts to pair the video with the Piped audio stream and synchronize them.
- The dedicated Video tab opens an immersive portrait player. Landscape video uses `object-fit: cover` by default; the top-right fit control switches to the original aspect ratio. The page never requests device rotation.
- Exit returns to the audio player at approximately the same timestamp and restores playback if audio was playing before Video mode.
- Public instance requests are tried in short parallel batches with timeouts. The last responsive instance is remembered locally when browser storage is available.
- Includes a search-result queue, track controls, progress scrubbing, repeat, shuffle and a local like toggle.

## Important limitations

Piped is a public third-party service, not a guaranteed streaming backend. Public instances can be down, rate limited, block browser CORS requests, or return streams that expire or aren't supported by a given browser. Actual playback depends on the selected instance and the stream formats it returns. No fake/iTunes audio fallback is used; errors are surfaced in the player.

## Deploy

This is a static site. It can be imported into Vercel as a static project with the project root set to this folder. No environment variables or build step are required.
