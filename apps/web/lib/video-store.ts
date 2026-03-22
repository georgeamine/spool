import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { VideoRecord } from "@spool/shared";

const dataDirectory = path.join(process.cwd(), "data");
const uploadDirectory = path.join(dataDirectory, "uploads");
const videosFilePath = path.join(dataDirectory, "videos.json");

async function ensureDataDirectory() {
  await mkdir(uploadDirectory, { recursive: true });
}

async function readVideos(): Promise<VideoRecord[]> {
  await ensureDataDirectory();

  try {
    const content = await readFile(videosFilePath, "utf8");
    return JSON.parse(content) as VideoRecord[];
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";

    if (isMissing) {
      return [];
    }

    throw error;
  }
}

async function writeVideos(videos: VideoRecord[]) {
  await ensureDataDirectory();
  await writeFile(videosFilePath, JSON.stringify(videos, null, 2), "utf8");
}

export async function listVideos() {
  const videos = await readVideos();
  return videos.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getVideo(videoId: string) {
  const videos = await readVideos();
  return videos.find((video) => video.id === videoId) ?? null;
}

export async function createVideo(params: {
  id: string;
  title: string;
  source: VideoRecord["source"];
  mimeType: string;
}) {
  const videos = await readVideos();

  const newVideo: VideoRecord = {
    id: params.id,
    title: params.title,
    source: params.source,
    mimeType: params.mimeType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending_upload",
    visibility: "public",
    durationSeconds: null,
    sizeBytes: null,
    fileName: null
  };

  videos.push(newVideo);
  await writeVideos(videos);

  return newVideo;
}

export async function updateVideo(
  videoId: string,
  updater: (video: VideoRecord) => VideoRecord
) {
  const videos = await readVideos();
  const index = videos.findIndex((video) => video.id === videoId);

  if (index === -1) {
    return null;
  }

  const updatedVideo = updater(videos[index]);
  videos[index] = {
    ...updatedVideo,
    updatedAt: new Date().toISOString()
  };
  await writeVideos(videos);
  return videos[index];
}

export async function getUploadPath(videoId: string, extension: string) {
  await ensureDataDirectory();
  return path.join(uploadDirectory, `${videoId}.${extension}`);
}

export async function fileExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return !isMissing ? Promise.reject(error) : false;
  }
}

