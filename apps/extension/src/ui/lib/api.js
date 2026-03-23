import { SHARE_API_BASE_URL } from "../../share-config.js";
import { sanitizeRecordingTitle, titleToFileName } from "../../recording-title.js";

async function parseJson(response) {
  return response.json().catch(() => null);
}

export async function fetchRecordings(accessToken) {
  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    method: "GET"
  });

  const payload = await parseJson(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to load recordings.");
  }

  return payload;
}

export async function fetchRecordingByShareId(accessToken, shareId) {
  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos/${shareId}`, {
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    method: "GET"
  });

  const payload = await parseJson(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to load recording.");
  }

  return payload.recording;
}

export async function saveRecordingTitle(accessToken, shareId, nextTitle) {
  const title = sanitizeRecordingTitle(nextTitle, "Untitled recording");
  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos/${shareId}/title`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title,
      fileName: titleToFileName(title)
    })
  });

  const payload = await parseJson(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to save recording title.");
  }

  return payload;
}

export async function deleteRecording(accessToken, shareId) {
  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/videos/${shareId}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  const payload = await parseJson(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to delete recording.");
  }

  return payload;
}

export async function uploadRecordingForShare(accessToken, recording) {
  const response = await fetch(`${SHARE_API_BASE_URL}/api/share/init`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contentType: recording.mimeType || recording.blob?.type || "video/webm",
      fileName: titleToFileName(recording.title),
      fileSizeBytes: recording.sizeBytes || recording.blob?.size || 0,
      title: sanitizeRecordingTitle(recording.title, "Untitled recording")
    })
  });

  const payload = await parseJson(response);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Failed to initialize share upload.");
  }

  const uploadResponse = await fetch(payload.uploadUrl, {
    method: payload.uploadMethod || "PUT",
    headers: payload.uploadHeaders || {
      "content-type": recording.mimeType || recording.blob?.type || "video/webm"
    },
    body: recording.blob
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed with status ${uploadResponse.status}.`);
  }

  const completeResponse = await fetch(`${SHARE_API_BASE_URL}/api/share/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      shareId: payload.shareId
    })
  });

  const completePayload = await parseJson(completeResponse);
  if (!completeResponse.ok || !completePayload?.ok) {
    throw new Error(completePayload?.error || "Failed to finish share upload.");
  }

  return {
    shareId: payload.shareId,
    shareUrl: completePayload.shareUrl || payload.shareUrl,
    sizeBytes: completePayload.sizeBytes || recording.sizeBytes || recording.blob?.size || 0
  };
}
