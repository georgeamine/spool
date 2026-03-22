const DEFAULT_SETTINGS = {
  source: "tab",
  webcam: false,
  microphone: true,
  cameraDeviceId: "",
  microphoneDeviceId: ""
};

const form = document.getElementById("recording-form");
const sourceInput = document.getElementById("source");
const sourceButtons = Array.from(document.querySelectorAll("[data-source-button]"));
const webcamInput = document.getElementById("webcam");
const microphoneInput = document.getElementById("microphone");
const cameraDeviceField = document.getElementById("cameraDeviceField");
const microphoneDeviceField = document.getElementById("microphoneDeviceField");
const cameraDeviceIdInput = document.getElementById("cameraDeviceId");
const microphoneDeviceIdInput = document.getElementById("microphoneDeviceId");
const submitButton = document.getElementById("submit-button");
const statusNode = document.getElementById("status");

let availableDevices = {
  audioinput: [],
  videoinput: []
};

async function getStoredSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    source: stored.source,
    webcam: stored.webcam,
    microphone: stored.microphone,
    cameraDeviceId: stored.cameraDeviceId,
    microphoneDeviceId: stored.microphoneDeviceId
  };
}

async function getState() {
  return chrome.runtime.sendMessage({ type: "get-state" });
}

function setStatus(message) {
  statusNode.textContent = message;
}

function formatIdleStatus(state) {
  if (!state.lastError && !state.detail) {
    return "Configure the capture source and start recording.";
  }

  if (state.lastError && state.detail) {
    return `${state.lastError} Last step: ${state.detail}`;
  }

  return state.lastError || state.detail;
}

function updateSourceButtons() {
  sourceButtons.forEach((button) => {
    button.classList.toggle("isSelected", button.dataset.sourceButton === sourceInput.value);
  });
}

function buildDeviceLabel(device, index, fallbackPrefix) {
  return device.label || `${fallbackPrefix} ${index + 1}`;
}

function populateDeviceSelect(selectNode, devices, selectedId, fallbackPrefix) {
  const currentValue = selectedId || selectNode.value;
  selectNode.textContent = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = `Default ${fallbackPrefix.toLowerCase()}`;
  selectNode.append(defaultOption);

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = buildDeviceLabel(device, index, fallbackPrefix);
    selectNode.append(option);
  });

  const hasSelectedDevice = devices.some((device) => device.deviceId === currentValue);
  selectNode.value = hasSelectedDevice ? currentValue : "";
}

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  availableDevices = {
    audioinput: devices.filter((device) => device.kind === "audioinput"),
    videoinput: devices.filter((device) => device.kind === "videoinput")
  };

  populateDeviceSelect(
    microphoneDeviceIdInput,
    availableDevices.audioinput,
    microphoneDeviceIdInput.value,
    "Microphone"
  );
  populateDeviceSelect(
    cameraDeviceIdInput,
    availableDevices.videoinput,
    cameraDeviceIdInput.value,
    "Camera"
  );
}

function syncFormVisibility(forceDisabled = false) {
  cameraDeviceField.hidden = !webcamInput.checked;
  microphoneDeviceField.hidden = !microphoneInput.checked;
  cameraDeviceIdInput.disabled = forceDisabled || !webcamInput.checked;
  microphoneDeviceIdInput.disabled = forceDisabled || !microphoneInput.checked;
}

function setDisabled(disabled) {
  sourceButtons.forEach((button) => {
    button.disabled = disabled;
  });
  webcamInput.disabled = disabled;
  microphoneInput.disabled = disabled;
  submitButton.disabled = disabled;
  syncFormVisibility(disabled);
}

async function hydrate() {
  const [settings, state] = await Promise.all([getStoredSettings(), getState()]);

  sourceInput.value = settings.source;
  webcamInput.checked = settings.webcam;
  microphoneInput.checked = settings.microphone;
  updateSourceButtons();
  syncFormVisibility(false);

  await loadDevices();
  cameraDeviceIdInput.value = settings.cameraDeviceId;
  microphoneDeviceIdInput.value = settings.microphoneDeviceId;

  if (state.status === "idle") {
    setStatus(formatIdleStatus(state));
    setDisabled(false);
    submitButton.textContent = "Start recording";
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
    source: sourceInput.value,
    webcam: webcamInput.checked,
    microphone: microphoneInput.checked,
    cameraDeviceId: cameraDeviceIdInput.value,
    microphoneDeviceId: microphoneDeviceIdInput.value
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

    window.close();
  } catch (error) {
    setDisabled(false);
    setStatus(error.message);
  }
});

sourceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sourceInput.value = button.dataset.sourceButton;
    updateSourceButtons();
  });
});

webcamInput.addEventListener("change", () => {
  syncFormVisibility(submitButton.disabled);
});

microphoneInput.addEventListener("change", () => {
  syncFormVisibility(submitButton.disabled);
});

hydrate().catch((error) => {
  setStatus(error.message);
});
