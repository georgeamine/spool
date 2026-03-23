# Spool

Open source Chrome recorder that saves recordings straight to `Downloads/Spool`.

Spool is a local-first Chrome extension for quick screen recordings. It opens an in-page panel on normal web pages, records locally, and downloads the file automatically. There is no cloud upload flow and no dashboard.

## Features

- in-page recorder panel instead of a browser popup
- records `Current tab`, `Chrome window`, or `Entire screen`
- optional draggable and resizable webcam bubble
- optional microphone input with live level preview
- downloads recordings automatically to `Downloads/Spool`
- local-first `.webm` recording pipeline
- settings screen with format selector showing `WebM` and `MP4 (coming soon)`

## Quick Start

```bash
pnpm install
```

Then:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select [`apps/extension`](/Users/georgeamine/Developer/spool/apps/extension)

Click the Spool toolbar icon on a normal `http` or `https` page to open the recorder panel.

## Current Behavior

- `Current tab` records the tab as rendered
- `Chrome window` and `Entire screen` record the raw display stream
- the webcam bubble is a live page preview and can be dragged or resized
- recordings save automatically with no post-upload step

## Notes

- recording only works on regular `http` or `https` pages
- Chrome internal pages like `chrome://newtab`, `chrome://extensions`, and `chrome://settings` are blocked
- recordings are saved automatically to `Downloads/Spool`
- `WebM` is the supported recording format today
- `MP4` is shown in settings as a disabled coming-soon option
