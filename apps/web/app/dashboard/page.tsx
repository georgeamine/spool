import { VideoCard } from "../../components/video-card";
import { listVideos } from "../../lib/video-store";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const videos = await listVideos();

  return (
    <main className="pageShell">
      <section className="sectionHeader">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Your recordings</h1>
        </div>
      </section>

      {videos.length === 0 ? (
        <section className="card emptyState">
          <h2>No recordings yet</h2>
          <p>Start the web app, load the Chrome extension, and create your first Spool recording.</p>
        </section>
      ) : (
        <section className="grid">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </section>
      )}
    </main>
  );
}
