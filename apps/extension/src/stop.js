const statusNode = document.getElementById("status");

function setStatus(message) {
  statusNode.textContent = message;
}

async function stopRecording() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "stop-recording" });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop recording");
    }

    setStatus("Stop signal sent. Saving will continue automatically.");
    window.setTimeout(() => window.close(), 500);
  } catch (error) {
    setStatus(error.message);
  }
}

stopRecording();
