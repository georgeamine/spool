export function sanitizeRecordingTitle(title, fallbackTitle = "Untitled recording") {
  if (typeof title !== "string") {
    return fallbackTitle;
  }

  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized || fallbackTitle;
}

export function getDefaultRecordingTitle(createdAt = new Date().toISOString()) {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return "Untitled recording";
  }

  const formatted = parsed.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });

  return `Recording ${formatted}`;
}

export function titleToFileName(title, extension = "webm") {
  const safeTitle = sanitizeRecordingTitle(title)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const baseName = safeTitle || "Untitled recording";
  const normalizedExtension = `${extension || "webm"}`.replace(/^\./, "").trim() || "webm";
  return `${baseName}.${normalizedExtension}`;
}
