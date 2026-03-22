const DEFAULT_SETTINGS = {
  source: "tab",
  webcam: false,
  microphone: true,
  cameraDeviceId: "",
  microphoneDeviceId: ""
};

const state = {
  status: "idle",
  activeSettings: null,
  lastError: null,
  detail: null
};
let stopTimeoutId = null;

async function setActionIdle() {
  await chrome.action.setPopup({ popup: "src/popup.html" });
  await chrome.action.setBadgeText({ text: "" });
}

async function setActionRecording() {
  await chrome.action.setPopup({ popup: "src/stop.html" });
  await chrome.action.setBadgeBackgroundColor({ color: "#bf5a2a" });
  await chrome.action.setBadgeText({ text: "REC" });
}

async function setActionSaving() {
  await chrome.action.setPopup({ popup: "src/popup.html" });
  await chrome.action.setBadgeBackgroundColor({ color: "#1c5d99" });
  await chrome.action.setBadgeText({ text: "DL" });
}

async function setActionStopping() {
  await chrome.action.setPopup({ popup: "src/popup.html" });
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

async function startRecording(settings) {
  if (state.status !== "idle") {
    throw new Error(`Recorder is busy: ${state.status}`);
  }

  const normalizedSettings = {
    ...DEFAULT_SETTINGS,
    ...settings
  };

  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error("No active tab available for capture");
  }

  await ensureOffscreenDocument();

  const streamId = normalizedSettings.source === "tab" ? await getTabStreamId(activeTab.id) : null;

  state.activeSettings = normalizedSettings;
  state.lastError = null;
  state.detail = "Starting recorder...";

  const response = await chrome.runtime.sendMessage({
    type: "offscreen-start-recording",
    payload: {
      ...normalizedSettings,
      streamId
    }
  });

  if (!response?.ok) {
    state.activeSettings = null;
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

chrome.runtime.onInstalled.addListener(() => {
  syncAction().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  syncAction().catch(console.error);
});

chrome.action.onClicked.addListener(() => {
  if (state.status === "recording") {
    stopRecording().catch(console.error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
        state.detail = null;
        await syncAction();
        sendResponse({ ok: false, error: error.message });
      });

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
        state.detail = null;
        await syncAction();
        sendResponse({ ok: false, error: error.message });
      });

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
    state.activeSettings = null;
    state.detail = message.payload.detail ?? "Recording saved locally.";
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

  if (message.type === "offscreen-recording-error") {
    clearStopTimeout();
    state.status = "idle";
    state.lastError = message.payload.error;
    state.activeSettings = null;
    state.detail = message.payload.detail ?? null;
    syncAction().catch(console.error);
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "offscreen-status") {
    state.detail = message.payload.detail;
    sendResponse({ ok: true });
    return;
  }
});
