import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as google from "./google.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const TRANSPORT = process.env.TRANSPORT ?? "http";

if (!google.accessToken && !google.refreshToken) {
  console.warn("[index] No Google tokens configured — API calls will fail");
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER FACTORY — creates a fresh Server + registers all handlers
// ─────────────────────────────────────────────────────────────────────────────

function createServer(): Server {
  const server = new Server(
    { name: "google-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "drive_list_files",
        description: "List files and folders in Google Drive.",
        inputSchema: {
          type: "object",
          properties: {
            pageSize: { type: "number", description: "Number of files to return (1-1000)", default: 10 },
            parent_id: { type: "string", description: "Parent folder ID to list files from" },
            query: { type: "string", description: "Additional Drive query string" },
          },
        },
      },
      {
        name: "drive_search_files",
        description: "Search for files in Google Drive by name or content.",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        },
      },
      {
        name: "drive_get_file",
        description: "Get metadata for a specific file in Google Drive.",
        inputSchema: {
          type: "object",
          properties: { file_id: { type: "string", description: "Google Drive file ID" } },
          required: ["file_id"],
        },
      },
      {
        name: "drive_create_folder",
        description: "Create a new folder in Google Drive.",
        inputSchema: {
          type: "object",
          properties: {
            folder_name: { type: "string", description: "Name of the new folder" },
            parent_id: { type: "string", description: "Parent folder ID (default: root)" },
          },
          required: ["folder_name"],
        },
      },
      {
        name: "drive_move_file",
        description: "Move a file to a different folder in Google Drive.",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "Google Drive file ID" },
            new_parent_id: { type: "string", description: "New parent folder ID" },
          },
          required: ["file_id", "new_parent_id"],
        },
      },
      {
        name: "drive_share_file",
        description: "Share a file or folder with another user.",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "Google Drive file ID" },
            email: { type: "string", description: "Email address to share with" },
            role: { type: "string", enum: ["reader", "commenter", "writer"], description: "Permission role" },
          },
          required: ["file_id", "email", "role"],
        },
      },
      {
        name: "docs_get_document",
        description: "Get the content and metadata of a Google Document.",
        inputSchema: {
          type: "object",
          properties: { document_id: { type: "string", description: "Google Doc document ID" } },
          required: ["document_id"],
        },
      },
      {
        name: "docs_append_text",
        description: "Append text to the end of a Google Document.",
        inputSchema: {
          type: "object",
          properties: {
            document_id: { type: "string", description: "Google Doc document ID" },
            text: { type: "string", description: "Text to append" },
          },
          required: ["document_id", "text"],
        },
      },
      {
        name: "docs_replace_text",
        description: "Find and replace text in a Google Document.",
        inputSchema: {
          type: "object",
          properties: {
            document_id: { type: "string", description: "Google Doc document ID" },
            find_text: { type: "string", description: "Text to find" },
            replace_text: { type: "string", description: "Text to replace with" },
          },
          required: ["document_id", "find_text", "replace_text"],
        },
      },
      {
        name: "docs_insert_text",
        description: "Insert text at a specific position in a Google Document.",
        inputSchema: {
          type: "object",
          properties: {
            document_id: { type: "string", description: "Google Doc document ID" },
            text: { type: "string", description: "Text to insert" },
            index: { type: "number", description: "Character position to insert at" },
          },
          required: ["document_id", "text", "index"],
        },
      },
      {
        name: "sheets_get_spreadsheet",
        description: "Get metadata and sheet names for a Google Sheet.",
        inputSchema: {
          type: "object",
          properties: { spreadsheet_id: { type: "string", description: "Google Sheet spreadsheet ID" } },
          required: ["spreadsheet_id"],
        },
      },
      {
        name: "sheets_read_range",
        description: "Read values from a cell range in a Google Sheet (e.g. A1:D10).",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Google Sheet spreadsheet ID" },
            range: { type: "string", description: "Cell range in A1 notation (e.g., 'Sheet1!A1:D10')" },
          },
          required: ["spreadsheet_id", "range"],
        },
      },
      {
        name: "sheets_write_range",
        description: "Write values to a cell range in a Google Sheet.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Google Sheet spreadsheet ID" },
            range: { type: "string", description: "Cell range in A1 notation" },
            values: { type: "array", description: "2D array of values to write (rows × columns)" },
          },
          required: ["spreadsheet_id", "range", "values"],
        },
      },
      {
        name: "sheets_create_spreadsheet",
        description: "Create a new Google Sheet.",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string", description: "Name of the new spreadsheet" } },
          required: ["title"],
        },
      },
      {
        name: "sheets_add_sheet",
        description: "Add a new sheet/tab to a Google Sheet.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Google Sheet spreadsheet ID" },
            sheet_title: { type: "string", description: "Name of the new sheet" },
          },
          required: ["spreadsheet_id", "sheet_title"],
        },
      },
      {
        name: "sheets_delete_sheet",
        description: "Delete a sheet/tab from a Google Sheet.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Google Sheet spreadsheet ID" },
            sheet_title: { type: "string", description: "Name of the sheet to delete" },
          },
          required: ["spreadsheet_id", "sheet_title"],
        },
      },
      {
        name: "sheets_clear_range",
        description: "Clear all values from a cell range in a Google Sheet.",
        inputSchema: {
          type: "object",
          properties: {
            spreadsheet_id: { type: "string", description: "Google Sheet spreadsheet ID" },
            range: { type: "string", description: "Cell range to clear (e.g., 'Sheet1!A1:D10')" },
          },
          required: ["spreadsheet_id", "range"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      let text: string;
      switch (name) {
        case "drive_list_files":
          text = JSON.stringify(await google.driveListFiles((args.pageSize as number) || 10, args.parent_id as string, args.query as string), null, 2);
          break;
        case "drive_search_files":
          text = JSON.stringify(await google.driveSearchFiles(args.query as string), null, 2);
          break;
        case "drive_get_file":
          text = JSON.stringify(await google.driveGetFile(args.file_id as string), null, 2);
          break;
        case "drive_create_folder":
          text = JSON.stringify({ folderId: await google.driveCreateFolder(args.folder_name as string, args.parent_id as string | undefined) }, null, 2);
          break;
        case "drive_move_file":
          await google.driveMoveFile(args.file_id as string, args.new_parent_id as string);
          text = JSON.stringify({ success: true });
          break;
        case "drive_share_file":
          await google.driveShareFile(args.file_id as string, args.email as string, args.role as "viewer" | "commenter" | "editor");
          text = JSON.stringify({ success: true });
          break;
        case "docs_get_document":
          text = JSON.stringify(await google.docsGetDocument(args.document_id as string), null, 2);
          break;
        case "docs_append_text":
          await google.docsAppendText(args.document_id as string, args.text as string);
          text = JSON.stringify({ success: true });
          break;
        case "docs_replace_text":
          await google.docsReplaceText(args.document_id as string, args.find_text as string, args.replace_text as string);
          text = JSON.stringify({ success: true });
          break;
        case "docs_insert_text":
          await google.docsInsertText(args.document_id as string, args.text as string, args.index as number);
          text = JSON.stringify({ success: true });
          break;
        case "sheets_get_spreadsheet":
          text = JSON.stringify(await google.sheetsGetSpreadsheet(args.spreadsheet_id as string), null, 2);
          break;
        case "sheets_read_range":
          text = JSON.stringify(await google.sheetsReadRange(args.spreadsheet_id as string, args.range as string), null, 2);
          break;
        case "sheets_write_range":
          await google.sheetsWriteRange(args.spreadsheet_id as string, args.range as string, args.values as unknown[][]);
          text = JSON.stringify({ success: true });
          break;
        case "sheets_create_spreadsheet":
          text = JSON.stringify({ spreadsheetId: await google.sheetsCreateSpreadsheet(args.title as string) }, null, 2);
          break;
        case "sheets_add_sheet":
          text = JSON.stringify({ sheetId: await google.sheetsAddSheet(args.spreadsheet_id as string, args.sheet_title as string) }, null, 2);
          break;
        case "sheets_delete_sheet":
          await google.sheetsDeleteSheet(args.spreadsheet_id as string, args.sheet_title as string);
          text = JSON.stringify({ success: true });
          break;
        case "sheets_clear_range":
          await google.sheetsClearRange(args.spreadsheet_id as string, args.range as string);
          text = JSON.stringify({ success: true });
          break;
        default:
          return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT SETUP
// ─────────────────────────────────────────────────────────────────────────────

if (TRANSPORT === "stdio") {
  await createServer().connect(new StdioServerTransport());
  console.error("MCP server running on stdio");
} else {
  const app = express();

  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, accept");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  // ── StreamableHTTP — claude.ai ─────────────────────────────────────────────
  // Each new MCP session gets its own Server + Transport instance
  const httpSessions = new Map<string, { transport: StreamableHTTPServerTransport }>();

  app.all("/mcp", express.json(), async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && httpSessions.has(sessionId)) {
        // Route to existing session
        const { transport } = httpSessions.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — spin up a fresh Server + Transport
      const id = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => id,
      });
      transport.onclose = () => httpSessions.delete(id);

      const server = createServer();
      await server.connect(transport);
      httpSessions.set(id, { transport });

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // ── SSE — Claude Desktop ───────────────────────────────────────────────────
  const sseSessions = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, transport);
    res.on("close", () => sseSessions.delete(transport.sessionId));
    await createServer().connect(transport);
  });

  app.post("/messages", express.json(), async (req, res) => {
    const transport = sseSessions.get(req.query.sessionId as string);
    if (!transport) { res.status(404).json({ error: "Session not found" }); return; }
    await transport.handlePostMessage(req, res);
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.listen(PORT, () => {
    console.error(`MCP server running on port ${PORT}`);
    console.error(`- claude.ai: /mcp  |  Claude Desktop: /sse`);
  });
}
