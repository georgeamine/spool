import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createVideo } from "../../../../lib/video-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    source?: "tab" | "window" | "screen";
    mimeType?: string;
  };

  const videoId = randomUUID();
  const source = body.source ?? "screen";
  const mimeType = body.mimeType ?? "video/webm";
  const title = body.title?.trim() || `Spool recording ${new Date().toLocaleString()}`;

  await createVideo({
    id: videoId,
    title,
    source,
    mimeType
  });

  const origin = new URL(request.url).origin;

  return NextResponse.json({
    videoId,
    uploadUrl: `${origin}/api/videos/${videoId}/upload`,
    shareUrl: `${origin}/v/${videoId}`
  });
}
