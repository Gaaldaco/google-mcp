import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
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
// TOOL DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const TOOLS: ToolDef[] = [
  // ── GOOGLE DRIVE TOOLS ────────────────────────────────────────────────────
  {
    name: "drive_list_files",
    description: "List files and folders in Google Drive. Optionally filter by parent folder or search query.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: {
          type: "number",
          description: "Number of files to return (1-1000)",
          default: 10,
        },
        parent_id: {
          type: "string",
          description: "Parent folder ID to list files from",
        },
        query: {
          type: "string",
          description: 'Additional query string (e.g., "mimeType!=\'application/vnd.google-apps.folder\'")',
        },
      },
    },
    handler: async (args) => {
      const files = await google.driveListFiles(
        (args.pageSize as number) || 10,
        args.parent_id as string | undefined,
        args.query as string | undefined
      );
      return JSON.stringify(files, null, 2);
    },
  },

  {
    name: "drive_search_files",
    description: "Search for files in Google Drive by name or content.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'budget' or 'project proposal')",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      const files = await google.driveSearchFiles(args.query as string);
      return JSON.stringify(files, null, 2);
    },
  },

  {
    name: "drive_get_file",
    description: "Get metadata for a specific file in Google Drive.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "Google Drive file ID",
        },
      },
      required: ["file_id"],
    },
    handler: async (args) => {
      const file = await google.driveGetFile(args.file_id as string);
      return JSON.stringify(file, null, 2);
    },
  },

  {
    name: "drive_create_folder",
    description: "Create a new folder in Google Drive.",
    inputSchema: {
      type: "object",
      properties: {
        folder_name: {
          type: "string",
          description: "Name of the new folder",
        },
        parent_id: {
          type: "string",
          description: "Parent folder ID (default: root)",
        },
      },
      required: ["folder_name"],
    },
    handler: async (args) => {
      const folderId = await google.driveCreateFolder(
        args.folder_name as string,
        args.parent_id as string | undefined
      );
      return JSON.stringify({ folderId }, null, 2);
    },
  },

  {
    name: "drive_move_file",
    description: "Move a file to a different folder in Google Drive.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "Google Drive file ID",
        },
        new_parent_id: {
          type: "string",
          description: "New parent folder ID",
        },
      },
      required: ["file_id", "new_parent_id"],
    },
    handler: async (args) => {
      await google.driveMoveFile(args.file_id as string, args.new_parent_id as string);
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  {
    name: "drive_share_file",
    description: "Share a file or folder with another user or group.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "Google Drive file ID",
        },
        email: {
          type: "string",
          description: "Email address to share with",
        },
        role: {
          type: "string",
          enum: ["reader", "commenter", "writer"],
          description: "Permission role",
        },
      },
      required: ["file_id", "email", "role"],
    },
    handler: async (args) => {
      await google.driveShareFile(args.file_id as string, args.email as string, args.role as "viewer" | "commenter" | "editor");
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  // ── GOOGLE DOCS TOOLS ────────────────────────────────────────────────────
  {
    name: "docs_get_document",
    description: "Get the content and metadata of a Google Document.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Google Doc document ID",
        },
      },
      required: ["document_id"],
    },
    handler: async (args) => {
      const doc = await google.docsGetDocument(args.document_id as string);
      return JSON.stringify(doc, null, 2);
    },
  },

  {
    name: "docs_append_text",
    description: "Append text to the end of a Google Document.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Google Doc document ID",
        },
        text: {
          type: "string",
          description: "Text to append",
        },
      },
      required: ["document_id", "text"],
    },
    handler: async (args) => {
      await google.docsAppendText(args.document_id as string, args.text as string);
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  {
    name: "docs_replace_text",
    description: "Find and replace text in a Google Document.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Google Doc document ID",
        },
        find_text: {
          type: "string",
          description: "Text to find",
        },
        replace_text: {
          type: "string",
          description: "Text to replace with",
        },
      },
      required: ["document_id", "find_text", "replace_text"],
    },
    handler: async (args) => {
      await google.docsReplaceText(
        args.document_id as string,
        args.find_text as string,
        args.replace_text as string
      );
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  {
    name: "docs_insert_text",
    description: "Insert text at a specific position in a Google Document.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "Google Doc document ID",
        },
        text: {
          type: "string",
          description: "Text to insert",
        },
        index: {
          type: "number",
          description: "Character position to insert at",
        },
      },
      required: ["document_id", "text", "index"],
    },
    handler: async (args) => {
      await google.docsInsertText(args.document_id as string, args.text as string, args.index as number);
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  // ── GOOGLE SHEETS TOOLS ──────────────────────────────────────────────────
  {
    name: "sheets_get_spreadsheet",
    description: "Get metadata and sheet names for a Google Sheet.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "Google Sheet spreadsheet ID",
        },
      },
      required: ["spreadsheet_id"],
    },
    handler: async (args) => {
      const ss = await google.sheetsGetSpreadsheet(args.spreadsheet_id as string);
      return JSON.stringify(ss, null, 2);
    },
  },

  {
    name: "sheets_read_range",
    description: "Read values from a cell range in a Google Sheet (e.g. A1:D10).",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "Google Sheet spreadsheet ID",
        },
        range: {
          type: "string",
          description: "Cell range in A1 notation (e.g., 'Sheet1!A1:D10')",
        },
      },
      required: ["spreadsheet_id", "range"],
    },
    handler: async (args) => {
      const values = await google.sheetsReadRange(args.spreadsheet_id as string, args.range as string);
      return JSON.stringify(values, null, 2);
    },
  },

  {
    name: "sheets_write_range",
    description: "Write values to a cell range in a Google Sheet.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "Google Sheet spreadsheet ID",
        },
        range: {
          type: "string",
          description: "Cell range in A1 notation (e.g., 'Sheet1!A1:D10')",
        },
        values: {
          type: "array",
          description: "2D array of values to write (rows × columns)",
        },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
    handler: async (args) => {
      await google.sheetsWriteRange(
        args.spreadsheet_id as string,
        args.range as string,
        args.values as unknown[][]
      );
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  {
    name: "sheets_create_spreadsheet",
    description: "Create a new Google Sheet.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Name of the new spreadsheet",
        },
      },
      required: ["title"],
    },
    handler: async (args) => {
      const spreadsheetId = await google.sheetsCreateSpreadsheet(args.title as string);
      return JSON.stringify({ spreadsheetId }, null, 2);
    },
  },

  {
    name: "sheets_add_sheet",
    description: "Add a new sheet/tab to a Google Sheet.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "Google Sheet spreadsheet ID",
        },
        sheet_title: {
          type: "string",
          description: "Name of the new sheet",
        },
      },
      required: ["spreadsheet_id", "sheet_title"],
    },
    handler: async (args) => {
      const sheetId = await google.sheetsAddSheet(args.spreadsheet_id as string, args.sheet_title as string);
      return JSON.stringify({ sheetId }, null, 2);
    },
  },

  {
    name: "sheets_delete_sheet",
    description: "Delete a sheet/tab from a Google Sheet.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "Google Sheet spreadsheet ID",
        },
        sheet_title: {
          type: "string",
          description: "Name of the sheet to delete",
        },
      },
      required: ["spreadsheet_id", "sheet_title"],
    },
    handler: async (args) => {
      await google.sheetsDeleteSheet(args.spreadsheet_id as string, args.sheet_title as string);
      return JSON.stringify({ success: true }, null, 2);
    },
  },

  {
    name: "sheets_clear_range",
    description: "Clear all values from a cell range in a Google Sheet.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "Google Sheet spreadsheet ID",
        },
        range: {
          type: "string",
          description: "Cell range to clear (e.g., 'Sheet1!A1:D10')",
        },
      },
      required: ["spreadsheet_id", "range"],
    },
    handler: async (args) => {
      await google.sheetsClearRange(args.spreadsheet_id as string, args.range as string);
      return JSON.stringify({ success: true }, null, 2);
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// MCP SERVER SETUP
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server({
  name: "google-mcp",
  version: "1.0.0",
});

// Register ListTools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Register CallTool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS.find((t) => t.name === name);

  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: `Tool "${name}" not found`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args || {});
    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool "${name}": ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT SETUP
// ─────────────────────────────────────────────────────────────────────────────

if (TRANSPORT === "stdio") {
  // Claude Desktop (local, stdio transport)
  await server.connect(new StdioServerTransport());
  console.error("MCP server running on stdio");
} else {
  // HTTP transport (Railway, claude.ai)
  const app = express();

  // CORS headers
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
      await server.connect(transport);
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

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(PORT, () => {
    console.error(`MCP server running on port ${PORT}`);
    console.error(`- claude.ai endpoint: https://your-domain.up.railway.app/mcp`);
    console.error(`- Claude Desktop endpoint: https://your-domain.up.railway.app/sse`);
  });
}
