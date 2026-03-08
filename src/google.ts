/**
 * Google API client with OAuth token refresh and fetch helpers
 */

export let accessToken = process.env.GOOGLE_ACCESS_TOKEN ?? "";
export let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? "";
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

if (!accessToken && !refreshToken) {
  console.warn(
    "[google] Warning: GOOGLE_ACCESS_TOKEN or GOOGLE_REFRESH_TOKEN must be set for Google API access"
  );
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(): Promise<void> {
  if (!refreshToken || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Cannot refresh token: GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET are required"
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  accessToken = data.access_token;
  if (data.refresh_token) refreshToken = data.refresh_token;
}

/**
 * Fetch from Google APIs with automatic Bearer auth and 401 retry with token refresh
 */
export async function googleFetch(
  url: string,
  options: RequestInit = {}
): Promise<unknown> {
  const makeReq = (token: string) =>
    fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string> ?? {}),
      },
    });

  let res = await makeReq(accessToken);

  // Auto-refresh on 401 (token expired)
  if (res.status === 401 && refreshToken) {
    await refreshAccessToken();
    res = await makeReq(accessToken);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API error (${res.status}): ${text}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE DRIVE API
// ─────────────────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  trashed?: boolean;
}

export async function driveListFiles(
  pageSize = 10,
  parentId?: string,
  query?: string
): Promise<DriveFile[]> {
  const q = ["trashed=false"];
  if (parentId) q.push(`'${parentId}' in parents`);
  if (query) q.push(query);

  const params = new URLSearchParams({
    pageSize: pageSize.toString(),
    fields: "files(id,name,mimeType,parents,createdTime,modifiedTime,webViewLink,size)",
    q: q.join(" and "),
  });

  const data = (await googleFetch(
    `https://www.googleapis.com/drive/v3/files?${params}`
  )) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function driveSearchFiles(query: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    pageSize: "20",
    fields: "files(id,name,mimeType,webViewLink)",
    q: `fullText contains "${query}" and trashed=false`,
  });

  const data = (await googleFetch(
    `https://www.googleapis.com/drive/v3/files?${params}`
  )) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function driveGetFile(fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields:
      "id,name,mimeType,parents,createdTime,modifiedTime,webViewLink,size,trashed,owners",
  });

  return (await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params}`
  )) as DriveFile;
}

export async function driveCreateFolder(folderName: string, parentId?: string): Promise<DriveFile> {
  const body = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  };

  return (await googleFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    body: JSON.stringify(body),
  })) as DriveFile;
}

export async function driveMoveFile(fileId: string, newParentId: string): Promise<DriveFile> {
  const file = await driveGetFile(fileId);
  const previousParents = (file.parents ?? []).join(",");

  const params = new URLSearchParams({
    addParents: newParentId,
    removeParents: previousParents,
    fields: "id,parents",
  });

  return (await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params}`,
    { method: "PATCH", body: JSON.stringify({}) }
  )) as DriveFile;
}

export async function driveCopyFile(fileId: string, newName?: string): Promise<DriveFile> {
  const body = { ...(newName ? { name: newName } : {}) };

  return (await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    { method: "POST", body: JSON.stringify(body) }
  )) as DriveFile;
}

export async function driveDeleteFile(fileId: string): Promise<void> {
  await googleFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
  });
}

export interface FilePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
}

export async function driveGetPermissions(fileId: string): Promise<FilePermission[]> {
  const params = new URLSearchParams({
    fields: "permissions(id,type,role,emailAddress)",
  });

  const data = (await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?${params}`
  )) as { permissions?: FilePermission[] };
  return data.permissions ?? [];
}

export async function driveShareFile(
  fileId: string,
  emailAddress: string,
  role: "viewer" | "commenter" | "editor" = "viewer"
): Promise<FilePermission> {
  const body = {
    type: "user",
    role,
    emailAddress,
  };

  return (await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }
  )) as FilePermission;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE DOCS API
// ─────────────────────────────────────────────────────────────────────────────

export interface GoogleDoc {
  documentId: string;
  title: string;
  body?: { content: unknown[] };
  revisionId?: string;
}

export async function docsGetDocument(documentId: string): Promise<GoogleDoc> {
  return (await googleFetch(
    `https://docs.googleapis.com/v1/documents/${documentId}`
  )) as GoogleDoc;
}

export async function docsGetText(documentId: string): Promise<string> {
  const doc = await docsGetDocument(documentId);
  return extractTextFromDocument(doc);
}

function extractTextFromDocument(doc: GoogleDoc): string {
  const text: string[] = [];
  const content = doc.body?.content ?? [];

  for (const element of content as unknown[]) {
    const el = element as { paragraph?: { elements?: unknown[] } };
    if (el.paragraph?.elements) {
      for (const textRun of el.paragraph.elements as unknown[]) {
        const tr = textRun as { textRun?: { content?: string } };
        if (tr.textRun?.content) text.push(tr.textRun.content);
      }
    }
  }

  return text.join("");
}

export async function docsCreateDocument(title: string): Promise<GoogleDoc> {
  const body = { title };

  return (await googleFetch("https://docs.googleapis.com/v1/documents", {
    method: "POST",
    body: JSON.stringify(body),
  })) as GoogleDoc;
}

export async function docsAppendText(documentId: string, text: string): Promise<void> {
  const doc = await docsGetDocument(documentId);
  const endIndex =
    ((doc.body?.content as unknown[] ?? [])
      .map((c: unknown) => (c as { endIndex?: number }).endIndex ?? 0)
      .reduce((a, b) => Math.max(a, b), 0)) || 1;

  await docsBatchUpdate(documentId, [
    {
      insertText: {
        text: text + "\n",
        location: { index: endIndex },
      },
    },
  ]);
}

export async function docsReplaceText(
  documentId: string,
  findText: string,
  replaceText: string
): Promise<void> {
  const doc = await docsGetDocument(documentId);
  const fullText = extractTextFromDocument(doc);
  const index = fullText.indexOf(findText);

  if (index === -1) {
    throw new Error(`Text "${findText}" not found in document`);
  }

  await docsBatchUpdate(documentId, [
    {
      deleteContentRange: {
        range: {
          startIndex: index,
          endIndex: index + findText.length,
        },
      },
    },
    {
      insertText: {
        text: replaceText,
        location: { index },
      },
    },
  ]);
}

export async function docsInsertText(
  documentId: string,
  text: string,
  index: number
): Promise<void> {
  await docsBatchUpdate(documentId, [
    {
      insertText: {
        text,
        location: { index },
      },
    },
  ]);
}

export async function docsBatchUpdate(
  documentId: string,
  requests: unknown[]
): Promise<void> {
  const body = { requests };

  await googleFetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE SHEETS API
// ─────────────────────────────────────────────────────────────────────────────

export interface Spreadsheet {
  spreadsheetId: string;
  properties: { title: string };
  sheets?: Array<{ properties: { sheetId: number; title: string } }>;
}

export async function sheetsGetSpreadsheet(spreadsheetId: string): Promise<Spreadsheet> {
  const params = new URLSearchParams({
    fields: "spreadsheetId,properties,sheets.properties",
  });

  return (await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?${params}`
  )) as Spreadsheet;
}

export interface SheetValues {
  range: string;
  values?: unknown[][];
}

export async function sheetsReadRange(spreadsheetId: string, range: string): Promise<unknown[][]> {
  const params = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });

  const data = (await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`
  )) as SheetValues;

  return data.values ?? [];
}

export async function sheetsWriteRange(
  spreadsheetId: string,
  range: string,
  values: unknown[][]
): Promise<void> {
  const body = { values };

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify(body) }
  );
}

export async function sheetsCreateSpreadsheet(title: string): Promise<Spreadsheet> {
  const body = {
    properties: { title },
    sheets: [{ properties: { title: "Sheet1" } }],
  };

  return (await googleFetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    body: JSON.stringify(body),
  })) as Spreadsheet;
}

export async function sheetsAppendRows(
  spreadsheetId: string,
  range: string,
  values: unknown[][]
): Promise<void> {
  const body = { values };

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

export async function sheetsClearRange(spreadsheetId: string, range: string): Promise<void> {
  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function sheetsAddSheet(spreadsheetId: string, sheetTitle: string): Promise<number> {
  const body = {
    requests: [
      {
        addSheet: {
          properties: { title: sheetTitle },
        },
      },
    ],
  };

  const result = (await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { method: "POST", body: JSON.stringify(body) }
  )) as { replies?: Array<{ addSheet?: { properties?: { sheetId: number } } }> };

  return result.replies?.[0]?.addSheet?.properties?.sheetId ?? -1;
}

export async function sheetsDeleteSheet(spreadsheetId: string, sheetTitle: string): Promise<void> {
  const spreadsheet = await sheetsGetSpreadsheet(spreadsheetId);
  const sheet = spreadsheet.sheets?.find((s) => s.properties.title === sheetTitle);

  if (!sheet) {
    throw new Error(`Sheet "${sheetTitle}" not found`);
  }

  const body = {
    requests: [
      {
        deleteSheet: {
          sheetId: sheet.properties.sheetId,
        },
      },
    ],
  };

  await googleFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    { method: "POST", body: JSON.stringify(body) }
  );
}
