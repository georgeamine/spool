import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { getVideo } from "../../../../../lib/video-store";

export const runtime = "nodejs";

type FileRouteProps = {
  params: Promise<{
    videoId: string;
  }>;
};

export async function GET(_request: Request, { params }: FileRouteProps) {
  const { videoId } = await params;
  const video = await getVideo(videoId);

  if (!video?.fileName) {
    return NextResponse.json({ error: "Video file not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "data", "uploads", video.fileName);
  const file = await readFile(filePath);

  return new NextResponse(file, {
    headers: {
      "Content-Type": video.mimeType,
      "Content-Length": String(file.byteLength),
      "Cache-Control": "no-store"
    }
  });
}
