const DEFAULT_SETTINGS = {
  source: "tab",
  webcam: false,
  microphone: false,
  cameraDeviceId: "",
  microphoneDeviceId: "",
  recordingFormat: "webm"
};

const overlayRoot = document.getElementById("overlayRoot");
const form = document.getElementById("recording-form");
const mainHeaderCopy = document.getElementById("mainHeaderCopy");
const settingsHeaderCopy = document.getElementById("settingsHeaderCopy");
const backButton = document.getElementById("backButton");
const settingsButton = document.getElementById("settingsButton");
const closeButton = document.getElementById("closeButton");
const mainPane = document.getElementById("mainPane");
const settingsPane = document.getElementById("settingsPane");
const sourceInput = document.getElementById("source");
const webcamModeInput = document.getElementById("webcamMode");
const microphoneModeInput = document.getElementById("microphoneMode");
const recordingFormatInput = document.getElementById("recordingFormat");
const submitButton = document.getElementById("submit-button");
const statusNode = document.getElementById("status");
const microphoneLevelNode = microphoneModeInput;

let availableDevices = {
  audioinput: [],
  videoinput: []
};
let microphonePreviewStream = null;
let microphonePreviewContext = null;
let microphonePreviewAnalyser = null;
let microphonePreviewAnimationFrame = null;
let microphonePreviewData = null;
let panelMode = "main";

async function getStoredSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    source: stored.source,
    webcam: stored.webcam,
    microphone: stored.microphone,
    cameraDeviceId: stored.cameraDeviceId,
    microphoneDeviceId: stored.microphoneDeviceId,
    recordingFormat: "webm"
  };
}

async function getState() {
  return chrome.runtime.sendMessage({ type: "get-state" });
}

async function getRecordingContext() {
  return chrome.runtime.sendMessage({ type: "get-recording-context" });
}

function setStatus(message) {
  statusNode.textContent = message;
}

function buildDeviceLabel(device, index, fallbackPrefix) {
  return device.label || `${fallbackPrefix} ${index + 1}`;
}

function fillSelectOptions(selectNode, options, selectedValue) {
  selectNode.textContent = "";
  options.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    selectNode.append(option);
  });

  const hasSelectedValue = options.some((item) => item.value === selectedValue);
  selectNode.value = hasSelectedValue ? selectedValue : options[0]?.value ?? "";
}

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  availableDevices = {
    audioinput: devices.filter((device) => device.kind === "audioinput"),
    videoinput: devices.filter((device) => device.kind === "videoinput")
  };
}

function stopStreamTracks(stream) {
  stream.getTracks().forEach((track) => track.stop());
}

function setMicrophoneLevel(level) {
  const normalized = Math.max(0, Math.min(level, 1));
  microphoneLevelNode.style.setProperty("--level", `${Math.round(normalized * 100)}%`);
}

function stopMicrophonePreview() {
  if (microphonePreviewAnimationFrame !== null) {
    cancelAnimationFrame(microphonePreviewAnimationFrame);
    microphonePreviewAnimationFrame = null;
  }

  if (microphonePreviewStream) {
    stopStreamTracks(microphonePreviewStream);
    microphonePreviewStream = null;
  }

  if (microphonePreviewContext) {
    microphonePreviewContext.close().catch(() => {});
    microphonePreviewContext = null;
  }

  microphonePreviewAnalyser = null;
  microphonePreviewData = null;
  setMicrophoneLevel(0);
}

function startMicrophoneLevelLoop() {
  if (!microphonePreviewAnalyser || !microphonePreviewData) {
    return;
  }

  let smoothedLevel = 0;

  const tick = () => {
    if (!microphonePreviewAnalyser || !microphonePreviewData) {
      return;
    }

    microphonePreviewAnalyser.getByteTimeDomainData(microphonePreviewData);

    let sum = 0;
    for (let index = 0; index < microphonePreviewData.length; index += 1) {
      const centered = (microphonePreviewData[index] - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / microphonePreviewData.length);
    const boostedLevel = Math.min(1, rms * 6);
    smoothedLevel = smoothedLevel * 0.72 + boostedLevel * 0.28;
    setMicrophoneLevel(smoothedLevel);
    microphonePreviewAnimationFrame = requestAnimationFrame(tick);
  };

  tick();
}

async function startMicrophonePreview(deviceId) {
  stopMicrophonePreview();

  const audioConstraints = deviceId
    ? {
        deviceId: { exact: deviceId }
      }
    : true;

  microphonePreviewStream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false
  });

  microphonePreviewContext = new AudioContext();
  microphonePreviewAnalyser = microphonePreviewContext.createAnalyser();
  microphonePreviewAnalyser.fftSize = 256;
  microphonePreviewAnalyser.smoothingTimeConstant = 0.8;
  microphonePreviewData = new Uint8Array(microphonePreviewAnalyser.frequencyBinCount);

  const sourceNode = microphonePreviewContext.createMediaStreamSource(microphonePreviewStream);
  sourceNode.connect(microphonePreviewAnalyser);
  startMicrophoneLevelLoop();
}

async function ensureMediaPermission(kind) {
  if (kind === "video") {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
    stopStreamTracks(stream);
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false
  });
  stopStreamTracks(stream);
}

function buildWebcamOptions() {
  const options = [{ value: "off", label: "Off" }];
  availableDevices.videoinput.forEach((device, index) => {
    options.push({
      value: device.deviceId,
      label: buildDeviceLabel(device, index, "Camera")
    });
  });
  return options;
}

function buildMicrophoneOptions() {
  const options = [{ value: "off", label: "Off" }];
  availableDevices.audioinput.forEach((device, index) => {
    options.push({
      value: device.deviceId,
      label: buildDeviceLabel(device, index, "Microphone")
    });
  });
  return options;
}

function getSelectedWebcamMode(settings) {
  if (!settings.webcam) {
    return "off";
  }

  return settings.cameraDeviceId || "off";
}

function getSelectedMicrophoneMode(settings) {
  if (!settings.microphone) {
    return "off";
  }

  return settings.microphoneDeviceId || "off";
}

function syncSelectOptions(settings) {
  fillSelectOptions(webcamModeInput, buildWebcamOptions(), getSelectedWebcamMode(settings));
  fillSelectOptions(
    microphoneModeInput,
    buildMicrophoneOptions(),
    getSelectedMicrophoneMode(settings)
  );
}

function readSettingsFromForm() {
  return {
    source: sourceInput.value,
    webcam: webcamModeInput.value !== "off",
    microphone: microphoneModeInput.value !== "off",
    cameraDeviceId: webcamModeInput.value === "off" ? "" : webcamModeInput.value,
    microphoneDeviceId: microphoneModeInput.value === "off" ? "" : microphoneModeInput.value,
    recordingFormat: "webm"
  };
}

function setDisabled(disabled) {
  sourceInput.disabled = disabled;
  webcamModeInput.disabled = disabled;
  microphoneModeInput.disabled = disabled;
  recordingFormatInput.disabled = disabled;
  submitButton.disabled = disabled;
}

function setPanelMode(nextMode) {
  panelMode = nextMode === "settings" ? "settings" : "main";
  const showSettings = panelMode === "settings";
  overlayRoot.dataset.mode = panelMode;
  mainPane.hidden = showSettings;
  settingsPane.hidden = !showSettings;
  mainHeaderCopy.hidden = showSettings;
  settingsHeaderCopy.hidden = !showSettings;
  settingsButton.hidden = showSettings;
  backButton.hidden = !showSettings;
  closeButton.hidden = showSettings;
}

async function syncWebcamPreview() {
  const settings = readSettingsFromForm();
  const previewEnabled = settings.webcam;
  const response = await chrome.runtime.sendMessage({
    type: "sync-webcam-preview",
    payload: {
      enabled: previewEnabled,
      cameraDeviceId: settings.cameraDeviceId
    }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to sync webcam preview");
  }
}

async function hideOverlay() {
  stopMicrophonePreview();
  await chrome.runtime.sendMessage({ type: "hide-page-overlay" });
}

function getIdleStatus(state) {
  if (!state.lastError && !state.detail) {
    return "Configure the capture source and start recording.";
  }

  if (state.lastError && state.detail) {
    return `${state.lastError} Last step: ${state.detail}`;
  }

  return state.lastError || state.detail;
}

async function hydrate() {
  const [settings, state, context] = await Promise.all([
    getStoredSettings(),
    getState(),
    getRecordingContext()
  ]);

  sourceInput.value = settings.source;
  recordingFormatInput.value = settings.recordingFormat || DEFAULT_SETTINGS.recordingFormat;

  await loadDevices();
  syncSelectOptions(settings);
  if (getSelectedMicrophoneMode(settings) !== "off") {
    try {
      await startMicrophonePreview(settings.microphoneDeviceId);
    } catch {
      stopMicrophonePreview();
    }
  } else {
    stopMicrophonePreview();
  }

  if (!context?.isRecordable && state.status === "idle") {
    setStatus(context?.message || "Recording is not available on this page.");
    setDisabled(true);
    return;
  }

  if (state.status === "idle") {
    await syncWebcamPreview();
    setDisabled(false);
    submitButton.textContent = "Start recording";
    setStatus(getIdleStatus(state));
    return;
  }

  if (state.status === "saving") {
    setStatus(state.detail || "Saving recording to local disk...");
  } else if (state.status === "stopping") {
    setStatus(state.detail || "Finalizing recording before local save starts...");
  } else if (state.status === "recording") {
    setStatus(state.detail || "Recording in progress. Click the extension icon again to stop.");
  } else {
    setStatus(`Current state: ${state.status}`);
  }

  setDisabled(true);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setDisabled(true);
  setStatus("Starting recording...");

  const settings = {
    ...readSettingsFromForm()
  };

  try {
    await chrome.storage.local.set(settings);
    const response = await chrome.runtime.sendMessage({
      type: "start-recording",
      payload: settings
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start recording");
    }
  } catch (error) {
    setDisabled(false);
    setStatus(error.message);
  }
});

closeButton.addEventListener("click", () => {
  hideOverlay().catch((error) => {
    setStatus(error.message);
  });
});

settingsButton.addEventListener("click", () => {
  setPanelMode("settings");
});

backButton.addEventListener("click", () => {
  setPanelMode("main");
});

recordingFormatInput.addEventListener("change", async () => {
  try {
    await chrome.storage.local.set({
      recordingFormat: "webm"
    });
    recordingFormatInput.value = "webm";
    setStatus("Recording format set to WEBM.");
  } catch (error) {
    setStatus(error.message);
  }
});

sourceInput.addEventListener("change", async () => {
  try {
    await syncWebcamPreview();
    setStatus("Configure the capture source and start recording.");
  } catch (error) {
    setStatus(error.message);
  }
});

webcamModeInput.addEventListener("change", async () => {
  try {
    if (webcamModeInput.value !== "off") {
      await ensureMediaPermission("video");
      await loadDevices();
      syncSelectOptions(readSettingsFromForm());
      if (!buildWebcamOptions().some((option) => option.value === webcamModeInput.value)) {
        webcamModeInput.value = "off";
      }
    }

    await syncWebcamPreview();
    setStatus("Configure the capture source and start recording.");
  } catch (error) {
    webcamModeInput.value = "off";
    setStatus(error.message);
  }
});

microphoneModeInput.addEventListener("change", async () => {
  try {
    if (microphoneModeInput.value !== "off") {
      await startMicrophonePreview(microphoneModeInput.value);
      await loadDevices();
      syncSelectOptions(readSettingsFromForm());
      if (!buildMicrophoneOptions().some((option) => option.value === microphoneModeInput.value)) {
        microphoneModeInput.value = "off";
      }
    } else {
      stopMicrophonePreview();
    }

    setStatus("Configure the capture source and start recording.");
  } catch (error) {
    stopMicrophonePreview();
    microphoneModeInput.value = "off";
    setStatus(error.message);
  }
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    const settings = readSettingsFromForm();
    loadDevices()
      .then(() => {
        syncSelectOptions(settings);
      })
      .catch(() => {});
  });
}

hydrate().catch((error) => {
  setStatus(error.message);
});

setPanelMode("main");

window.addEventListener("beforeunload", () => {
  stopMicrophonePreview();
});
