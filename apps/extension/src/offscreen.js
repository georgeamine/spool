import { saveLatestRecording } from "./recording-store.js";
import {
  getDefaultRecordingTitle,
  titleToFileName
} from "./recording-title.js";

let mediaRecorder = null;
let recordedChunks = [];
let activeStream = null;
let activeDisplayStream = null;
let activeMicrophoneStream = null;
let activeCameraStream = null;
let activeCanvasStream = null;
let activeAudioContext = null;
let activeSettings = null;
let activeCanvasElement = null;
let activeDisplayVideoElement = null;
let activeCameraVideoElement = null;
let renderFrameHandle = null;
const DEFAULT_WEBCAM_POSITION = {
  x: 0,
  y: 1
};
const DEFAULT_WEBCAM_SIZE = 180;

async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function sendStatus(detail) {
  return sendMessage({
    type: "offscreen-status",
    payload: { detail }
  });
}

function getContainedRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  if (sourceAspect > targetAspect) {
    const width = targetWidth;
    const height = Math.round(width / sourceAspect);
    return {
      x: 0,
      y: Math.round((targetHeight - height) / 2),
      width,
      height
    };
  }

  const height = targetHeight;
  const width = Math.round(height * sourceAspect);
  return {
    x: Math.round((targetWidth - width) / 2),
    y: 0,
    width,
    height
  };
}

function buildTabConstraints(streamId) {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxFrameRate: 30
      }
    }
  };
}

async function getCaptureStream(source, streamId, requiresPickerForTabCapture = false) {
  if (source === "tab" && !requiresPickerForTabCapture) {
    return navigator.mediaDevices.getUserMedia(buildTabConstraints(streamId));
  }

  await sendStatus(
    requiresPickerForTabCapture
      ? "Choose a tab, window, or screen in the Chrome picker..."
      : "Choose a window or screen in the Chrome picker..."
  );
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: 30
    },
    audio: false
  });
}

async function getMicrophoneTrack() {
  const audioConstraints = activeSettings.microphoneDeviceId
    ? {
        deviceId: {
          exact: activeSettings.microphoneDeviceId
        }
      }
    : true;

  activeMicrophoneStream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints,
    video: false
  });

  return activeMicrophoneStream.getAudioTracks()[0] ?? null;
}

async function getCameraStream() {
  const videoConstraints = activeSettings.cameraDeviceId
    ? {
        deviceId: {
          exact: activeSettings.cameraDeviceId
        },
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        }
      }
    : {
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        }
      };

  activeCameraStream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false
  });

  return activeCameraStream;
}

async function createVideoElement(stream) {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.position = "fixed";
  video.style.left = "-99999px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  document.body.append(video);
  await video.play();
  return video;
}

function drawRoundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawCircle(context, centerX, centerY, radius) {
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.closePath();
}

function getOverlayScaleFromSize(size) {
  if (typeof size === "number" && Number.isFinite(size)) {
    return Math.min(Math.max(size / 1000, 0.12), 0.42);
  }

  if (size === "small") {
    return 0.14;
  }

  if (size === "large") {
    return 0.24;
  }

  return 0.18;
}

async function createOutputVideoTrack() {
  const displayTrack = activeDisplayStream.getVideoTracks()[0];
  const displaySettings = displayTrack.getSettings();
  const sourceWidth = displaySettings.width || 1280;
  const sourceHeight = displaySettings.height || 720;
  const width = Math.max(2, sourceWidth);
  const height = Math.max(2, sourceHeight);

  if (!activeDisplayVideoElement) {
    activeDisplayVideoElement = await createVideoElement(activeDisplayStream);
  }

  const shouldCompositeWebcam = activeSettings.webcam;
  if (shouldCompositeWebcam) {
    await getCameraStream();
    activeCameraVideoElement = await createVideoElement(activeCameraStream);
  }

  activeCanvasElement = document.createElement("canvas");
  activeCanvasElement.width = width;
  activeCanvasElement.height = height;

  const context = activeCanvasElement.getContext("2d");

  if (!context) {
    throw new Error("Unable to create canvas context for webcam composition");
  }

  const displayRect = getContainedRect(sourceWidth, sourceHeight, width, height);

  const webcamSize = activeSettings.webcamSize ?? DEFAULT_WEBCAM_SIZE;
  const overlayScale = getOverlayScaleFromSize(webcamSize);
  const overlayWidth = Math.round(width * overlayScale);
  const overlayHeight = overlayWidth;
  const margin = Math.max(20, Math.round(width * 0.02));
  const overlayRangeX = Math.max(0, width - overlayWidth - margin * 2);
  const overlayRangeY = Math.max(0, height - overlayHeight - margin * 2);
  const webcamPosition = activeSettings.webcamPosition ?? DEFAULT_WEBCAM_POSITION;
  const normalizedX = Number.isFinite(webcamPosition.x) ? Math.min(Math.max(webcamPosition.x, 0), 1) : 0;
  const normalizedY = Number.isFinite(webcamPosition.y) ? Math.min(Math.max(webcamPosition.y, 0), 1) : 1;
  const overlayX = margin + Math.round(overlayRangeX * normalizedX);
  const overlayY = margin + Math.round(overlayRangeY * normalizedY);
  const circleRadius = Math.round(overlayWidth / 2);
  const centerX = overlayX + circleRadius;
  const centerY = overlayY + circleRadius;

  const renderFrame = () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#000000";
    context.fillRect(0, 0, width, height);
    context.drawImage(
      activeDisplayVideoElement,
      displayRect.x,
      displayRect.y,
      displayRect.width,
      displayRect.height
    );

    if (shouldCompositeWebcam && activeCameraVideoElement) {
      context.save();
      drawCircle(context, centerX, centerY, circleRadius);
      context.clip();
      context.drawImage(activeCameraVideoElement, overlayX, overlayY, overlayWidth, overlayHeight);
      context.restore();
      context.lineWidth = 3;
      context.strokeStyle = "rgba(255, 255, 255, 0.92)";
      drawCircle(context, centerX, centerY, circleRadius);
      context.stroke();
    }

    renderFrameHandle = requestAnimationFrame(renderFrame);
  };

  renderFrame();
  activeCanvasStream = activeCanvasElement.captureStream(30);
  return activeCanvasStream.getVideoTracks()[0];
}

async function createRecordingStream(settings) {
  activeDisplayStream = await getCaptureStream(
    settings.source,
    settings.streamId,
    settings.requiresPickerForTabCapture
  );
  const videoTrack = activeDisplayStream.getVideoTracks()[0] ?? null;

  if (videoTrack && "contentHint" in videoTrack) {
    videoTrack.contentHint = "detail";
  }

  const tracks = videoTrack ? [videoTrack] : [];
  const displayAudioTracks = activeDisplayStream.getAudioTracks();
  const shouldMixAudio = displayAudioTracks.length > 0 || settings.microphone;

  if (!shouldMixAudio) {
    return new MediaStream(tracks);
  }

  activeAudioContext = new AudioContext();
  const destination = activeAudioContext.createMediaStreamDestination();

  if (displayAudioTracks.length > 0) {
    const displayAudioStream = new MediaStream(displayAudioTracks);
    const displaySource = activeAudioContext.createMediaStreamSource(displayAudioStream);
    displaySource.connect(destination);
  }

  if (settings.microphone) {
    const microphoneTrack = await getMicrophoneTrack();
    if (microphoneTrack) {
      const microphoneStream = new MediaStream([microphoneTrack]);
      const microphoneSource = activeAudioContext.createMediaStreamSource(microphoneStream);
      microphoneSource.connect(destination);
    }
  }

  destination.stream.getAudioTracks().forEach((track) => tracks.push(track));

  return new MediaStream(tracks);
}

function getTimestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getRecordingFileName() {
  return `spool-${getTimestampSlug()}.webm`;
}

function getRecorderBitrate(stream) {
  const videoTrack = stream.getVideoTracks()[0];
  const settings = videoTrack?.getSettings?.() ?? {};
  const width = settings.width ?? 1920;
  const height = settings.height ?? 1080;
  const pixels = width * height;

  if (pixels >= 3840 * 2160) {
    return 36000000;
  }

  if (pixels >= 2560 * 1440) {
    return 22000000;
  }

  if (pixels >= 1920 * 1080) {
    return 14000000;
  }

  return 8000000;
}

function getPreferredMimeTypes(stream, source, requiresPickerForTabCapture = false) {
  const hasAudioTrack = stream.getAudioTracks().length > 0;

  if (!hasAudioTrack) {
    return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  }

  return source === "tab" && !requiresPickerForTabCapture
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
}

async function persistRecordingForResult(blob, fileName, mimeType) {
  if (blob.size === 0) {
    throw new Error("Recording produced an empty file");
  }

  const createdAt = new Date().toISOString();
  const title = getDefaultRecordingTitle(createdAt);

  await sendStatus("Saving recording preview...");
  await saveLatestRecording({
    blob,
    createdAt,
    fileName: titleToFileName(title),
    mimeType,
    originalFileName: fileName,
    sizeBytes: blob.size,
    title
  });

  await sendMessage({
    type: "offscreen-recording-ready",
    payload: {
      detail: "Recording ready.",
      fileName,
      mimeType,
      sizeBytes: blob.size
    }
  });
}

function stopActiveTracks() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }

  if (activeDisplayStream) {
    activeDisplayStream.getTracks().forEach((track) => track.stop());
    activeDisplayStream = null;
  }

  if (activeMicrophoneStream) {
    activeMicrophoneStream.getTracks().forEach((track) => track.stop());
    activeMicrophoneStream = null;
  }

  if (activeCameraStream) {
    activeCameraStream.getTracks().forEach((track) => track.stop());
    activeCameraStream = null;
  }

  if (activeCanvasStream) {
    activeCanvasStream.getTracks().forEach((track) => track.stop());
    activeCanvasStream = null;
  }

  if (renderFrameHandle !== null) {
    cancelAnimationFrame(renderFrameHandle);
    renderFrameHandle = null;
  }

  if (activeDisplayVideoElement) {
    activeDisplayVideoElement.pause();
    activeDisplayVideoElement.srcObject = null;
    activeDisplayVideoElement.remove();
    activeDisplayVideoElement = null;
  }

  if (activeCameraVideoElement) {
    activeCameraVideoElement.pause();
    activeCameraVideoElement.srcObject = null;
    activeCameraVideoElement.remove();
    activeCameraVideoElement = null;
  }

  if (activeCanvasElement) {
    activeCanvasElement.remove();
    activeCanvasElement = null;
  }

  if (activeAudioContext) {
    activeAudioContext.close().catch(() => {});
    activeAudioContext = null;
  }
}

async function startRecording(settings) {
  if (mediaRecorder) {
    throw new Error("Recorder already active");
  }

  activeSettings = settings;
  recordedChunks = [];
  await sendStatus("Requesting capture stream...");
  activeStream = await createRecordingStream(settings);
  await sendStatus("Capture stream ready.");

  const preferredMimeTypes = getPreferredMimeTypes(
    activeStream,
    settings.source,
    settings.requiresPickerForTabCapture
  );
  const mimeType = preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));

  if (!mimeType) {
    throw new Error("No supported recording format is available.");
  }

  const mediaRecorderOptions = {
    mimeType,
    videoBitsPerSecond: getRecorderBitrate(activeStream)
  };

  if (activeStream.getAudioTracks().length > 0) {
    mediaRecorderOptions.audioBitsPerSecond = 128000;
  }

  mediaRecorder = new MediaRecorder(activeStream, mediaRecorderOptions);

  mediaRecorder.addEventListener("error", async (event) => {
    await sendMessage({
      type: "offscreen-recording-error",
      payload: {
        error: "MediaRecorder error",
        detail: event.error?.message || "MediaRecorder emitted an error event."
      }
    });
  });

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener("stop", async () => {
    try {
      await sendStatus("Recorder stop event fired.");
      stopActiveTracks();
      const blob = new Blob(recordedChunks, { type: mimeType });
      const fileName = getRecordingFileName();
      await sendStatus(`Blob assembled (${blob.size} bytes).`);

      if (blob.size === 0) {
        throw new Error("Recording produced an empty file");
      }

      await persistRecordingForResult(blob, fileName, mimeType);
    } catch (error) {
      await sendMessage({
        type: "offscreen-recording-error",
        payload: {
          error: error instanceof Error ? error.message : String(error),
          detail: "Recording pipeline failed."
        }
      });
    } finally {
      mediaRecorder = null;
      recordedChunks = [];
      activeSettings = null;
    }
  });

  mediaRecorder.start(1000);
  await sendStatus("MediaRecorder active.");
}

async function stopRecording() {
  if (!mediaRecorder) {
    throw new Error("Offscreen recorder was not active when stop was requested");
  }

  await sendStatus(
    `Stop requested. Recorder state: ${mediaRecorder.state}. Chunks buffered: ${recordedChunks.length}.`
  );

  if (mediaRecorder.state === "inactive") {
    throw new Error("Recorder was already inactive before stop");
  }

  await sendStatus("Stopping recorder...");
  mediaRecorder.requestData();
  mediaRecorder.stop();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "offscreen-start-recording") {
    startRecording(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "offscreen-stop-recording") {
    stopRecording()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
