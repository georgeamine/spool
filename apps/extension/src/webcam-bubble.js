const video = document.getElementById("video");

function getCameraDeviceId() {
  const url = new URL(window.location.href);
  return url.searchParams.get("cameraDeviceId") || "";
}

async function start() {
  const cameraDeviceId = getCameraDeviceId();
  const videoConstraints = cameraDeviceId
    ? {
        deviceId: { exact: cameraDeviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    : {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };

  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false
  });

  video.srcObject = stream;
  await video.play();
}

start().catch((error) => {
  console.error("Spool webcam bubble failed:", error);
});
