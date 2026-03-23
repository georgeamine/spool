import { SHARE_API_BASE_URL } from "./share-config.js";
import {
  getValidAuthSession,
  saveAuthSession,
  signOutAuthSession
} from "./share-auth.js";
import {
  sanitizeRecordingTitle,
  titleToFileName
} from "./recording-title.js";
import { showToast } from "./toast.js";

const authButton = document.getElementById("authButton");
const authStatusNode = document.getElementById("authStatus");
const refreshButton = document.getElementById("refreshButton");
const signInGateNode = document.getElementById("signInGate");
const summaryPanelNode = document.getElementById("summaryPanel");
const videoCountNode = document.getElementById("videoCount");
const storageUsedNode = document.getElementById("storageUsed");
const emptyStateNode = document.getElementById("emptyState");
const uploadsListNode = document.getElementById("uploadsList");
const statusNode = document.getElementById("status");

let currentSession = null;
let uploads = [];
let storageBytesUsed = 0;
let pageBusy = false;
const savingTitleShareIds = new Set();

function setStatus(message) {
  statusNode.textContent = message;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
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

function formatDate(isoValue) {
  if (!isoValue) {
    return "Not available";
  }

  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return "Not available";
  }

  return parsed.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function escapeHtml(value) {
  return `${value || ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function syncAuthUi() {
  const signedIn = Boolean(currentSession?.accessToken);
  authButton.textContent = signedIn ? "Sign out" : "Sign in";
  authButton.disabled = pageBusy;
  refreshButton.disabled = !signedIn || pageBusy;

  if (signedIn) {
    authStatusNode.textContent = currentSession.email
      ? `Signed in as ${currentSession.email}`
      : "Signed in. Your recordings are ready.";
  } else {
    authStatusNode.textContent = "Sign in to see your recordings.";
  }
}

function renderUploads() {
  const signedIn = Boolean(currentSession?.accessToken);
  const hasUploads = uploads.length > 0;

  signInGateNode.hidden = signedIn;
  summaryPanelNode.hidden = !signedIn;
  emptyStateNode.hidden = !signedIn || hasUploads;
  uploadsListNode.hidden = !signedIn || !hasUploads;

  videoCountNode.textContent = `${uploads.length}`;
  storageUsedNode.textContent = formatBytes(storageBytesUsed);

  if (!signedIn || !hasUploads) {
    uploadsListNode.textContent = "";
    return;
  }

  uploadsListNode.innerHTML = uploads
    .map((upload) => {
      const shareUrl = upload.shareUrl ? escapeHtml(upload.shareUrl) : "";
      const shareActionsDisabled = !upload.shareUrl || pageBusy;
      const deleteDisabled = pageBusy ? "disabled" : "";
      const openCopyDisabled = shareActionsDisabled ? "disabled" : "";
      const titleDisabled = pageBusy || savingTitleShareIds.has(upload.shareId) ? "disabled" : "";
      const titleValue = escapeHtml(upload.title || upload.fileName);

      return `
        <article class="uploadCard" data-share-id="${upload.shareId}">
          <div class="cardTop">
            <div class="titleGroup">
              <input
                class="titleInput"
                type="text"
                value="${titleValue}"
                data-action="title"
                ${titleDisabled}
                maxlength="120"
              />
              <div class="metaValue">${escapeHtml(upload.fileName)}</div>
              <span class="statusBadge ${escapeHtml(upload.status)}">${escapeHtml(upload.status)}</span>
            </div>
          </div>
          <div class="metaGrid">
            <div>
              <div class="metaLabel">Size</div>
              <div class="metaValue">${escapeHtml(formatBytes(upload.sizeBytes))}</div>
            </div>
            <div>
              <div class="metaLabel">Uploaded</div>
              <div class="metaValue">${escapeHtml(formatDate(upload.completedAt || upload.createdAt))}</div>
            </div>
            <div>
              <div class="metaLabel">Created</div>
              <div class="metaValue">${escapeHtml(formatDate(upload.createdAt))}</div>
            </div>
          </div>
          <div class="shareLinkRow">
            <div class="linkLabel">Share link</div>
            <input class="shareLink" type="text" readonly value="${shareUrl}" ${
              upload.shareUrl ? "" : 'placeholder="No public link yet"'
            } />
          </div>
          <div class="cardActions">
            <button class="secondaryButton" type="button" data-action="copy" ${openCopyDisabled}>Copy link</button>
            <button class="secondaryButton" type="button" data-action="open" ${openCopyDisabled}>Open link</button>
            <button class="secondaryButton dangerButton" type="button" data-action="delete" ${deleteDisabled}>Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function syncUi() {
  syncAuthUi();
  renderUploads();
}

function setBusy(nextBusy) {
  pageBusy = Boolean(nextBusy);
  syncUi();
}

function getUploadByShareId(shareId) {
  return uploads.find((upload) => upload.shareId === shareId) || null;
}

function updateUpload(shareId, patch) {
  uploads = uploads.map((upload) => (upload.shareId === shareId ? { ...upload, ...patch } : upload));
}

async function fetchUploads() {
  if (!currentSession?.accessToken) {
    uploads = [];
    storageBytesUsed = 0;
    syncUi();
    return;
  }

  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${currentSession.accessToken}`
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to load uploads.");
  }

  uploads = Array.isArray(payload.recordings) ? payload.recordings : [];
  storageBytesUsed = Number(payload.storageBytesUsed || 0);
  syncUi();
}

async function loadUploads({ interactiveAuth = false } = {}) {
  currentSession = await getValidAuthSession({ interactive: interactiveAuth });
  syncUi();

  if (!currentSession?.accessToken) {
    uploads = [];
    storageBytesUsed = 0;
    syncUi();
    setStatus("Sign in to manage your recordings.");
    return;
  }

  setBusy(true);

  try {
    await fetchUploads();
    setStatus(uploads.length > 0 ? "Recordings ready." : "No recordings yet.");
  } catch (error) {
    if (error.message === "Authentication is required.") {
      currentSession = null;
      uploads = [];
      storageBytesUsed = 0;
      await saveAuthSession(null);
      syncUi();
    }

    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleAuthButtonClick() {
  if (currentSession?.accessToken) {
    currentSession = null;
    uploads = [];
    storageBytesUsed = 0;
    await signOutAuthSession();
    syncUi();
    setStatus("Signed out.");
    return;
  }

  setStatus("Opening sign-in...");
  currentSession = await getValidAuthSession({ interactive: true, forcePrompt: true });
  await loadUploads();
}

async function handleDeleteClick(shareId) {
  const upload = getUploadByShareId(shareId);
  if (!upload) {
    setStatus("Upload not found.");
    return;
  }

  const confirmed = window.confirm(`Delete "${upload.fileName}"? This also invalidates the share link.`);
  if (!confirmed) {
    return;
  }

  setBusy(true);
  setStatus("Deleting upload...");

  try {
    const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos/${shareId}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${currentSession.accessToken}`
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || "Failed to delete upload.");
    }

    uploads = uploads.filter((item) => item.shareId !== shareId);
    storageBytesUsed = Number(payload.storageBytesUsed || 0);
    syncUi();
    setStatus("Upload deleted.");
    showToast("Recording deleted.", "success");
  } catch (error) {
    setStatus(error.message);
    showToast(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function saveUploadTitle(shareId, nextTitle) {
  const upload = getUploadByShareId(shareId);
  if (!upload) {
    return;
  }

  const title = sanitizeRecordingTitle(nextTitle, "Untitled recording");
  const currentTitle = sanitizeRecordingTitle(upload.title || upload.fileName, "Untitled recording");
  if (title === currentTitle) {
    return;
  }

  savingTitleShareIds.add(shareId);

  try {
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
      throw new Error(payload?.error || "Failed to save recording title.");
    }

    updateUpload(shareId, {
      title: payload.title,
      fileName: payload.fileName,
      updatedAt: payload.updatedAt
    });
    syncUi();
    showToast("Title saved.", "success");
  } catch (error) {
    syncUi();
    showToast(error.message, "error");
    throw error;
  } finally {
    savingTitleShareIds.delete(shareId);
    syncUi();
  }
}

uploadsListNode.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const cardNode = button.closest("[data-share-id]");
  const shareId = cardNode?.dataset.shareId || "";
  const upload = getUploadByShareId(shareId);
  if (!upload) {
    setStatus("Upload not found.");
    return;
  }

  const action = button.dataset.action;
  if (action === "copy") {
    try {
      await navigator.clipboard.writeText(upload.shareUrl);
      setStatus("Share link copied.");
      showToast("Share link copied.", "success");
    } catch (error) {
      setStatus(error.message);
      showToast(error.message, "error");
    }
    return;
  }

  if (action === "open") {
    window.open(upload.shareUrl, "_blank", "noopener,noreferrer");
    return;
  }

  if (action === "delete") {
    await handleDeleteClick(shareId);
  }
});

uploadsListNode.addEventListener("keydown", (event) => {
  const titleField = event.target.closest('input[data-action="title"]');
  if (!titleField) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    titleField.blur();
  }
});

uploadsListNode.addEventListener("focusout", (event) => {
  const titleField = event.target.closest('input[data-action="title"]');
  if (!titleField) {
    return;
  }

  const cardNode = titleField.closest("[data-share-id]");
  const shareId = cardNode?.dataset.shareId || "";
  saveUploadTitle(shareId, titleField.value).catch((error) => {
    setStatus(error.message);
  });
});

refreshButton.addEventListener("click", () => {
  loadUploads().catch((error) => {
    setStatus(error.message);
    showToast(error.message, "error");
  });
});

authButton.addEventListener("click", () => {
  handleAuthButtonClick().catch((error) => {
    setStatus(error.message);
    showToast(error.message, "error");
  });
});

loadUploads().catch((error) => {
  setStatus(error.message);
  showToast(error.message, "error");
});
