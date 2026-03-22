import { NextResponse } from "next/server";

import { getVideo, updateVideo } from "../../../../lib/video-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    videoId?: string;
    durationSeconds?: number;
    mimeType?: string;
    sizeBytes?: number;
  };

  if (!body.videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const video = await getVideo(body.videoId);

  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const updatedVideo = await updateVideo(body.videoId, (currentVideo) => ({
    ...currentVideo,
    status: "ready",
    durationSeconds: body.durationSeconds ?? currentVideo.durationSeconds,
    mimeType: body.mimeType ?? currentVideo.mimeType,
    sizeBytes: body.sizeBytes ?? currentVideo.sizeBytes
  }));

  return NextResponse.json({
    ok: true,
    video: updatedVideo
  });
}
