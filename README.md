# Spool

Open source Chrome recorder that saves recordings straight to `Downloads/Spool`, with an optional S3-backed sharing flow.

Spool is a local-first Chrome extension for quick screen recordings. It opens an in-page panel on normal web pages, records locally, and downloads the file automatically. It can also upload a copy to S3 through a tiny share API, without requiring a separate frontend web app.

## Features

- in-page recorder panel instead of a browser popup
- records `Current tab`, `Chrome window`, or `Entire screen`
- optional draggable and resizable webcam bubble
- optional microphone input with live level preview
- downloads recordings automatically to `Downloads/Spool`
- local-first `.webm` recording pipeline
- optional S3-backed share links through a lightweight API
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

## Share API

The repo now includes a minimal Hono API in [`apps/api`](/Users/georgeamine/Developer/spool/apps/api) that is designed for AWS Lambda Function URLs:

- presigns private S3 uploads
- returns stable share URLs
- redirects share URLs to fresh signed S3 download URLs
- exposes `GET /health` for lightweight liveness checks, returning `{"status":"ok"}`

The S3 bucket provisioned for this repo is:

- `spool-recordings-590183765115-us-west-1`

To run the share API locally:

```bash
pnpm install
pnpm api:dev
```

To verify the API health endpoint changes locally:

```bash
pnpm api:lint
pnpm api:test
```

Environment variables are documented in [`apps/api/.env.example`](/Users/georgeamine/Developer/spool/apps/api/.env.example).

To bundle the Lambda package:

```bash
pnpm api:package
```

To deploy the Lambda function with the included script:

```bash
AWS_REGION=us-west-1 \
SPOOL_S3_BUCKET=spool-recordings-590183765115-us-west-1 \
./apps/api/scripts/deploy-lambda.sh
```

That script creates or updates:

- Lambda function: `spool-share-api`
- IAM role: `spool-share-api-role`
- public Lambda Function URL

The checked-in extension default points at the production Lambda Function URL below.

The current deployed production Function URL is:

- `https://od7plq3t5uk56crva7krmx44yi0fwxzh.lambda-url.us-west-1.on.aws`

## Current Behavior

- `Current tab` records the tab as rendered
- `Chrome window` and `Entire screen` record the raw display stream
- the webcam bubble is a live page preview and can be dragged or resized
- when recording stops, Spool opens an extension results page with the latest video
- the results page lets you download the `.webm` locally or sign in and upload for a share link

## Notes

- recording only works on regular `http` or `https` pages
- Chrome internal pages like `chrome://newtab`, `chrome://extensions`, and `chrome://settings` are blocked
- recordings are saved automatically to `Downloads/Spool`
- `WebM` is the supported recording format today
- `MP4` is shown in settings as a disabled coming-soon option
- share links are served through the share API and backed by private S3 objects
