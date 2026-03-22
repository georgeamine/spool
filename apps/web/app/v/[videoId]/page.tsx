import Link from "next/link";
import { notFound } from "next/navigation";

import { getVideo } from "../../../lib/video-store";

export const dynamic = "force-dynamic";

type VideoPageProps = {
  params: Promise<{
    videoId: string;
  }>;
};

export default async function VideoPage({ params }: VideoPageProps) {
  const { videoId } = await params;
  const video = await getVideo(videoId);

  if (!video) {
    notFound();
  }

  const ready = video.status === "ready";

  return (
    <main className="pageShell">
      <section className="card videoPage">
        <div className="sectionHeader">
          <div>
            <p className="eyebrow">Share page</p>
            <h1>{video.title}</h1>
          </div>
          <Link href="/dashboard" className="textLink">
            Back to dashboard
          </Link>
        </div>

        <div className="videoFrame">
          {ready ? (
            <video
              controls
              playsInline
              preload="metadata"
              className="videoPlayer"
              src={`/api/videos/${video.id}/file`}
            />
          ) : (
            <div className="videoPlaceholder">
              <p>Video status: {video.status}</p>
              <p>The upload may still be completing.</p>
            </div>
          )}
        </div>

        <div className="metaStack">
          <p>
            <strong>Status:</strong> {video.status}
          </p>
          <p>
            <strong>Source:</strong> {video.source}
          </p>
          <p>
            <strong>Created:</strong> {new Date(video.createdAt).toLocaleString()}
          </p>
          <p>
            <strong>Share URL:</strong> <code>{`/v/${video.id}`}</code>
          </p>
        </div>
      </section>
    </main>
  );
}
