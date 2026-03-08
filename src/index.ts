import "dotenv/config";
import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import * as google from "./google.js";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const TRANSPORT = process.env.TRANSPORT ?? "http";

if (!google.accessToken && !google.refreshToken) {
  console.warn("[index] No Google tokens configured — API calls will fail");
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOLS LIST
// ─────────────────────────────────────────────────────────────────────────────

const tools = [
  {
    name: "drive_list_files",
    description: "List files and folders in Google Drive. Optionally filter by parent folder or search query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        pageSize: { type: "number" as const, description: "Number of files to return (1-1000)", default: 10 },
        parent_id: { type: "string" as const, description: "Parent folder ID to list files from" },
        query: { type: "string" as const, description: "Additional query string" },
      },
    },
  },
  {
    name: "drive_search_files",
    description: "Search for files in Google Drive by name or content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_get_file",
    description: "Get metadata for a specific file in Google Drive.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string" as const, description: "Google Drive file ID" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "drive_create_folder",
    description: "Create a new folder in Google Drive.",
    inputSchema: {
      type: "object" as const,
      properties: {
        folder_name: { type: "string" as const, description: "Name of the new folder" },
        parent_id: { type: "string" as const, description: "Parent folder ID (default: root)" },
      },
      required: ["folder_name"],
    },
  },
  {
    name: "drive_move_file",
    description: "Move a file to a different folder in Google Drive.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string" as const, description: "Google Drive file ID" },
        new_parent_id: { type: "string" as const, description: "New parent folder ID" },
      },
      required: ["file_id", "new_parent_id"],
    },
  },
  {
    name: "drive_share_file",
    description: "Share a file or folder with another user or group.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string" as const, description: "Google Drive file ID" },
        email: { type: "string" as const, description: "Email address to share with" },
        role: { type: "string" as const, enum: ["reader", "commenter", "writer"], description: "Permission role" },
      },
      required: ["file_id", "email", "role"],
    },
  },
  {
    name: "docs_get_document",
    description: "Get the content and metadata of a Google Document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string" as const, description: "Google Doc document ID" },
      },
      required: ["document_id"],
    },
  },
  {
    name: "docs_append_text",
    description: "Append text to the end of a Google Document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string" as const, description: "Google Doc document ID" },
        text: { type: "string" as const, description: "Text to append" },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "docs_replace_text",
    description: "Find and replace text in a Google Document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string" as const, description: "Google Doc document ID" },
        find_text: { type: "string" as const, description: "Text to find" },
        replace_text: { type: "string" as const, description: "Text to replace with" },
      },
      required: ["document_id", "find_text", "replace_text"],
    },
  },
  {
    name: "docs_insert_text",
    description: "Insert text at a specific position in a Google Document.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: { type: "string" as const, description: "Google Doc document ID" },
        text: { type: "string" as const, description: "Text to insert" },
        index: { type: "number" as const, description: "Character position to insert at" },
      },
      required: ["document_id", "text", "index"],
    },
  },
  {
    name: "sheets_get_spreadsheet",
    description: "Get metadata and sheet names for a Google Sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string" as const, description: "Google Sheet spreadsheet ID" },
      },
      required: ["spreadsheet_id"],
    },
  },
  {
    name: "sheets_read_range",
    description: "Read values from a cell range in a Google Sheet (e.g. A1:D10).",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string" as const, description: "Google Sheet spreadsheet ID" },
        range: { type: "string" as const, description: "Cell range in A1 notation" },
      },
      required: ["spreadsheet_id", "range"],
    },
  },
  {
    name: "sheets_write_range",
    description: "Write values to a cell range in a Google Sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string" as const, description: "Google Sheet spreadsheet ID" },
        range: { type: "string" as const, description: "Cell range in A1 notation" },
        values: { type: "array" as const, description: "2D array of values to write" },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "sheets_create_spreadsheet",
    description: "Create a new Google Sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" as const, description: "Name of the new spreadsheet" },
      },
      required: ["title"],
    },
  },
  {
    name: "sheets_add_sheet",
    description: "Add a new sheet/tab to a Google Sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string" as const, description: "Google Sheet spreadsheet ID" },
        sheet_title: { type: "string" as const, description: "Name of the new sheet" },
      },
      required: ["spreadsheet_id", "sheet_title"],
    },
  },
  {
    name: "sheets_delete_sheet",
    description: "Delete a sheet/tab from a Google Sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string" as const, description: "Google Sheet spreadsheet ID" },
        sheet_title: { type: "string" as const, description: "Name of the sheet to delete" },
      },
      required: ["spreadsheet_id", "sheet_title"],
    },
  },
  {
    name: "sheets_clear_range",
    description: "Clear all values from a cell range in a Google Sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: { type: "string" as const, description: "Google Sheet spreadsheet ID" },
        range: { type: "string" as const, description: "Cell range to clear" },
      },
      required: ["spreadsheet_id", "range"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT SETUP
// ─────────────────────────────────────────────────────────────────────────────

if (TRANSPORT === "stdio") {
  // Claude Desktop (local, stdio transport)
  const server = new Server(
    { name: "google-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return { content: [{ type: "text", text: `Tool "${name}" not found` }], isError: true };
    }

    try {
      let result: string;
      switch (name) {
        case "drive_list_files":
          result = JSON.stringify(await google.driveListFiles((args?.pageSize as number) || 10, args?.parent_id as string, args?.query as string));
          break;
        case "drive_search_files":
          result = JSON.stringify(await google.driveSearchFiles(args?.query as string));
          break;
        case "drive_get_file":
          result = JSON.stringify(await google.driveGetFile(args?.file_id as string));
          break;
        case "drive_create_folder":
          result = JSON.stringify({ folderId: await google.driveCreateFolder(args?.folder_name as string, args?.parent_id as string) });
          break;
        case "drive_move_file":
          await google.driveMoveFile(args?.file_id as string, args?.new_parent_id as string);
          result = JSON.stringify({ success: true });
          break;
        case "drive_share_file":
          await google.driveShareFile(args?.file_id as string, args?.email as string, args?.role as "viewer" | "commenter" | "editor");
          result = JSON.stringify({ success: true });
          break;
        case "docs_get_document":
          result = JSON.stringify(await google.docsGetDocument(args?.document_id as string));
          break;
        case "docs_append_text":
          await google.docsAppendText(args?.document_id as string, args?.text as string);
          result = JSON.stringify({ success: true });
          break;
        case "docs_replace_text":
          await google.docsReplaceText(args?.document_id as string, args?.find_text as string, args?.replace_text as string);
          result = JSON.stringify({ success: true });
          break;
        case "docs_insert_text":
          await google.docsInsertText(args?.document_id as string, args?.text as string, args?.index as number);
          result = JSON.stringify({ success: true });
          break;
        case "sheets_get_spreadsheet":
          result = JSON.stringify(await google.sheetsGetSpreadsheet(args?.spreadsheet_id as string));
          break;
        case "sheets_read_range":
          result = JSON.stringify(await google.sheetsReadRange(args?.spreadsheet_id as string, args?.range as string));
          break;
        case "sheets_write_range":
          await google.sheetsWriteRange(args?.spreadsheet_id as string, args?.range as string, args?.values as unknown[][]);
          result = JSON.stringify({ success: true });
          break;
        case "sheets_create_spreadsheet":
          result = JSON.stringify({ spreadsheetId: await google.sheetsCreateSpreadsheet(args?.title as string) });
          break;
        case "sheets_add_sheet":
          result = JSON.stringify({ sheetId: await google.sheetsAddSheet(args?.spreadsheet_id as string, args?.sheet_title as string) });
          break;
        case "sheets_delete_sheet":
          await google.sheetsDeleteSheet(args?.spreadsheet_id as string, args?.sheet_title as string);
          result = JSON.stringify({ success: true });
          break;
        case "sheets_clear_range":
          await google.sheetsClearRange(args?.spreadsheet_id as string, args?.range as string);
          result = JSON.stringify({ success: true });
          break;
        default:
          result = JSON.stringify({ error: `Unknown tool: ${name}` });
      }
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
  console.error("MCP server running on stdio");
} else {
  // HTTP transport
  const app = express();

  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, accept");
    next();
  });
  app.options("*", (_req, res) => res.sendStatus(204));

  // Simple JSON endpoint for tools list
  app.get("/mcp", (_req, res) => {
    res.json({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  // SSE transport for Claude Desktop
  const sseSessions = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req, res) => {
    const server = new Server({ name: "google-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        return { content: [{ type: "text", text: `Tool "${name}" not found` }], isError: true };
      }

      try {
        let result: string;
        switch (name) {
          case "drive_list_files":
            result = JSON.stringify(await google.driveListFiles((args?.pageSize as number) || 10, args?.parent_id as string, args?.query as string));
            break;
          case "drive_search_files":
            result = JSON.stringify(await google.driveSearchFiles(args?.query as string));
            break;
          case "drive_get_file":
            result = JSON.stringify(await google.driveGetFile(args?.file_id as string));
            break;
          case "drive_create_folder":
            result = JSON.stringify({ folderId: await google.driveCreateFolder(args?.folder_name as string, args?.parent_id as string) });
            break;
          case "drive_move_file":
            await google.driveMoveFile(args?.file_id as string, args?.new_parent_id as string);
            result = JSON.stringify({ success: true });
            break;
          case "drive_share_file":
            await google.driveShareFile(args?.file_id as string, args?.email as string, args?.role as "viewer" | "commenter" | "editor");
            result = JSON.stringify({ success: true });
            break;
          case "docs_get_document":
            result = JSON.stringify(await google.docsGetDocument(args?.document_id as string));
            break;
          case "docs_append_text":
            await google.docsAppendText(args?.document_id as string, args?.text as string);
            result = JSON.stringify({ success: true });
            break;
          case "docs_replace_text":
            await google.docsReplaceText(args?.document_id as string, args?.find_text as string, args?.replace_text as string);
            result = JSON.stringify({ success: true });
            break;
          case "docs_insert_text":
            await google.docsInsertText(args?.document_id as string, args?.text as string, args?.index as number);
            result = JSON.stringify({ success: true });
            break;
          case "sheets_get_spreadsheet":
            result = JSON.stringify(await google.sheetsGetSpreadsheet(args?.spreadsheet_id as string));
            break;
          case "sheets_read_range":
            result = JSON.stringify(await google.sheetsReadRange(args?.spreadsheet_id as string, args?.range as string));
            break;
          case "sheets_write_range":
            await google.sheetsWriteRange(args?.spreadsheet_id as string, args?.range as string, args?.values as unknown[][]);
            result = JSON.stringify({ success: true });
            break;
          case "sheets_create_spreadsheet":
            result = JSON.stringify({ spreadsheetId: await google.sheetsCreateSpreadsheet(args?.title as string) });
            break;
          case "sheets_add_sheet":
            result = JSON.stringify({ sheetId: await google.sheetsAddSheet(args?.spreadsheet_id as string, args?.sheet_title as string) });
            break;
          case "sheets_delete_sheet":
            await google.sheetsDeleteSheet(args?.spreadsheet_id as string, args?.sheet_title as string);
            result = JSON.stringify({ success: true });
            break;
          case "sheets_clear_range":
            await google.sheetsClearRange(args?.spreadsheet_id as string, args?.range as string);
            result = JSON.stringify({ success: true });
            break;
          default:
            result = JSON.stringify({ error: `Unknown tool: ${name}` });
        }
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    });

    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, transport);
    res.on("close", () => sseSessions.delete(transport.sessionId));
    await server.connect(transport);
  });

  app.post("/messages", express.json(), async (req, res) => {
    const transport = sseSessions.get(req.query.sessionId as string);
    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.listen(PORT, () => {
    console.error(`MCP server running on port ${PORT}`);
    console.error(`- claude.ai endpoint: https://your-domain.up.railway.app/mcp`);
    console.error(`- Claude Desktop endpoint: https://your-domain.up.railway.app/sse`);
  });
}
