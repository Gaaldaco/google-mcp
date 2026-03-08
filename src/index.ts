import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as google from "./google.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const TRANSPORT = process.env.TRANSPORT ?? "http";

if (!google.accessToken && !google.refreshToken) {
  console.warn("[index] No Google tokens configured — API calls will fail");
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP SERVER FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "google-mcp", version: "1.0.0" });

  // ── GOOGLE DRIVE TOOLS ────────────────────────────────────────────────────

  server.tool(
    "drive_list_files",
    "List files and folders in Google Drive. Optionally filter by parent folder or search query.",
    {
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(10)
        .describe("Number of files to return (1-1000)"),
      parent_id: z.string().optional().describe("Parent folder ID to list files from"),
      query: z
        .string()
        .optional()
        .describe('Additional query string (e.g., "mimeType!=\'application/vnd.google-apps.folder\'")'),
    },
    async ({ pageSize, parent_id, query }) => {
      const files = await google.driveListFiles(pageSize, parent_id, query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(files, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "drive_search_files",
    "Search for files in Google Drive by name or content.",
    {
      query: z.string().describe("Search query (e.g., 'budget' or 'project proposal')"),
    },
    async ({ query }) => {
      const files = await google.driveSearchFiles(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(files, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "drive_get_file",
    "Get metadata for a specific file in Google Drive.",
    {
      file_id: z.string().describe("Google Drive file ID"),
    },
    async ({ file_id }) => {
      const file = await google.driveGetFile(file_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(file, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "drive_create_folder",
    "Create a new folder in Google Drive.",
    {
      folder_name: z.string().describe("Name of the new folder"),
      parent_id: z.string().optional().describe("Parent folder ID (default: root)"),
    },
    async ({ folder_name, parent_id }) => {
      const folder = await google.driveCreateFolder(folder_name, parent_id);
      return {
        content: [
          {
            type: "text",
            text: `Created folder: ${folder.name} (ID: ${folder.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "drive_move_file",
    "Move a file to a different folder in Google Drive.",
    {
      file_id: z.string().describe("File ID to move"),
      new_parent_id: z.string().describe("ID of the destination folder"),
    },
    async ({ file_id, new_parent_id }) => {
      const result = await google.driveMoveFile(file_id, new_parent_id);
      return {
        content: [
          {
            type: "text",
            text: `Moved file to folder. New parents: ${result.parents?.join(", ") || "root"}`,
          },
        ],
      };
    }
  );

  server.tool(
    "drive_copy_file",
    "Copy a file in Google Drive.",
    {
      file_id: z.string().describe("File ID to copy"),
      new_name: z.string().optional().describe("Optional new name for the copy"),
    },
    async ({ file_id, new_name }) => {
      const copy = await google.driveCopyFile(file_id, new_name);
      return {
        content: [
          {
            type: "text",
            text: `Copied file: ${copy.name} (ID: ${copy.id})`,
          },
        ],
      };
    }
  );

  server.tool(
    "drive_delete_file",
    "Delete (move to trash) a file in Google Drive.",
    {
      file_id: z.string().describe("File ID to delete"),
    },
    async ({ file_id }) => {
      await google.driveDeleteFile(file_id);
      return {
        content: [
          {
            type: "text",
            text: `File deleted (moved to trash)`,
          },
        ],
      };
    }
  );

  server.tool(
    "drive_get_permissions",
    "Get sharing permissions for a file in Google Drive.",
    {
      file_id: z.string().describe("File ID"),
    },
    async ({ file_id }) => {
      const permissions = await google.driveGetPermissions(file_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(permissions, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "drive_share_file",
    "Share a file with a specific email address.",
    {
      file_id: z.string().describe("File ID to share"),
      email: z.string().email().describe("Email address to share with"),
      role: z
        .enum(["viewer", "commenter", "editor"])
        .default("viewer")
        .describe("Access level: viewer, commenter, or editor"),
    },
    async ({ file_id, email, role }) => {
      const permission = await google.driveShareFile(file_id, email, role);
      return {
        content: [
          {
            type: "text",
            text: `Shared file with ${email} (role: ${permission.role})`,
          },
        ],
      };
    }
  );

  // ── GOOGLE DOCS TOOLS ─────────────────────────────────────────────────────

  server.tool(
    "docs_get_document",
    "Get the full content of a Google Document in JSON format.",
    {
      document_id: z.string().describe("Google Doc document ID"),
    },
    async ({ document_id }) => {
      const doc = await google.docsGetDocument(document_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(doc, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "docs_get_text",
    "Get the plain text content of a Google Document.",
    {
      document_id: z.string().describe("Google Doc document ID"),
    },
    async ({ document_id }) => {
      const text = await google.docsGetText(document_id);
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    }
  );

  server.tool(
    "docs_create_document",
    "Create a new blank Google Document.",
    {
      title: z.string().describe("Title of the new document"),
    },
    async ({ title }) => {
      const doc = await google.docsCreateDocument(title);
      return {
        content: [
          {
            type: "text",
            text: `Created document: ${doc.title} (ID: ${doc.documentId})`,
          },
        ],
      };
    }
  );

  server.tool(
    "docs_append_text",
    "Append text to the end of a Google Document.",
    {
      document_id: z.string().describe("Google Doc document ID"),
      text: z.string().describe("Text to append"),
    },
    async ({ document_id, text }) => {
      await google.docsAppendText(document_id, text);
      return {
        content: [
          {
            type: "text",
            text: `Appended text to document`,
          },
        ],
      };
    }
  );

  server.tool(
    "docs_replace_text",
    "Find and replace text in a Google Document.",
    {
      document_id: z.string().describe("Google Doc document ID"),
      find_text: z.string().describe("Text to find"),
      replace_text: z.string().describe("Text to replace with"),
    },
    async ({ document_id, find_text, replace_text }) => {
      await google.docsReplaceText(document_id, find_text, replace_text);
      return {
        content: [
          {
            type: "text",
            text: `Replaced "${find_text}" with "${replace_text}"`,
          },
        ],
      };
    }
  );

  server.tool(
    "docs_insert_text",
    "Insert text at a specific position in a Google Document.",
    {
      document_id: z.string().describe("Google Doc document ID"),
      text: z.string().describe("Text to insert"),
      index: z.number().int().min(0).describe("Character position to insert at"),
    },
    async ({ document_id, text, index }) => {
      await google.docsInsertText(document_id, text, index);
      return {
        content: [
          {
            type: "text",
            text: `Inserted text at position ${index}`,
          },
        ],
      };
    }
  );

  // ── GOOGLE SHEETS TOOLS ───────────────────────────────────────────────────

  server.tool(
    "sheets_get_spreadsheet",
    "Get metadata and sheet names for a Google Sheet.",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
    },
    async ({ spreadsheet_id }) => {
      const ss = await google.sheetsGetSpreadsheet(spreadsheet_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(ss, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_read_range",
    "Read values from a cell range in a Google Sheet (e.g. A1:D10).",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
      range: z.string().describe("Cell range in A1 notation (e.g., 'Sheet1!A1:D10')"),
    },
    async ({ spreadsheet_id, range }) => {
      const values = await google.sheetsReadRange(spreadsheet_id, range);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(values, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_write_range",
    "Write values to a cell range in a Google Sheet.",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
      range: z.string().describe("Cell range in A1 notation (e.g., 'Sheet1!A1:D10')"),
      values: z
        .array(z.array(z.unknown()))
        .describe("2D array of values to write (rows × columns)"),
    },
    async ({ spreadsheet_id, range, values }) => {
      await google.sheetsWriteRange(spreadsheet_id, range, values);
      return {
        content: [
          {
            type: "text",
            text: `Wrote ${values.length} rows to ${range}`,
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_create_spreadsheet",
    "Create a new Google Sheet.",
    {
      title: z.string().describe("Title of the new spreadsheet"),
    },
    async ({ title }) => {
      const ss = await google.sheetsCreateSpreadsheet(title);
      return {
        content: [
          {
            type: "text",
            text: `Created spreadsheet: ${ss.properties.title} (ID: ${ss.spreadsheetId})`,
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_append_rows",
    "Append rows of data to a Google Sheet.",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
      range: z
        .string()
        .describe("Starting cell range for appending (e.g., 'Sheet1!A1' or just 'Sheet1')"),
      values: z
        .array(z.array(z.unknown()))
        .describe("2D array of rows to append (each sub-array is a row)"),
    },
    async ({ spreadsheet_id, range, values }) => {
      await google.sheetsAppendRows(spreadsheet_id, range, values);
      return {
        content: [
          {
            type: "text",
            text: `Appended ${values.length} rows to ${range}`,
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_clear_range",
    "Clear all values from a cell range in a Google Sheet.",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
      range: z.string().describe("Cell range to clear (e.g., 'Sheet1!A1:D10')"),
    },
    async ({ spreadsheet_id, range }) => {
      await google.sheetsClearRange(spreadsheet_id, range);
      return {
        content: [
          {
            type: "text",
            text: `Cleared ${range}`,
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_add_sheet",
    "Add a new sheet/tab to a Google Sheet.",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
      sheet_title: z.string().describe("Name of the new sheet"),
    },
    async ({ spreadsheet_id, sheet_title }) => {
      const sheetId = await google.sheetsAddSheet(spreadsheet_id, sheet_title);
      return {
        content: [
          {
            type: "text",
            text: `Added sheet "${sheet_title}" (ID: ${sheetId})`,
          },
        ],
      };
    }
  );

  server.tool(
    "sheets_delete_sheet",
    "Delete a sheet/tab from a Google Sheet.",
    {
      spreadsheet_id: z.string().describe("Google Sheet spreadsheet ID"),
      sheet_title: z.string().describe("Name of the sheet to delete"),
    },
    async ({ spreadsheet_id, sheet_title }) => {
      await google.sheetsDeleteSheet(spreadsheet_id, sheet_title);
      return {
        content: [
          {
            type: "text",
            text: `Deleted sheet "${sheet_title}"`,
          },
        ],
      };
    }
  );

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT SETUP
// ─────────────────────────────────────────────────────────────────────────────

// Build server once at startup, reuse for all connections
const mcpServer = buildMcpServer();

if (TRANSPORT === "stdio") {
  // Claude Desktop (local, stdio transport)
  await mcpServer.connect(new StdioServerTransport());
  console.error("MCP server running on stdio");
} else {
  // HTTP transport (Railway, claude.ai)
  const app = express();

  // CORS headers for claude.ai
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, accept");
    next();
  });
  app.options("*", (_req, res) => {
    res.sendStatus(204);
  });

  // ── StreamableHTTP transport (claude.ai) ──────────────────────────────────
  const httpSessions = new Map<string, StreamableHTTPServerTransport>();

  app.all("/mcp", express.json(), async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && httpSessions.has(sessionId)) {
      // Existing session
      await httpSessions.get(sessionId)!.handleRequest(req, res, req.body);
    } else if (!sessionId && req.method === "POST") {
      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      transport.onclose = () => {
        if (transport.sessionId) httpSessions.delete(transport.sessionId);
      };
      await mcpServer.connect(transport);
      if (transport.sessionId) httpSessions.set(transport.sessionId, transport);
      await transport.handleRequest(req, res, req.body);
    } else {
      res.status(400).json({ error: "Missing or invalid mcp-session-id" });
    }
  });

  // ── Legacy SSE transport (Claude Desktop) ─────────────────────────────────
  const sseSessions = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, transport);
    res.on("close", () => sseSessions.delete(transport.sessionId));
    await mcpServer.connect(transport);
  });

  app.post("/messages", express.json(), async (req, res) => {
    const transport = sseSessions.get(req.query.sessionId as string);
    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  // Health check for Railway
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(PORT, () => {
    console.error(`MCP server running on port ${PORT}`);
    console.error(`- claude.ai endpoint: https://your-domain.up.railway.app/mcp`);
    console.error(`- Claude Desktop endpoint: https://your-domain.up.railway.app/sse`);
  });
}
