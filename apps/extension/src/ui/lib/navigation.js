export function getRecordingsPageUrl() {
  return chrome.runtime.getURL("src/uploads.html");
}

export function getRecordingDetailPageUrl(shareId = "") {
  const url = new URL(chrome.runtime.getURL("src/recording-result.html"));
  if (shareId) {
    url.searchParams.set("shareId", shareId);
  }
  return url.toString();
}

export function getRequestedShareId() {
  const currentUrl = new URL(window.location.href);
  return currentUrl.searchParams.get("shareId")?.trim() || "";
}
