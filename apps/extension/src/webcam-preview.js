if (!globalThis.__spoolWebcamPreviewModuleLoaded) {
  globalThis.__spoolWebcamPreviewModuleLoaded = true;

  const PREVIEW_CONTAINER_ID = "spool-webcam-preview";
  const PREVIEW_SHELL_ID = "spool-webcam-preview-shell";
  const PREVIEW_FRAME_ID = "spool-webcam-preview-frame";
  const PREVIEW_STYLE_ID = "spool-webcam-preview-style";
  const PREVIEW_STORAGE_DEFAULTS = {
    webcamSize: 180,
    webcamPosition: {
      x: 0,
      y: 1
    }
  };
  const PREVIEW_MIN_SIZE = 112;
  const PREVIEW_MAX_SIZE = 480;

function getPreviewState() {
  if (!globalThis.__spoolWebcamPreviewState) {
    globalThis.__spoolWebcamPreviewState = {
      size: PREVIEW_STORAGE_DEFAULTS.webcamSize,
      position: PREVIEW_STORAGE_DEFAULTS.webcamPosition,
      cleanupResizeListener: null
    };
  }

  return globalThis.__spoolWebcamPreviewState;
}

function ensurePreviewStyles() {
  if (document.getElementById(PREVIEW_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = PREVIEW_STYLE_ID;
  style.textContent = `
    #${PREVIEW_CONTAINER_ID} {
      position: fixed;
      left: 24px;
      top: 24px;
      width: 180px;
      height: 180px;
      overflow: visible;
      z-index: 2147483646;
      pointer-events: auto;
      touch-action: none;
      cursor: grab;
      user-select: none;
    }

    #${PREVIEW_CONTAINER_ID}.isDragging {
      cursor: grabbing;
    }

    #${PREVIEW_CONTAINER_ID}.isResizeZone {
      cursor: nesw-resize;
    }

    #${PREVIEW_CONTAINER_ID}.isResizing {
      cursor: nesw-resize;
    }

    #${PREVIEW_SHELL_ID} {
      position: absolute;
      inset: 0;
      border-radius: 999px;
      overflow: hidden;
      background: #0a0f18;
      border: 3px solid rgba(255, 255, 255, 0.94);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
      pointer-events: none;
    }

    #${PREVIEW_FRAME_ID} {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #0a0f18;
      pointer-events: none;
      border-radius: 999px;
    }

  `;

  document.documentElement.append(style);
}

function getViewportMetrics(container) {
  const margin = 24;
  const width = container.offsetWidth;
  const height = container.offsetHeight;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    margin,
    maxLeft,
    maxTop
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toNormalizedPosition(left, top, container) {
  const { margin, maxLeft, maxTop } = getViewportMetrics(container);
  const rangeX = Math.max(0, maxLeft - margin);
  const rangeY = Math.max(0, maxTop - margin);

  return {
    x: rangeX === 0 ? 0 : (left - margin) / rangeX,
    y: rangeY === 0 ? 0 : (top - margin) / rangeY
  };
}

function applyPreviewPosition(position, container) {
  const { margin, maxLeft, maxTop } = getViewportMetrics(container);
  const normalizedX = Number.isFinite(position?.x) ? clamp(position.x, 0, 1) : 0;
  const normalizedY = Number.isFinite(position?.y) ? clamp(position.y, 0, 1) : 1;
  const rangeX = Math.max(0, maxLeft - margin);
  const rangeY = Math.max(0, maxTop - margin);
  const left = margin + rangeX * normalizedX;
  const top = margin + rangeY * normalizedY;

  container.style.left = `${Math.round(left)}px`;
  container.style.top = `${Math.round(top)}px`;
}

function isResizeHotspot(event, container) {
  const rect = container.getBoundingClientRect();
  const hotspotSize = 56;
  return (
    event.clientX >= rect.right - hotspotSize &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.top + hotspotSize
  );
}

async function loadStoredPreviewSettings() {
  const stored = await chrome.storage.local.get(PREVIEW_STORAGE_DEFAULTS);
  return {
    webcamPosition: stored.webcamPosition ?? PREVIEW_STORAGE_DEFAULTS.webcamPosition,
    webcamSize: normalizePreviewSize(stored.webcamSize)
  };
}

async function persistPreviewPosition(position) {
  const normalizedPosition = {
    x: clamp(position.x, 0, 1),
    y: clamp(position.y, 0, 1)
  };

  const state = getPreviewState();
  state.position = normalizedPosition;
  await chrome.storage.local.set({
    webcamPosition: normalizedPosition
  });
}

function normalizePreviewSize(size) {
  if (typeof size === "number" && Number.isFinite(size)) {
    return clamp(Math.round(size), PREVIEW_MIN_SIZE, PREVIEW_MAX_SIZE);
  }

  if (size === "small") {
    return 132;
  }

  if (size === "large") {
    return 228;
  }

  return PREVIEW_STORAGE_DEFAULTS.webcamSize;
}

function applyPreviewSize(size, container) {
  const nextSize = normalizePreviewSize(size);
  container.style.width = `${nextSize}px`;
  container.style.height = `${nextSize}px`;
}

async function persistPreviewSize(size) {
  const nextSize = normalizePreviewSize(size);
  const state = getPreviewState();
  state.size = nextSize;
  await chrome.storage.local.set({
    webcamSize: nextSize
  });
}

function removePreviewDom() {
  const container = document.getElementById(PREVIEW_CONTAINER_ID);
  if (container) {
    container.remove();
  }
}

function destroyPreview() {
  const state = getPreviewState();
  if (state.cleanupResizeListener) {
    state.cleanupResizeListener();
    state.cleanupResizeListener = null;
  }

  removePreviewDom();
}

function getBubbleUrl(cameraDeviceId) {
  const url = new URL(chrome.runtime.getURL("src/webcam-bubble.html"));
  if (cameraDeviceId) {
    url.searchParams.set("cameraDeviceId", cameraDeviceId);
  }
  return url.toString();
}

function ensurePreviewDom(cameraDeviceId) {
  ensurePreviewStyles();

  let container = document.getElementById(PREVIEW_CONTAINER_ID);
  if (!container) {
    container = document.createElement("div");
    container.id = PREVIEW_CONTAINER_ID;
    container.setAttribute("aria-hidden", "true");

    const shell = document.createElement("div");
    shell.id = PREVIEW_SHELL_ID;

    const frame = document.createElement("iframe");
    frame.id = PREVIEW_FRAME_ID;
    frame.src = getBubbleUrl(cameraDeviceId);
    frame.setAttribute("title", "Spool webcam preview");
    frame.setAttribute("allow", "camera");
    shell.append(frame);
    container.append(shell);

    document.documentElement.append(container);
  } else {
    const frame = container.querySelector("iframe");
    if (frame) {
      frame.src = getBubbleUrl(cameraDeviceId);
    }
  }

  const state = getPreviewState();

  if (!container.dataset.dragReady) {
    container.dataset.dragReady = "true";
    container.addEventListener("pointermove", (event) => {
      if (container.classList.contains("isResizing")) {
        return;
      }

      const inResizeZone = isResizeHotspot(event, container);
      container.classList.toggle("isResizeZone", inResizeZone);
      container.style.cursor = inResizeZone ? "nesw-resize" : "grab";
    });

    container.addEventListener("pointerleave", () => {
      if (!container.classList.contains("isResizing")) {
        container.classList.remove("isResizeZone");
        container.style.cursor = "grab";
      }
    });

    container.addEventListener("pointerdown", (event) => {
      if (isResizeHotspot(event, container)) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const startRect = container.getBoundingClientRect();
      const offsetX = event.clientX - startRect.left;
      const offsetY = event.clientY - startRect.top;

      container.classList.add("isDragging");
      container.style.cursor = "grabbing";
      container.setPointerCapture(event.pointerId);

      const handlePointerMove = (moveEvent) => {
        const { margin, maxLeft, maxTop } = getViewportMetrics(container);
        const nextLeft = clamp(moveEvent.clientX - offsetX, margin, maxLeft);
        const nextTop = clamp(moveEvent.clientY - offsetY, margin, maxTop);

        container.style.left = `${Math.round(nextLeft)}px`;
        container.style.top = `${Math.round(nextTop)}px`;
      };

      const finishDrag = async () => {
        container.classList.remove("isDragging");
        container.style.cursor = "grab";
        container.removeEventListener("pointermove", handlePointerMove);
        container.removeEventListener("pointerup", handlePointerUp);
        container.removeEventListener("pointercancel", handlePointerCancel);

        const finalRect = container.getBoundingClientRect();
        const position = toNormalizedPosition(finalRect.left, finalRect.top, container);
        await persistPreviewPosition(position);
      };

      const handlePointerUp = () => {
        finishDrag().catch(() => {});
      };

      const handlePointerCancel = () => {
        finishDrag().catch(() => {});
      };

      container.addEventListener("pointermove", handlePointerMove);
      container.addEventListener("pointerup", handlePointerUp);
      container.addEventListener("pointercancel", handlePointerCancel);
    });

    const handleResize = () => {
      applyPreviewPosition(state.position, container);
    };

    window.addEventListener("resize", handleResize);
    state.cleanupResizeListener = () => {
      window.removeEventListener("resize", handleResize);
    };
  }

  if (!container.dataset.resizeReady) {
    container.dataset.resizeReady = "true";
    const startResize = (event) => {
      if (event.button !== 0) {
        return;
      }

      event.stopPropagation();
      event.preventDefault();

      const startRect = container.getBoundingClientRect();
      const fixedLeft = startRect.left;
      const fixedBottom = startRect.bottom;

      container.classList.add("isResizing");
      container.classList.remove("isResizeZone");
      container.style.cursor = "nesw-resize";

      const handlePointerMove = (moveEvent) => {
        const maxSize = clamp(
          Math.min(window.innerWidth - fixedLeft - 24, fixedBottom - 24),
          PREVIEW_MIN_SIZE,
          PREVIEW_MAX_SIZE
        );
        const desiredWidth = moveEvent.clientX - fixedLeft;
        const desiredHeight = fixedBottom - moveEvent.clientY;
        const nextSize = clamp(
          Math.round(Math.max(desiredWidth, desiredHeight)),
          PREVIEW_MIN_SIZE,
          maxSize
        );

        applyPreviewSize(nextSize, container);
        container.style.left = `${Math.round(fixedLeft)}px`;
        container.style.top = `${Math.round(fixedBottom - nextSize)}px`;
      };

      const finishResize = async () => {
        container.classList.remove("isResizing");
        container.style.cursor = "grab";
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);

        const finalRect = container.getBoundingClientRect();
        await persistPreviewSize(finalRect.width);
        const position = toNormalizedPosition(finalRect.left, finalRect.top, container);
        await persistPreviewPosition(position);
      };

      const handlePointerUp = () => {
        finishResize().catch(() => {});
      };

      const handlePointerCancel = () => {
        finishResize().catch(() => {});
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
    };

    container.addEventListener("pointerdown", (event) => {
      if (!isResizeHotspot(event, container)) {
        return;
      }

      startResize(event);
    });
  }

  return container;
}

async function startPreview(cameraDeviceId) {
  destroyPreview();
  const container = ensurePreviewDom(cameraDeviceId);
  const { webcamPosition, webcamSize } = await loadStoredPreviewSettings();
  const state = getPreviewState();
  state.position = webcamPosition;
  state.size = webcamSize;
  applyPreviewSize(webcamSize, container);
  applyPreviewPosition(state.position, container);
}

async function syncPreview(payload) {
  if (payload.enabled) {
    await startPreview(payload.cameraDeviceId);
  } else {
    destroyPreview();
  }

  return { ok: true };
}

  globalThis.__spoolSyncWebcamPreview = syncPreview;
  globalThis.addEventListener("pagehide", destroyPreview);
}
