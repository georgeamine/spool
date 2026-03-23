import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import "../ui/app.css";
import { AppLayout } from "./components/AppLayout.jsx";
import { formatBytes, formatDate } from "./lib/format.js";
import {
  fetchRecordingByShareId,
  saveRecordingTitle,
  uploadRecordingForShare
} from "./lib/api.js";
import { getRequestedShareId, getRecordingsPageUrl } from "./lib/navigation.js";
import { getValidAuthSession, signOutAuthSession } from "../share-auth.js";
import { getLatestRecording, updateLatestRecording } from "../recording-store.js";
import { sanitizeRecordingTitle, titleToFileName } from "../recording-title.js";
import { DOWNLOAD_DIRECTORY } from "../share-config.js";

function getDisplayRecordingTitle(recording) {
  return sanitizeRecordingTitle(recording?.title, "Untitled recording");
}

function normalizeRecording(recording, source = "local") {
  if (!recording) {
    return null;
  }

  const title = getDisplayRecordingTitle(recording);
  return {
    ...recording,
    fileName: recording.fileName || titleToFileName(title),
    source,
    title
  };
}

function PageActions({ session, onAuthClick, busy }) {
  return (
    <div className="authRow">
      <button className="button buttonSecondary" onClick={onAuthClick} disabled={busy}>
        {session?.accessToken ? "Sign out" : "Sign in"}
      </button>
    </div>
  );
}

function EmptyDetail({ hasRequestedShareId, onGoToRecordings }) {
  return (
    <section className="emptyCard">
      <h2 className="pageTitle">{hasRequestedShareId ? "Recording not available" : "No recording ready"}</h2>
      <p className="pageDescription">
        {hasRequestedShareId
          ? "This recording could not be loaded from your account."
          : "Finish a recording in Spool or open an existing one from your recordings library."}
      </p>
      <div className="actionRow">
        <a className="button buttonSecondary" href={getRecordingsPageUrl()} onClick={onGoToRecordings}>
          Manage recordings
        </a>
      </div>
    </section>
  );
}

function App() {
  const requestedShareId = useMemo(() => getRequestedShareId(), []);
  const [session, setSession] = useState(null);
  const [recording, setRecording] = useState(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [recordingLoaded, setRecordingLoaded] = useState(false);
  const initialTitleSyncRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextSession = await getValidAuthSession();
        const latest = normalizeRecording(await getLatestRecording(), "local");
        if (cancelled) {
          return;
        }

        setSession(nextSession);

        if (!requestedShareId) {
          setRecording(latest);
          setTitle(getDisplayRecordingTitle(latest));
          setRecordingLoaded(true);

          if (latest?.blob && !latest.shareUrl && nextSession?.accessToken) {
            setStatus("Uploading recording...");
            const uploaded = await uploadRecordingForShare(nextSession.accessToken, latest);
            const updated = normalizeRecording(
              await updateLatestRecording({
                ...uploaded,
                fileName: titleToFileName(getDisplayRecordingTitle(latest)),
                title: getDisplayRecordingTitle(latest),
                sharedAt: new Date().toISOString()
              }),
              "local"
            );
            if (!cancelled) {
              setRecording(updated);
              setTitle(getDisplayRecordingTitle(updated));
              toast.success("Share link ready.");
            }
          }
          return;
        }

        if (latest?.shareId === requestedShareId) {
          setRecording(latest);
          setTitle(getDisplayRecordingTitle(latest));
          setRecordingLoaded(true);
        }

        if (!nextSession?.accessToken) {
          if (!latest || latest.shareId !== requestedShareId) {
            setRecordingLoaded(true);
            setStatus("Sign in to view this recording.");
          }
          return;
        }

        const remote = normalizeRecording(
          await fetchRecordingByShareId(nextSession.accessToken, requestedShareId),
          latest?.shareId === requestedShareId && latest?.blob ? "local" : "remote"
        );
        if (cancelled) {
          return;
        }

        setRecording((current) => ({
          ...remote,
          blob: current?.blob && current.shareId === remote.shareId ? current.blob : remote.blob
        }));
        setTitle(getDisplayRecordingTitle(remote));
        setRecordingLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setRecordingLoaded(true);
          setStatus(error.message);
          toast.error(error.message);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [requestedShareId]);

  useEffect(() => {
    initialTitleSyncRef.current = true;
  }, [recording?.shareId, recording?.createdAt]);

  useEffect(() => {
    if (!recordingLoaded || !recording) {
      return undefined;
    }

    if (initialTitleSyncRef.current) {
      initialTitleSyncRef.current = false;
      return undefined;
    }

    const normalizedTitle = sanitizeRecordingTitle(title, "Untitled recording");
    const currentTitle = getDisplayRecordingTitle(recording);
    const currentFileName = recording.fileName || titleToFileName(currentTitle);
    if (normalizedTitle === currentTitle && titleToFileName(normalizedTitle) === currentFileName) {
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        if (recording.source === "local") {
          const updated = normalizeRecording(
            await updateLatestRecording({
              title: normalizedTitle,
              fileName: titleToFileName(normalizedTitle)
            }),
            "local"
          );
          setRecording(updated);
        } else {
          setRecording((current) =>
            current
              ? {
                  ...current,
                  title: normalizedTitle,
                  fileName: titleToFileName(normalizedTitle)
                }
              : current
          );
        }

        if (recording.shareId && session?.accessToken) {
          const payload = await saveRecordingTitle(session.accessToken, recording.shareId, normalizedTitle);
          setRecording((current) =>
            current
              ? {
                  ...current,
                  title: payload.title,
                  fileName: payload.fileName,
                  updatedAt: payload.updatedAt
                }
              : current
          );
          toast.success("Title saved.");
        }
      } catch (error) {
        setStatus(error.message);
        toast.error(error.message);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [recording, recordingLoaded, session, title]);

  async function handleAuthClick() {
    if (session?.accessToken) {
      await signOutAuthSession();
      setSession(null);
      setStatus("Signed out.");
      toast.success("Signed out.");
      return;
    }

    setBusy(true);
    setStatus("Opening sign-in...");
    try {
      const nextSession = await getValidAuthSession({ interactive: true, forcePrompt: true });
      setSession(nextSession);
      setStatus("Signed in.");
      toast.success("Signed in.");
      if (recording?.blob && !recording.shareUrl) {
        const uploaded = await uploadRecordingForShare(nextSession.accessToken, {
          ...recording,
          title: sanitizeRecordingTitle(title, "Untitled recording")
        });
        const updated = normalizeRecording(
          await updateLatestRecording({
            ...uploaded,
            fileName: titleToFileName(sanitizeRecordingTitle(title, "Untitled recording")),
            title: sanitizeRecordingTitle(title, "Untitled recording")
          }),
          "local"
        );
        setRecording(updated);
        toast.success("Share link ready.");
      } else if (requestedShareId) {
        const remote = normalizeRecording(
          await fetchRecordingByShareId(nextSession.accessToken, requestedShareId),
          recording?.blob ? "local" : "remote"
        );
        setRecording((current) => ({ ...remote, blob: current?.blob }));
        setTitle(getDisplayRecordingTitle(remote));
      }
    } catch (error) {
      setStatus(error.message);
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!recording) {
      return;
    }

    setBusy(true);
    try {
      const filename = `${DOWNLOAD_DIRECTORY}/${titleToFileName(title)}`;
      if (recording.blob) {
        const blobUrl = URL.createObjectURL(recording.blob);
        await chrome.downloads.download({
          url: blobUrl,
          filename,
          saveAs: false
        });
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
      } else if (recording.shareUrl) {
        await chrome.downloads.download({
          url: recording.shareUrl,
          filename,
          saveAs: false
        });
      } else {
        throw new Error("No downloadable recording is available.");
      }

      toast.success("Recording downloaded.");
    } catch (error) {
      setStatus(error.message);
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleShareLinkCopy() {
    if (!recording?.shareUrl) {
      return;
    }

    await navigator.clipboard.writeText(recording.shareUrl);
    toast.success("Share link copied.");
  }

  const videoSrc = useMemo(() => {
    if (!recording) {
      return "";
    }

    if (recording.blob) {
      return URL.createObjectURL(recording.blob);
    }

    return recording.shareUrl || "";
  }, [recording]);

  useEffect(() => {
    return () => {
      if (videoSrc.startsWith("blob:")) {
        URL.revokeObjectURL(videoSrc);
      }
    };
  }, [videoSrc]);

  return (
    <>
      <AppLayout
        activeNav="detail"
        title="Recording detail"
        subtitle="View, rename, download, and share a recording from one place."
        actions={<PageActions session={session} onAuthClick={handleAuthClick} busy={busy} />}
      >
        {!recordingLoaded ? (
          <section className="heroCard">
            <h2 className="pageTitle">Loading recording...</h2>
          </section>
        ) : !recording ? (
          <EmptyDetail hasRequestedShareId={Boolean(requestedShareId)} />
        ) : (
          <>
            <section className="heroCard">
              <div className="heroTop">
                <div>
                  <p className="brandEyebrow">Recording</p>
                  <h2 className="pageTitle">{getDisplayRecordingTitle(recording)}</h2>
                  <p className="pageDescription">
                    {recording.shareId
                      ? "This recording is connected to your shared library."
                      : "This is your latest local recording. Sign in to upload it automatically."}
                  </p>
                </div>
                <span className={`statusPill ${recording.status || (recording.shareUrl ? "complete" : "pending")}`}>
                  {recording.shareUrl ? "Shared" : "Local only"}
                </span>
              </div>
              <div className="actionRow">
                <button className="button buttonPrimary" onClick={handleDownload} disabled={busy}>
                  Download .webm
                </button>
                {recording.shareUrl ? (
                  <>
                    <button className="button buttonSecondary" onClick={handleShareLinkCopy} disabled={busy}>
                      Copy link
                    </button>
                    <a className="button buttonSecondary" href={recording.shareUrl} target="_blank" rel="noreferrer">
                      Open share
                    </a>
                  </>
                ) : (
                  <a className="button buttonSecondary" href={getRecordingsPageUrl()}>
                    Manage recordings
                  </a>
                )}
              </div>
            </section>

            <section className="contentGrid">
              <div className="videoCard">{videoSrc ? <video controls playsInline src={videoSrc} /> : null}</div>
              <div className="metaStack">
                <section className="panelCard fieldStack">
                  <span className="fieldLabel">Title</span>
                  <input
                    className="titleInput"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Untitled recording"
                    maxLength={120}
                  />
                  <span className="mutedText">Edits auto-save. Downloads use this title as the filename.</span>
                </section>

                <section className="panelCard metaGrid">
                  <div className="metaItem">
                    <div className="fieldLabel">Filename</div>
                    <div className="metaValue">{titleToFileName(title)}</div>
                  </div>
                  <div className="metaItem">
                    <div className="fieldLabel">Size</div>
                    <div className="metaValue">{formatBytes(recording.sizeBytes || recording.blob?.size || 0)}</div>
                  </div>
                  <div className="metaItem">
                    <div className="fieldLabel">Created</div>
                    <div className="metaValue">{formatDate(recording.createdAt)}</div>
                  </div>
                  <div className="metaItem">
                    <div className="fieldLabel">Uploaded</div>
                    <div className="metaValue">{formatDate(recording.completedAt || recording.sharedAt)}</div>
                  </div>
                </section>

                {recording.shareUrl ? (
                  <section className="panelCard fieldStack">
                    <span className="fieldLabel">Share link</span>
                    <input className="textInput" readOnly value={recording.shareUrl} />
                    <a className="detailLink" href={getRecordingsPageUrl()}>
                      View all recordings
                    </a>
                  </section>
                ) : (
                  <section className="panelCard">
                    <p className="pageDescription">
                      Sign in and Spool will upload this recording automatically from this page so it shows up in
                      your recordings library.
                    </p>
                  </section>
                )}
              </div>
            </section>
          </>
        )}

        <div className="statusMessage">{status}</div>
      </AppLayout>
      <Toaster position="bottom-right" richColors />
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);
