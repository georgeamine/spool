const DEFAULT_SETTINGS = {
  source: "tab",
  webcam: false,
  microphone: false,
  cameraDeviceId: "",
  microphoneDeviceId: "",
  recordingFormat: "webm",
  webcamSize: 180,
  webcamPosition: {
    x: 0,
    y: 1
  }
};

const state = {
  status: "idle",
  activeSettings: null,
  recordingTabId: null,
  overlayTabId: null,
  overlayRequiresPickerForTabCapture: false,
  lastError: null,
  detail: null
};
let stopTimeoutId = null;
const PAGE_OVERLAY_MESSAGE_TYPE = "spool-toggle-page-overlay";
const PAGE_OVERLAY_HIDE_MESSAGE_TYPE = "spool-hide-page-overlay";
const FALLBACK_OVERLAY_URL = "https://www.google.com/";

async function setActionIdle() {
  await chrome.action.setPopup({ popup: "" });
  await chrome.action.setBadgeText({ text: "" });
}

async function setActionRecording() {
  await chrome.action.setPopup({ popup: "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#bf5a2a" });
  await chrome.action.setBadgeText({ text: "REC" });
}

async function setActionSaving() {
  await chrome.action.setPopup({ popup: "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#1c5d99" });
  await chrome.action.setBadgeText({ text: "DL" });
}

async function setActionStopping() {
  await chrome.action.setPopup({ popup: "" });
  await chrome.action.setBadgeText({ text: "" });
}

function clearStopTimeout() {
  if (stopTimeoutId !== null) {
    clearTimeout(stopTimeoutId);
    stopTimeoutId = null;
  }
}

function armStopTimeout() {
  clearStopTimeout();
  stopTimeoutId = setTimeout(async () => {
    if (state.status === "stopping") {
      state.status = "idle";
      state.lastError = "Recording stopped, but local save did not start.";
      state.activeSettings = null;
      state.recordingTabId = null;
      await syncAction();
    }
  }, 10000);
}

async function syncAction() {
  if (state.status === "recording") {
    await setActionRecording();
    return;
  }

  if (state.status === "stopping") {
    await setActionStopping();
    return;
  }

  if (state.status === "saving") {
    await setActionSaving();
    return;
  }

  await setActionIdle();
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen.hasDocument) {
    const hasDocument = await chrome.offscreen.hasDocument();

    if (hasDocument) {
      return;
    }
  }

  await chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.DISPLAY_MEDIA],
    justification: "Record tab capture or display media while the popup is closed"
  });
}

function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]);
}

function getTabStreamId(tabId) {
  return chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
}

function isPreviewableTab(tab) {
  if (!tab?.id || !tab.url) {
    return false;
  }

  return tab.url.startsWith("http://") || tab.url.startsWith("https://");
}

function isOverlayBlockedError(error) {
  const message = error?.message || "";
  return (
    message.includes("Cannot access contents of the page") ||
    message.includes("The extensions gallery cannot be scripted") ||
    message.includes("Missing host permission")
  );
}

function setOverlayContext({ tabId = null, requiresPickerForTabCapture = false } = {}) {
  state.overlayTabId = tabId;
  state.overlayRequiresPickerForTabCapture = Boolean(tabId && requiresPickerForTabCapture);
}

function clearOverlayContext() {
  setOverlayContext();
}

function shouldUsePickerForTabCapture(tabId) {
  return state.overlayTabId === tabId && state.overlayRequiresPickerForTabCapture;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };

    const handleUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      cleanup();
      resolve(tab);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out while opening the fallback tab"));
    }, 15000);

    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab?.status === "complete") {
          cleanup();
          resolve(tab);
          return;
        }

        chrome.tabs.onUpdated.addListener(handleUpdated);
      })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}

async function getRecordingContext() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id) {
    return {
      isRecordable: false,
      message: "No active tab available for recording."
    };
  }

  if (!isPreviewableTab(activeTab)) {
    return {
      isRecordable: false,
      message: "Recording only works on regular web pages, not Chrome pages like New Tab, Extensions, or Settings."
    };
  }

  return {
    isRecordable: true,
    message: null,
    requiresPickerForTabCapture: shouldUsePickerForTabCapture(activeTab.id)
  };
}

async function sendPageOverlayMessage(tabId, type, payload = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type,
      payload
    });
  } catch (error) {
    if (!error.message?.includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/page-overlay.js"]
    });

    return chrome.tabs.sendMessage(tabId, {
      type,
      payload
    });
  }
}

async function openPageOverlay(tabId, payload = {}, overlayContext = {}) {
  const response = await sendPageOverlayMessage(tabId, PAGE_OVERLAY_MESSAGE_TYPE, payload);
  if (response?.isOpen === false) {
    clearOverlayContext();
    return;
  }

  setOverlayContext({
    tabId,
    requiresPickerForTabCapture: overlayContext.requiresPickerForTabCapture
  });
}

async function openFallbackOverlay() {
  const fallbackTab = await chrome.tabs.create({
    url: FALLBACK_OVERLAY_URL,
    active: true
  });

  if (!fallbackTab?.id) {
    throw new Error("Failed to open a fallback tab for the recorder");
  }

  try {
    await waitForTabLoad(fallbackTab.id);
    await openPageOverlay(
      fallbackTab.id,
      { forceOpen: true },
      { requiresPickerForTabCapture: true }
    );
  } catch (error) {
    await chrome.tabs.remove(fallbackTab.id).catch(() => {});
    throw error;
  }
}

async function syncWebcamPreview({ enabled, cameraDeviceId, tabId = null }) {
  const targetTab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : await getActiveTab();
  if (!targetTab?.id) {
    throw new Error("No active tab available for webcam preview");
  }

  if (!isPreviewableTab(targetTab)) {
    if (!enabled) {
      return { ok: true };
    }

    throw new Error("Webcam preview is only available on regular web pages");
  }

  await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    files: ["src/webcam-preview.js"]
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    func: async (payload) => {
      if (typeof globalThis.__spoolSyncWebcamPreview !== "function") {
        throw new Error("Webcam preview controller was not initialized");
      }

      return globalThis.__spoolSyncWebcamPreview(payload);
    },
    args: [
      {
        enabled,
        cameraDeviceId
      }
    ]
  });

  const response = results?.[0]?.result;

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to sync webcam preview");
  }

  return response;
}

async function stopRecordingPreview() {
  if (!state.recordingTabId) {
    return;
  }

  await syncWebcamPreview({
    enabled: false,
    cameraDeviceId: "",
    tabId: state.recordingTabId
  }).catch(() => {});
}

async function hidePageOverlay(tabId) {
  try {
    await sendPageOverlayMessage(tabId, PAGE_OVERLAY_HIDE_MESSAGE_TYPE);
    if (state.overlayTabId === tabId) {
      clearOverlayContext();
    }
  } catch (error) {
    if (
      error.message?.includes("Cannot access contents of the page") ||
      error.message?.includes("The extensions gallery cannot be scripted")
    ) {
      return;
    }

    throw error;
  }
}

async function togglePageOverlay() {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error("No active tab available for recording");
  }

  if (!isPreviewableTab(activeTab)) {
    await openFallbackOverlay();
    return;
  }

  try {
    await openPageOverlay(activeTab.id);
  } catch (error) {
    if (!isOverlayBlockedError(error)) {
      throw error;
    }

    await openFallbackOverlay();
  }
}

async function startRecording(settings) {
  if (state.status !== "idle") {
    throw new Error(`Recorder is busy: ${state.status}`);
  }

  const context = await getRecordingContext();
  if (!context.isRecordable) {
    throw new Error(context.message);
  }

  const stored = await chrome.storage.local.get({
    webcamSize: DEFAULT_SETTINGS.webcamSize,
    webcamPosition: DEFAULT_SETTINGS.webcamPosition
  });

  const normalizedSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    webcamSize: stored.webcamSize ?? DEFAULT_SETTINGS.webcamSize,
    webcamPosition: stored.webcamPosition ?? DEFAULT_SETTINGS.webcamPosition
  };

  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error("No active tab available for capture");
  }

  state.activeSettings = normalizedSettings;
  state.recordingTabId = activeTab.id;
  state.lastError = null;
  state.detail = "Preparing page for capture...";

  try {
    await hidePageOverlay(activeTab.id);
  } catch {}

  await new Promise((resolve) => setTimeout(resolve, 120));
  await ensureOffscreenDocument();

  const requiresPickerForTabCapture =
    normalizedSettings.source === "tab" && shouldUsePickerForTabCapture(activeTab.id);
  const streamId =
    normalizedSettings.source === "tab" && !requiresPickerForTabCapture
      ? await getTabStreamId(activeTab.id)
      : null;

  state.detail = "Starting recorder...";

  const response = await chrome.runtime.sendMessage({
    type: "offscreen-start-recording",
    payload: {
      ...normalizedSettings,
      requiresPickerForTabCapture,
      streamId
    }
  });

  if (!response?.ok) {
    state.activeSettings = null;
    state.recordingTabId = null;
    throw new Error(response?.error || "Failed to start offscreen recorder");
  }

  state.status = "recording";
  state.detail = "Recorder started.";
  await syncAction();
}

async function stopRecording() {
  if (state.status !== "recording") {
    return;
  }

  state.status = "stopping";
  state.detail = "Stop signal sent to recorder.";
  await syncAction();
  await stopRecordingPreview();
  const response = await chrome.runtime.sendMessage({ type: "offscreen-stop-recording" });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to stop recorder");
  }

  armStopTimeout();
}

async function saveRecordingLocally({ blobUrl, filename }) {
  const downloadId = await chrome.downloads.download({
    url: blobUrl,
    filename,
    saveAs: false
  });

  if (typeof downloadId !== "number") {
    throw new Error("Chrome did not return a download id");
  }

  return downloadId;
}

async function openRecordingResultPage() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("src/recording-result.html")
  });
}

chrome.runtime.onInstalled.addListener(() => {
  syncAction().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  syncAction().catch(console.error);
});

chrome.tabs.onActivated.addListener(() => {
  if (state.status === "idle") {
    syncAction().catch(console.error);
  }
});

chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, _tab) => {
  if (state.status === "idle") {
    syncAction().catch(console.error);
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  if (state.status === "idle") {
    syncAction().catch(console.error);
  }
});

chrome.action.onClicked.addListener(() => {
  if (state.status === "recording") {
    stopRecording().catch(console.error);
    return;
  }

  togglePageOverlay().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-recording-context") {
    getRecordingContext()
      .then((context) => sendResponse(context))
      .catch((error) =>
        sendResponse({
          isRecordable: false,
          message: error.message
        })
      );
    return true;
  }

  if (message.type === "get-state") {
    sendResponse({
      status: state.status,
      lastError: state.lastError,
      detail: state.detail
    });
    return;
  }

  if (message.type === "start-recording") {
    startRecording(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        clearStopTimeout();
        state.status = "idle";
        state.lastError = error.message;
        state.activeSettings = null;
        state.recordingTabId = null;
        state.detail = null;
        clearOverlayContext();
        await syncAction();
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message.type === "hide-page-overlay") {
    getActiveTab()
      .then((tab) => {
        if (!tab?.id) {
          throw new Error("No active tab available");
        }

        return hidePageOverlay(tab.id);
      })
      .then(() => {
        if (state.status !== "recording") {
          return syncWebcamPreview({
            enabled: false,
            cameraDeviceId: ""
          }).catch(() => {});
        }

        return null;
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "stop-recording") {
    stopRecording()
      .then(() => sendResponse({ ok: true }))
      .catch(async (error) => {
        clearStopTimeout();
        state.status = "idle";
        state.lastError = error.message;
        state.activeSettings = null;
        state.recordingTabId = null;
        state.detail = null;
        clearOverlayContext();
        await syncAction();
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message.type === "sync-webcam-preview") {
    syncWebcamPreview(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "offscreen-save-started") {
    clearStopTimeout();
    state.status = "saving";
    state.lastError = null;
    state.detail = message.payload.detail ?? "Saving recording to disk...";
    syncAction().catch(console.error);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen-save-complete") {
    clearStopTimeout();
    state.status = "idle";
    state.lastError = null;
    stopRecordingPreview().catch(() => {});
    state.activeSettings = null;
    state.recordingTabId = null;
    state.detail = message.payload.detail ?? "Recording saved locally.";
    clearOverlayContext();
    syncAction().catch(console.error);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen-recording-ready") {
    clearStopTimeout();
    state.status = "idle";
    state.lastError = null;
    stopRecordingPreview().catch(() => {});
    state.activeSettings = null;
    state.recordingTabId = null;
    state.detail = message.payload.detail ?? "Recording ready.";
    clearOverlayContext();
    syncAction()
      .then(() => openRecordingResultPage())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "offscreen-recording-error") {
    clearStopTimeout();
    state.status = "idle";
    state.lastError = message.payload.error;
    stopRecordingPreview().catch(() => {});
    state.activeSettings = null;
    state.recordingTabId = null;
    state.detail = message.payload.detail ?? null;
    clearOverlayContext();
    syncAction().catch(console.error);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "save-recording-locally") {
    saveRecordingLocally(message.payload)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "offscreen-status") {
    state.detail = message.payload.detail;
    sendResponse({ ok: true });
    return;
  }
});
