import { writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getUploadPath, getVideo, updateVideo } from "../../../../../lib/video-store";

export const runtime = "nodejs";

type UploadRouteProps = {
  params: Promise<{
    videoId: string;
  }>;
};

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }

  return "webm";
}

export async function POST(request: Request, { params }: UploadRouteProps) {
  const { videoId } = await params;
  const video = await getVideo(videoId);

  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? video.mimeType;
  const extension = extensionForMimeType(contentType);
  const buffer = Buffer.from(await request.arrayBuffer());
  const filePath = await getUploadPath(videoId, extension);

  await writeFile(filePath, buffer);

  const updatedVideo = await updateVideo(videoId, (currentVideo) => ({
    ...currentVideo,
    status: "uploaded",
    fileName: path.basename(filePath),
    mimeType: contentType,
    sizeBytes: buffer.byteLength
  }));

  return NextResponse.json({
    ok: true,
    video: updatedVideo
  });
}
