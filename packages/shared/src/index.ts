export type RecordingSource = "tab" | "window" | "screen";

export type VideoStatus = "pending_upload" | "uploaded" | "ready" | "failed";

export type VideoRecord = {
  id: string;
  title: string;
  source: RecordingSource;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  status: VideoStatus;
  visibility: "public" | "private";
  durationSeconds: number | null;
  sizeBytes: number | null;
  fileName: string | null;
};

