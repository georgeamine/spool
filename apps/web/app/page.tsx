import Link from "next/link";

import { listVideos } from "../lib/video-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const videos = await listVideos();

  return (
    <main className="pageShell">
      <section className="hero card">
        <p className="eyebrow">Spool MVP</p>
        <h1>Record in Chrome. Upload locally. Share a link.</h1>
        <p className="lead">
          This first pass keeps storage on disk so the extension and web app can run end-to-end
          without external services.
        </p>
        <div className="heroActions">
          <Link href="/dashboard" className="button">
            Open dashboard
          </Link>
          {videos[0] ? (
            <Link href={`/v/${videos[0].id}`} className="button buttonSecondary">
              Latest recording
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
