import Link from "next/link";

import type { VideoRecord } from "@spool/shared";

type VideoCardProps = {
  video: VideoRecord;
};

export function VideoCard({ video }: VideoCardProps) {
  return (
    <article className="card">
      <div className="cardHeader">
        <div>
          <p className="eyebrow">{video.source}</p>
          <h3>{video.title}</h3>
        </div>
        <span className={`status status-${video.status}`}>{video.status}</span>
      </div>
      <p className="meta">
        Created {new Date(video.createdAt).toLocaleString()} •{" "}
        {video.durationSeconds ? `${video.durationSeconds.toFixed(1)}s` : "Duration pending"}
      </p>
      <Link href={`/v/${video.id}`} className="primaryLink">
        Open share page
      </Link>
    </article>
  );
}

