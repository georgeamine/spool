import {
  AUTH_SESSION_STORAGE_KEY,
  COGNITO_CLIENT_ID,
  COGNITO_DOMAIN,
  COGNITO_REDIRECT_PATH,
  COGNITO_SCOPES
} from "./share-config.js";

function decodeJwtPayload(token) {
  if (typeof token !== "string" || token.split(".").length < 2) {
    return {};
  }

  const payload = token.split(".")[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = atob(normalized + padding);
  return JSON.parse(decoded);
}

export async function getStoredAuthSession() {
  const stored = await chrome.storage.local.get(AUTH_SESSION_STORAGE_KEY);
  return stored[AUTH_SESSION_STORAGE_KEY] ?? null;
}

export async function saveAuthSession(session) {
  if (!session) {
    await chrome.storage.local.remove(AUTH_SESSION_STORAGE_KEY);
    return;
  }

  await chrome.storage.local.set({
    [AUTH_SESSION_STORAGE_KEY]: session
  });
}

function sessionIsFresh(session) {
  return Boolean(
    session?.accessToken &&
      Number.isFinite(session?.expiresAt) &&
      session.expiresAt > Date.now() + 30_000
  );
}

function createRandomString(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createPkceChallenge(codeVerifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return toBase64Url(digest);
}

function buildTokenEndpointUrl() {
  return `https://${COGNITO_DOMAIN}/oauth2/token`;
}

function buildAuthorizeUrl({ codeChallenge, redirectUrl, state, prompt = "" }) {
  const url = new URL(`https://${COGNITO_DOMAIN}/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", COGNITO_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUrl);
  url.searchParams.set("scope", COGNITO_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", codeChallenge);
  if (prompt) {
    url.searchParams.set("prompt", prompt);
  }
  return url.toString();
}

function buildLogoutUrl(redirectUrl) {
  const url = new URL(`https://${COGNITO_DOMAIN}/logout`);
  url.searchParams.set("client_id", COGNITO_CLIENT_ID);
  url.searchParams.set("logout_uri", redirectUrl);
  return url.toString();
}

function normalizeTokenResponse(payload, fallbackSession = null) {
  const nextIdToken = payload.id_token || fallbackSession?.idToken || "";
  const idClaims = nextIdToken ? decodeJwtPayload(nextIdToken) : {};
  return {
    accessToken: payload.access_token,
    idToken: nextIdToken,
    refreshToken: payload.refresh_token || fallbackSession?.refreshToken || "",
    tokenType: payload.token_type || fallbackSession?.tokenType || "Bearer",
    expiresAt: Date.now() + Math.max((payload.expires_in || 3600) - 60, 60) * 1000,
    email: idClaims.email || fallbackSession?.email || "",
    sub: idClaims.sub || fallbackSession?.sub || ""
  };
}

async function exchangeAuthorizationCode({ code, codeVerifier, redirectUrl }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUrl
  });

  const response = await fetch(buildTokenEndpointUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Failed to sign in.");
  }

  return normalizeTokenResponse(payload);
}

async function refreshAuthSession(session) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: COGNITO_CLIENT_ID,
    refresh_token: session.refreshToken
  });

  const response = await fetch(buildTokenEndpointUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    await saveAuthSession(null);
    return null;
  }

  const refreshedSession = normalizeTokenResponse(payload, session);
  await saveAuthSession(refreshedSession);
  return refreshedSession;
}

async function requestInteractiveAuthSession({ forcePrompt = false } = {}) {
  const redirectUrl = chrome.identity.getRedirectURL(COGNITO_REDIRECT_PATH);
  const codeVerifier = createRandomString(32);
  const codeChallenge = await createPkceChallenge(codeVerifier);
  const state = createRandomString(16);
  const authUrl = buildAuthorizeUrl({
    codeChallenge,
    redirectUrl,
    state,
    prompt: forcePrompt ? "login" : ""
  });

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true
  });

  if (!responseUrl) {
    throw new Error("Sign-in did not complete.");
  }

  const callbackUrl = new URL(responseUrl);
  if (callbackUrl.searchParams.get("state") !== state) {
    throw new Error("Sign-in state check failed.");
  }

  const error = callbackUrl.searchParams.get("error");
  if (error) {
    throw new Error(callbackUrl.searchParams.get("error_description") || error);
  }

  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Sign-in did not return an authorization code.");
  }

  const session = await exchangeAuthorizationCode({
    code,
    codeVerifier,
    redirectUrl
  });
  await saveAuthSession(session);
  return session;
}

export async function signOutAuthSession() {
  const redirectUrl = chrome.identity.getRedirectURL(COGNITO_REDIRECT_PATH);
  await saveAuthSession(null);

  try {
    await chrome.identity.launchWebAuthFlow({
      url: buildLogoutUrl(redirectUrl),
      interactive: true
    });
  } catch {
    // Keep local sign-out even if the hosted logout flow is interrupted.
  }
}

export async function getValidAuthSession({ interactive = false, forcePrompt = false } = {}) {
  const storedSession = await getStoredAuthSession();
  if (sessionIsFresh(storedSession)) {
    return storedSession;
  }

  if (storedSession?.refreshToken) {
    const refreshedSession = await refreshAuthSession(storedSession);
    if (sessionIsFresh(refreshedSession)) {
      return refreshedSession;
    }
  }

  if (!interactive) {
    return null;
  }

  return requestInteractiveAuthSession({ forcePrompt });
}
