const OVERLAY_ROOT_ID = "spool-page-overlay-root";
const OVERLAY_BACKDROP_ID = "spool-page-overlay-backdrop";
const OVERLAY_HOST_ID = "spool-page-overlay-host";
const OVERLAY_FRAME_ID = "spool-page-overlay-frame";
const OVERLAY_STYLE_ID = "spool-page-overlay-style";
const OVERLAY_FRAME_HEIGHT = 460;
const OVERLAY_FRAME_WIDTH = 340;

function ensureStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    @keyframes spoolOverlayFadeIn {
      from {
        opacity: 0;
      }

      to {
        opacity: 1;
      }
    }

    @keyframes spoolPanelSlideIn {
      from {
        opacity: 0;
        transform: translate3d(28px, 0, 0) scale(0.98);
      }

      to {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
      }
    }

    #${OVERLAY_ROOT_ID} {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483646;
      pointer-events: auto;
    }

    #${OVERLAY_BACKDROP_ID} {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(0.5px);
      border: 0;
      outline: none;
      margin: 0;
      padding: 0;
      animation: spoolOverlayFadeIn 160ms ease-out;
    }

    #${OVERLAY_HOST_ID} {
      position: absolute;
      top: 20px;
      right: 20px;
      width: min(${OVERLAY_FRAME_WIDTH}px, calc(100vw - 40px));
      height: ${OVERLAY_FRAME_HEIGHT}px;
      max-height: calc(100vh - 40px);
      border-radius: 34px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(8, 24, 41, 0.28);
      pointer-events: auto;
      background: #ffffff;
      backdrop-filter: none;
      transform-origin: top right;
      animation: spoolPanelSlideIn 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    #${OVERLAY_FRAME_ID} {
      width: 100%;
      height: ${OVERLAY_FRAME_HEIGHT}px;
      border: 0;
      display: block;
      background: transparent;
    }
  `;

  document.documentElement.append(style);
}

function removeOverlay() {
  const root = document.getElementById(OVERLAY_ROOT_ID);
  if (root) {
    root.remove();
    return true;
  }

  return false;
}

function requestOverlayClose() {
  chrome.runtime.sendMessage({ type: "hide-page-overlay" }).catch(() => {
    removeOverlay();
  });
}

function getOverlayUrl(payload = {}) {
  return chrome.runtime.getURL("src/overlay.html");
}

function ensureOverlay(payload = {}) {
  ensureStyles();

  let root = document.getElementById(OVERLAY_ROOT_ID);
  if (root) {
    const frame = root.querySelector(`#${OVERLAY_FRAME_ID}`);
    if (frame && payload.forceOpen) {
      const nextUrl = getOverlayUrl(payload);
      if (frame.src !== nextUrl) {
        frame.src = nextUrl;
      }
    }
    return root;
  }

  root = document.createElement("div");
  root.id = OVERLAY_ROOT_ID;

  const backdrop = document.createElement("div");
  backdrop.id = OVERLAY_BACKDROP_ID;
  backdrop.addEventListener("click", requestOverlayClose);

  const host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;

  const frame = document.createElement("iframe");
  frame.id = OVERLAY_FRAME_ID;
  frame.src = getOverlayUrl(payload);
  frame.setAttribute("title", "Spool recorder");
  frame.setAttribute("allow", "camera; microphone");

  host.append(frame);
  root.append(backdrop);
  root.append(host);
  document.documentElement.append(root);
  return root;
}

function toggleOverlay(payload = {}) {
  const existing = document.getElementById(OVERLAY_ROOT_ID);
  if (existing) {
    if (payload.forceOpen) {
      ensureOverlay(payload);
      return true;
    }

    requestOverlayClose();
    return false;
  }

  ensureOverlay(payload);
  return true;
}

if (!globalThis.__spoolPageOverlayListenerAttached) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "spool-toggle-page-overlay") {
      sendResponse({ ok: true, isOpen: toggleOverlay(message.payload) });
      return;
    }

    if (message.type === "spool-hide-page-overlay") {
      sendResponse({ ok: true, wasOpen: removeOverlay() });
      return;
    }
  });

  globalThis.__spoolPageOverlayListenerAttached = true;
}
