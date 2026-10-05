const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

let cachedToken = null;
let tokenExpiry = 0;

function base64UrlEncode(data) {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Generates an OAuth2 access token for a Google Service Account using RS256 JWT.
 * No browser login, no consent screen, no token expiry issues.
 */
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiry > now + 60) {
    return cachedToken;
  }

  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Invalid service account JSON: missing client_email or private_key");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaim = base64UrlEncode(JSON.stringify(claim));
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = base64UrlEncode(signer.sign(serviceAccount.private_key));
  const jwt = `${signatureInput}.${signature}`;

  const res = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Service Account Token Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in || 3600);
  return cachedToken;
}

/**
 * Uploads a file buffer directly to a Google Drive folder via Drive API v3 multipart upload.
 */
async function uploadFileToDrive({ filePath, fileName, mimeType, folderId, serviceAccount }) {
  const token = await getAccessToken(serviceAccount);
  const fileBytes = fs.readFileSync(filePath);

  const boundary = "-------coucou_boundary_" + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    parents: folderId ? [folderId] : undefined,
  };

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
      `${delimiter}Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(closeDelimiter),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webContentLink,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(multipartBody.length),
    },
    body: multipartBody,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive Upload API Error (${res.status}): ${errText}`);
  }

  const fileData = await res.json();

  // Make the file accessible to anyone with the link so both partner PCs can download it
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch (e) {
    console.warn("[Google Drive]: Warning setting anyone permission:", e.message);
  }

  return fileData;
}

/**
 * Downloads a file directly from Google Drive using Service Account token or API Key.
 */
async function downloadFileFromDrive({ fileId, apiKey, serviceAccount, targetPath }) {
  let downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const headers = {};

  if (serviceAccount) {
    const token = await getAccessToken(serviceAccount);
    headers["Authorization"] = `Bearer ${token}`;
  } else if (apiKey) {
    downloadUrl += `&key=${apiKey}`;
  }

  const res = await fetch(downloadUrl, { headers });
  if (!res.ok) {
    throw new Error(`Drive Download API Error (${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
  return true;
}

// ── OAuth 2.0 Flow for Personal Google Accounts ─────────────────────────────
const http = require("node:http");

let oauthServer = null;

function startGoogleOAuthFlow({ clientId, clientSecret, port = 8085 }) {
  if (oauthServer) {
    try { oauthServer.close(); } catch {}
    oauthServer = null;
  }

  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const scopes = encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email");
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}&access_type=offline&prompt=consent`;

  let serverStartedResolve;
  let serverStartedReject;
  const serverStarted = new Promise((res, rej) => {
    serverStartedResolve = res;
    serverStartedReject = rej;
  });

  const completion = new Promise((resolve, reject) => {
    oauthServer = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
        if (parsedUrl.pathname === "/oauth2callback") {
          const code = parsedUrl.searchParams.get("code");
          const error = parsedUrl.searchParams.get("error");

          if (error) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<html><body style="font-family:sans-serif;background:#0b0c0e;color:#f4505e;padding:40px;text-align:center;"><h2>❌ Authorization Cancelled</h2><p>${error}</p><p>You can close this tab and return to Mochi.</p></body></html>`);
            if (oauthServer) { oauthServer.close(); oauthServer = null; }
            return reject(new Error(error));
          }

          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("Missing code");
            return;
          }

          // Exchange authorization code for tokens
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
            }),
          });

          if (!tokenRes.ok) {
            const errBody = await tokenRes.text();
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<html><body style="font-family:sans-serif;background:#0b0c0e;color:#f4505e;padding:40px;text-align:center;"><h2>❌ Token Exchange Error</h2><p>${errBody}</p></body></html>`);
            if (oauthServer) { oauthServer.close(); oauthServer = null; }
            return reject(new Error(`Token exchange error: ${errBody}`));
          }

          const tokenData = await tokenRes.json();
          let userEmail = "";
          try {
            const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
              headers: { Authorization: `Bearer ${tokenData.access_token}` },
            });
            if (userRes.ok) {
              const userData = await userRes.json();
              userEmail = userData.email || "";
            }
          } catch (e) {
            console.warn("Failed to get user info:", e);
          }

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<html><body style="font-family:sans-serif;background:#0b0c0e;color:#22c55e;padding:40px;text-align:center;"><h2>✨ Mochi is now connected to Google Drive!</h2><p style="color:#9398a1;font-size:16px;">Logged in as: <b>${userEmail || "your Google Account"}</b></p><p style="color:#6b7079;">You can safely close this tab and return to Mochi.</p></body></html>`);

          if (oauthServer) {
            oauthServer.close();
            oauthServer = null;
          }

          resolve({
            success: true,
            email: userEmail,
            refreshToken: tokenData.refresh_token,
            accessToken: tokenData.access_token,
            expiresIn: tokenData.expires_in,
          });
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error: " + err.message);
        if (oauthServer) { oauthServer.close(); oauthServer = null; }
        reject(err);
      }
    });

    oauthServer.listen(port, "127.0.0.1", () => {
      serverStartedResolve();
    });

    oauthServer.on("error", (err) => {
      oauthServer = null;
      serverStartedReject(err);
      reject(err);
    });

    setTimeout(() => {
      if (oauthServer) {
        oauthServer.close();
        oauthServer = null;
        reject(new Error("Authorization timed out after 5 minutes."));
      }
    }, 5 * 60 * 1000);
  });

  return { authUrl, serverStarted, completion };
}

async function refreshOAuthAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function uploadFileWithToken({ filePath, fileName, mimeType, folderId, accessToken }) {
  const fileBytes = fs.readFileSync(filePath);
  const boundary = "-------coucou_boundary_" + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    parents: folderId ? [folderId] : undefined,
  };

  const multipartBody = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}` +
      `${delimiter}Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(closeDelimiter),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webContentLink,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(multipartBody.length),
    },
    body: multipartBody,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive Upload API Error (${res.status}): ${errText}`);
  }

  const fileData = await res.json();

  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    });
  } catch (e) {
    console.warn("[Google Drive]: Warning setting permissions:", e.message);
  }

  return fileData;
}

module.exports = {
  getAccessToken,
  uploadFileToDrive,
  downloadFileFromDrive,
  startGoogleOAuthFlow,
  refreshOAuthAccessToken,
  uploadFileWithToken,
};

