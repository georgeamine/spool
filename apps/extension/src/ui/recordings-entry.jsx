import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import "../ui/app.css";
import { AppLayout } from "./components/AppLayout.jsx";
import { formatBytes, formatDate } from "./lib/format.js";
import { deleteRecording, fetchRecordings, saveRecordingTitle } from "./lib/api.js";
import { getRecordingDetailPageUrl } from "./lib/navigation.js";
import { getValidAuthSession, signOutAuthSession } from "../share-auth.js";
import { sanitizeRecordingTitle } from "../recording-title.js";

function PageActions({ session, onAuthClick, busy, onRefresh }) {
  return (
    <div className="authRow">
      <button className="button buttonSecondary" onClick={onRefresh} disabled={!session?.accessToken || busy}>
        Refresh
      </button>
      <button className="button buttonSecondary" onClick={onAuthClick} disabled={busy}>
        {session?.accessToken ? "Sign out" : "Sign in"}
      </button>
    </div>
  );
}

function RecordingPreview({ recording }) {
  if (!recording.shareUrl) {
    return (
      <div className="recordingPreviewFallback">
        <span className="fieldLabel">Preview unavailable</span>
        <span className="pageDescription">This recording does not have a playable share link yet.</span>
      </div>
    );
  }

  return (
    <a className="recordingPreviewLink" href={getRecordingDetailPageUrl(recording.shareId)}>
      <div className="recordingPreviewFrame">
        <video className="recordingPreviewVideo" src={recording.shareUrl} muted playsInline preload="metadata" />
      </div>
      <div className="recordingPreviewOverlay">
        <span className={`statusPill ${recording.status}`}>{recording.status}</span>
      </div>
    </a>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [storageBytesUsed, setStorageBytesUsed] = useState(0);
  const [recordingsLimit, setRecordingsLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [titleDrafts, setTitleDrafts] = useState({});
  const [savingShareIds, setSavingShareIds] = useState({});

  useEffect(() => {
    loadRecordings().catch((error) => {
      setStatus(error.message);
      toast.error(error.message);
    });
  }, []);

  function setShareSaving(shareId, nextSaving) {
    setSavingShareIds((current) => ({
      ...current,
      [shareId]: nextSaving
    }));
  }

  async function loadRecordings({ interactiveAuth = false } = {}) {
    const nextSession = await getValidAuthSession({ interactive: interactiveAuth });
    setSession(nextSession);

    if (!nextSession?.accessToken) {
      setRecordings([]);
      setStorageBytesUsed(0);
      setRecordingsLimit(10);
      setTitleDrafts({});
      setStatus("Sign in to manage your recordings.");
      return;
    }

    setBusy(true);
    try {
      const payload = await fetchRecordings(nextSession.accessToken);
      setRecordings(payload.recordings || []);
      setStorageBytesUsed(Number(payload.storageBytesUsed || 0));
      setRecordingsLimit(Number(payload.recordingsLimit || 10));
      setTitleDrafts(
        Object.fromEntries((payload.recordings || []).map((recording) => [recording.shareId, recording.title || recording.fileName]))
      );
      setStatus(payload.recordings?.length ? "Recordings ready." : "No recordings yet.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAuthClick() {
    if (session?.accessToken) {
      await signOutAuthSession();
      setSession(null);
      setRecordings([]);
      setStorageBytesUsed(0);
      setRecordingsLimit(10);
      setTitleDrafts({});
      setStatus("Signed out.");
      toast.success("Signed out.");
      return;
    }

    setStatus("Opening sign-in...");
    try {
      await loadRecordings({ interactiveAuth: true });
      toast.success("Signed in.");
    } catch (error) {
      setStatus(error.message);
      toast.error(error.message);
    }
  }

  async function handleDelete(shareId) {
    const recording = recordings.find((item) => item.shareId === shareId);
    if (!recording) {
      return;
    }

    const confirmed = window.confirm(`Delete "${recording.title || recording.fileName}"? This also invalidates the share link.`);
    if (!confirmed) {
      return;
    }

    try {
      setBusy(true);
      const payload = await deleteRecording(session.accessToken, shareId);
      setRecordings((current) => current.filter((item) => item.shareId !== shareId));
      setStorageBytesUsed(Number(payload.storageBytesUsed || 0));
      setRecordingsLimit(Number(payload.recordingsLimit || recordingsLimit));
      setStatus("Recording deleted.");
      toast.success("Recording deleted.");
    } catch (error) {
      setStatus(error.message);
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleTitleBlur(shareId) {
    const draftTitle = sanitizeRecordingTitle(titleDrafts[shareId], "Untitled recording");
    const recording = recordings.find((item) => item.shareId === shareId);
    if (!recording) {
      return;
    }

    if (draftTitle === sanitizeRecordingTitle(recording.title || recording.fileName, "Untitled recording")) {
      return;
    }

    try {
      setShareSaving(shareId, true);
      const payload = await saveRecordingTitle(session.accessToken, shareId, draftTitle);
      setRecordings((current) =>
        current.map((item) =>
          item.shareId === shareId
            ? {
                ...item,
                title: payload.title,
                fileName: payload.fileName,
                updatedAt: payload.updatedAt
              }
            : item
        )
      );
      setTitleDrafts((current) => ({
        ...current,
        [shareId]: payload.title
      }));
      toast.success("Title saved.");
    } catch (error) {
      setStatus(error.message);
      toast.error(error.message);
    } finally {
      setShareSaving(shareId, false);
    }
  }

  return (
    <>
      <AppLayout
        activeNav="recordings"
        title="Manage recordings"
        subtitle="Review every uploaded recording, rename it inline, and jump into its detail page."
        actions={
          <PageActions
            session={session}
            onAuthClick={handleAuthClick}
            busy={busy}
            onRefresh={() => loadRecordings().catch((error) => toast.error(error.message))}
          />
        }
      >
        {!session?.accessToken ? (
          <section className="emptyCard">
            <h2 className="pageTitle">Uploads are tied to your account</h2>
            <p className="pageDescription">Sign in to see your recordings, share links, and editable titles.</p>
          </section>
        ) : (
          <>
            <section className="summaryGrid">
              <div className="summaryCard">
                <span className="fieldLabel">Recordings</span>
                <span className="summaryValue">{recordings.length}</span>
              </div>
              <div className="summaryCard">
                <span className="fieldLabel">Limit</span>
                <span className="summaryValue">{`${recordings.length}/${recordingsLimit}`}</span>
              </div>
              <div className="summaryCard">
                <span className="fieldLabel">Storage used</span>
                <span className="summaryValue">{formatBytes(storageBytesUsed)}</span>
              </div>
            </section>

            <section className="panelCard">
              <p className="pageDescription">
                Limit: {`${recordings.length}/${recordingsLimit}`}. When you hit the cap, email{" "}
                <a className="detailLink" href="mailto:george@webhouse.dev">
                  george@webhouse.dev
                </a>{" "}
                to increase your limit.
              </p>
            </section>

            {recordings.length === 0 ? (
              <section className="emptyCard">
                <h2 className="pageTitle">No recordings yet</h2>
                <p className="pageDescription">Share a recording from the detail page and it will appear here.</p>
              </section>
            ) : (
              <section className="recordingsList">
                {recordings.map((recording) => (
                  <article className="recordingCard" key={recording.shareId}>
                    <RecordingPreview recording={recording} />

                    <div className="recordingCardBody">
                      <div className="recordingCardTop">
                        <div className="recordingTitleBlock">
                          <input
                            className="recordingTitleInput"
                            value={titleDrafts[recording.shareId] ?? recording.title ?? recording.fileName}
                            maxLength={120}
                            onBlur={() => handleTitleBlur(recording.shareId)}
                            onChange={(event) =>
                              setTitleDrafts((current) => ({
                                ...current,
                                [recording.shareId]: event.target.value
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                            }}
                            disabled={busy || savingShareIds[recording.shareId]}
                          />
                          <span className="metaValueSubtle">{recording.fileName}</span>
                        </div>
                      </div>

                      <div className="metaGrid">
                        <div className="metaItem">
                          <div className="fieldLabel">Uploaded</div>
                          <div className="metaValue">{formatDate(recording.completedAt || recording.createdAt)}</div>
                        </div>
                        <div className="metaItem">
                          <div className="fieldLabel">Size</div>
                          <div className="metaValue">{formatBytes(recording.sizeBytes)}</div>
                        </div>
                      </div>

                      <div className="recordingActions">
                        <a className="button buttonPrimary" href={getRecordingDetailPageUrl(recording.shareId)}>
                          Details
                        </a>
                        <button
                          className="button buttonSecondary"
                          onClick={async () => {
                            await navigator.clipboard.writeText(recording.shareUrl);
                            toast.success("Share link copied.");
                          }}
                          disabled={busy || !recording.shareUrl}
                        >
                          Copy link
                        </button>
                        <a
                          className="button buttonSecondary"
                          href={recording.shareUrl || "#"}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => {
                            if (!recording.shareUrl) {
                              event.preventDefault();
                            }
                          }}
                        >
                          Open share
                        </a>
                        <button
                          className="button buttonDanger"
                          onClick={() => handleDelete(recording.shareId)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </>
        )}

        <div className="statusMessage">{status}</div>
      </AppLayout>
      <Toaster position="bottom-right" richColors />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
