import {
  DOWNLOAD_DIRECTORY,
  SHARE_API_BASE_URL
} from "./share-config.js";
import {
  getValidAuthSession,
  signOutAuthSession
} from "./share-auth.js";
import {
  sanitizeRecordingTitle,
  titleToFileName
} from "./recording-title.js";
import {
  getLatestRecording,
  updateLatestRecording
} from "./recording-store.js";

const authButton = document.getElementById("authButton");
const authStatusNode = document.getElementById("authStatus");
const emptyStateNode = document.getElementById("emptyState");
const recordingPanelNode = document.getElementById("recordingPanel");
const previewVideoNode = document.getElementById("previewVideo");
const titleInput = document.getElementById("titleInput");
const fileNameNode = document.getElementById("fileName");
const fileSizeNode = document.getElementById("fileSize");
const downloadButton = document.getElementById("downloadButton");
const uploadsButton = document.getElementById("uploadsButton");
const shareButton = document.getElementById("shareButton");
const shareResultNode = document.getElementById("shareResult");
const shareUrlNode = document.getElementById("shareUrl");
const copyShareButton = document.getElementById("copyShareButton");
const openShareButton = document.getElementById("openShareButton");
const statusNode = document.getElementById("status");

let currentRecording = null;
let currentSession = null;
let currentPreviewUrl = "";
let pageBusy = false;
let pendingTitleSaveTimer = null;
let titleSaveRequestId = 0;

function setStatus(message) {
  statusNode.textContent = message;
}

function syncUi() {
  syncRecordingUi();
}

function setBusy(nextBusy) {
  pageBusy = Boolean(nextBusy);
  syncUi();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function getRecordingTitle() {
  const liveTitle = typeof titleInput?.value === "string" ? titleInput.value : "";
  return sanitizeRecordingTitle(liveTitle || currentRecording?.title, "Untitled recording");
}

function getRecordingFileName() {
  return titleToFileName(getRecordingTitle());
}

function revokePreviewUrl() {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = "";
  }
}

function syncShareResult(shareUrl) {
  const normalizedShareUrl = typeof shareUrl === "string" ? shareUrl.trim() : "";
  const hasShareUrl = normalizedShareUrl.length > 0;
  shareResultNode.hidden = !hasShareUrl;
  shareUrlNode.value = hasShareUrl ? normalizedShareUrl : "";
  copyShareButton.disabled = !hasShareUrl || pageBusy;
  openShareButton.disabled = !hasShareUrl || pageBusy;
}

function syncAuthUi() {
  const signedIn = Boolean(currentSession?.accessToken);
  authButton.textContent = signedIn ? "Sign out" : "Sign in";

  if (signedIn) {
    authStatusNode.textContent = currentSession.email
      ? `Signed in as ${currentSession.email}`
      : "Signed in. Sharing is available.";
  } else {
    authStatusNode.textContent = "Sign in to upload and get a share link.";
  }

  const hasRecording = Boolean(currentRecording?.blob);
  const hasShareLink = Boolean(currentRecording?.shareUrl);
  downloadButton.disabled = !hasRecording || pageBusy;
  shareButton.disabled = !hasRecording || pageBusy || hasShareLink;
  uploadsButton.disabled = pageBusy;
  authButton.disabled = pageBusy;
}

function syncRecordingUi() {
  const hasRecording = Boolean(currentRecording?.blob);
  emptyStateNode.hidden = hasRecording;
  recordingPanelNode.hidden = !hasRecording;

  if (!hasRecording) {
    revokePreviewUrl();
    previewVideoNode.removeAttribute("src");
    previewVideoNode.load();
    titleInput.value = "";
    fileNameNode.textContent = "";
    fileSizeNode.textContent = "";
    syncShareResult("");
    syncAuthUi();
    return;
  }

  revokePreviewUrl();
  currentPreviewUrl = URL.createObjectURL(currentRecording.blob);
  previewVideoNode.src = currentPreviewUrl;
  titleInput.value = getRecordingTitle();
  fileNameNode.textContent = getRecordingFileName();
  fileSizeNode.textContent = formatBytes(currentRecording.sizeBytes || currentRecording.blob.size);
  syncShareResult(currentRecording.shareUrl);
  syncAuthUi();
}

async function saveTitleRemotely(title, shareId) {
  if (!shareId || !currentSession?.accessToken) {
    return;
  }

  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos/${shareId}/title`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${currentSession.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title,
      fileName: titleToFileName(title)
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to save the recording title.");
  }
}

async function persistRecordingTitle(nextTitle, { saveRemote = true } = {}) {
  if (!currentRecording) {
    return;
  }

  const title = sanitizeRecordingTitle(nextTitle, "Untitled recording");
  currentRecording = await updateLatestRecording({
    title,
    fileName: titleToFileName(title)
  });
  syncRecordingUi();

  if (!saveRemote || !currentRecording?.shareId || !currentSession?.accessToken) {
    return;
  }

  const requestId = ++titleSaveRequestId;
  try {
    await saveTitleRemotely(title, currentRecording.shareId);
    if (requestId === titleSaveRequestId) {
      setStatus("Title saved.");
    }
  } catch (error) {
    if (requestId === titleSaveRequestId) {
      setStatus(error.message);
    }
  }
}

function scheduleTitleSave(nextTitle) {
  if (pendingTitleSaveTimer !== null) {
    clearTimeout(pendingTitleSaveTimer);
  }

  pendingTitleSaveTimer = window.setTimeout(() => {
    pendingTitleSaveTimer = null;
    persistRecordingTitle(nextTitle, {
      saveRemote: Boolean(currentRecording?.shareId && currentSession?.accessToken)
    }).catch((error) => {
      setStatus(error.message);
    });
  }, 500);
}

async function loadPageState() {
  currentRecording = await getLatestRecording();
  currentSession = await getValidAuthSession();
  syncRecordingUi();

  if (currentRecording?.blob && !currentRecording?.shareUrl && currentSession?.accessToken) {
    handleShare({ interactiveAuth: false }).catch((error) => {
      setStatus(error.message);
    });
  }
}

async function handleDownload() {
  if (!currentRecording?.blob) {
    setStatus("No recording is available.");
    return;
  }

  setBusy(true);
  setStatus("Downloading recording...");

  const downloadUrl = URL.createObjectURL(currentRecording.blob);

  try {
    const downloadId = await chrome.downloads.download({
      url: downloadUrl,
      filename: `${DOWNLOAD_DIRECTORY}/${getRecordingFileName()}`,
      saveAs: false
    });

    if (typeof downloadId !== "number") {
      throw new Error("Chrome did not return a download id.");
    }

    setStatus("Recording downloaded to Downloads/Spool.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
    setBusy(false);
  }
}

async function handleShare({ interactiveAuth = true } = {}) {
  if (!currentRecording?.blob) {
    setStatus("No recording is available.");
    return;
  }

  setBusy(true);
  setStatus("Preparing share...");

  try {
    currentSession = await getValidAuthSession({ interactive: interactiveAuth });
    syncAuthUi();

    if (!currentSession?.accessToken) {
      throw new Error("Sign-in is required before you can share.");
    }

    const initResponse = await fetch(`${SHARE_API_BASE_URL}/api/share/init`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${currentSession.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        contentType: currentRecording.mimeType || currentRecording.blob.type || "video/webm",
        fileName: getRecordingFileName(),
        fileSizeBytes: currentRecording.sizeBytes || currentRecording.blob.size,
        title: getRecordingTitle()
      })
    });

    const initPayload = await initResponse.json().catch(() => null);
    if (!initResponse.ok || !initPayload?.ok) {
      throw new Error(initPayload?.error || "Failed to initialize the share upload.");
    }

    setStatus("Uploading recording...");

    const uploadResponse = await fetch(initPayload.uploadUrl, {
      method: initPayload.uploadMethod || "PUT",
      headers: initPayload.uploadHeaders || {
        "content-type": currentRecording.mimeType || currentRecording.blob.type || "video/webm"
      },
      body: currentRecording.blob
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status ${uploadResponse.status}.`);
    }

    const completeResponse = await fetch(`${SHARE_API_BASE_URL}/api/share/complete`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${currentSession.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        shareId: initPayload.shareId
      })
    });

    const completePayload = await completeResponse.json().catch(() => null);
    if (!completeResponse.ok || !completePayload?.ok) {
      throw new Error(completePayload?.error || "Failed to finish the share upload.");
    }

    currentRecording = await updateLatestRecording({
      fileName: getRecordingFileName(),
      shareId: initPayload.shareId,
      shareUrl: completePayload.shareUrl || initPayload.shareUrl,
      sizeBytes: completePayload.sizeBytes || currentRecording.sizeBytes || currentRecording.blob.size,
      sharedAt: new Date().toISOString()
    });

    syncRecordingUi();
    setStatus("Share link ready.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleAuthButtonClick() {
  if (currentSession?.accessToken) {
    currentSession = null;
    await signOutAuthSession();
    syncAuthUi();
    setStatus("Signed out.");
    return;
  }

  setBusy(true);
  setStatus("Opening sign-in...");

  try {
    currentSession = await getValidAuthSession({ interactive: true, forcePrompt: true });
    syncAuthUi();

    if (currentRecording?.blob && !currentRecording?.shareUrl) {
      setStatus("Signed in. Uploading recording...");
      setBusy(false);
      await handleShare({ interactiveAuth: false });
      return;
    }

    setStatus("Signed in.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function openUploadsPage() {
  window.open(chrome.runtime.getURL("src/uploads.html"), "_blank", "noopener,noreferrer");
}

titleInput.addEventListener("input", () => {
  if (!currentRecording) {
    return;
  }

  currentRecording.title = getRecordingTitle();
  currentRecording.fileName = getRecordingFileName();
  fileNameNode.textContent = currentRecording.fileName;
  setStatus(currentRecording.shareId ? "Saving title..." : "Title updated.");
  scheduleTitleSave(titleInput.value);
});

titleInput.addEventListener("blur", () => {
  if (!currentRecording) {
    return;
  }

  if (pendingTitleSaveTimer !== null) {
    clearTimeout(pendingTitleSaveTimer);
    pendingTitleSaveTimer = null;
  }

  persistRecordingTitle(titleInput.value, {
    saveRemote: Boolean(currentRecording?.shareId && currentSession?.accessToken)
  }).catch((error) => {
    setStatus(error.message);
  });
});

copyShareButton.addEventListener("click", async () => {
  try {
    if (!shareUrlNode.value) {
      throw new Error("No share link is available.");
    }

    await navigator.clipboard.writeText(shareUrlNode.value);
    setStatus("Share link copied.");
  } catch (error) {
    setStatus(error.message);
  }
});

openShareButton.addEventListener("click", () => {
  if (!shareUrlNode.value) {
    setStatus("No share link is available.");
    return;
  }

  window.open(shareUrlNode.value, "_blank", "noopener,noreferrer");
});

downloadButton.addEventListener("click", handleDownload);
shareButton.addEventListener("click", handleShare);
uploadsButton.addEventListener("click", openUploadsPage);
authButton.addEventListener("click", handleAuthButtonClick);

window.addEventListener("beforeunload", revokePreviewUrl);
window.addEventListener("beforeunload", () => {
  if (pendingTitleSaveTimer !== null) {
    clearTimeout(pendingTitleSaveTimer);
  }
});

loadPageState().catch((error) => {
  setStatus(error.message);
});
