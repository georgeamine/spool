# Spool

Greenfield MVP for a Loom-style Chrome extension plus web app.

## Workspace

- `apps/web`: Next.js app with local filesystem storage for recordings
- `apps/extension`: Manifest V3 Chrome extension, loadable unpacked
- `packages/shared`: shared types for the web app and future extension build step

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Start the web app:

```bash
pnpm dev:web
```

3. Load the extension from `apps/extension` in `chrome://extensions`.

4. In the extension popup, keep `Server URL` pointed at `http://localhost:3000`.

## Current MVP Behavior

- Configure recording source and microphone in the extension popup
- Choose what happens after recording:
  - save locally
  - upload for a share link
  - or do both
- Start recording from the popup
- Click the extension icon again to stop recording
- Local saves use Chrome Downloads and go to the user's machine
- Uploads go to the local Next.js server and open a share page

## Notes

- Storage is local-only for now: metadata in `apps/web/data/videos.json`, blobs in `apps/web/data/uploads`
- Public share pages are available without auth in this first pass
- The extension is intentionally buildless so the first loop is simple to run and debug
