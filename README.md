# google-mcp — Google Docs, Sheets & Drive MCP Server

A production-ready MCP server for Google Docs, Google Sheets, and Google Drive with OAuth token authentication. Deploy to Railway or run locally with Claude Desktop.

## Features

- **Google Drive**: List, search, create, move, copy, delete files and folders; manage sharing permissions
- **Google Docs**: Read, create, append, find-and-replace, and insert text into documents
- **Google Sheets**: Create spreadsheets, read/write ranges, append rows, manage sheets
- **OAuth Authentication**: Uses access tokens with automatic refresh on expiration
- **Dual Transport**: HTTP/SSE for claude.ai and Claude Desktop via stdio

## Setup

### 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable these APIs:
   - Google Drive API
   - Google Docs API
   - Google Sheets API

### 2. Create OAuth 2.0 Credentials

1. Go to **Credentials** in the Google Cloud Console
2. Click **Create Credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Authorized redirect URIs:
   - `https://your-api.up.railway.app/api/oauth/google/callback` (if using bridge-ai-ops for OAuth)
   - Or any OAuth callback URL you're using
5. Copy the **Client ID** and **Client Secret**

### 3. Get Google Tokens

Use the [bridge-ai-ops-api OAuth flow](https://github.com/Gaaldaco/bridge-ai-ops-api) to get OAuth tokens:

1. POST `/api/oauth/start` with `appId` for Google (set up in bridge-ai-ops app_catalog)
2. Get redirected to Google login
3. Authorize access to Docs, Sheets, Drive
4. Tokens are stored and can be exported via the platform

Or manually exchange an auth code:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "code=AUTH_CODE&client_id=CLIENT_ID&client_secret=CLIENT_SECRET&redirect_uri=REDIRECT_URI&grant_type=authorization_code"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth Client Secret from Google Cloud Console |
| `GOOGLE_ACCESS_TOKEN` | Yes | Short-lived OAuth access token |
| `GOOGLE_REFRESH_TOKEN` | Yes | Long-lived OAuth refresh token (for auto-refresh) |
| `TRANSPORT` | No | `http` (default) or `stdio` |
| `PORT` | No | Server port (default: `8080`) |

## Tools

### Google Drive (9 tools)

| Tool | Description |
|------|-------------|
| `drive_list_files` | List files and folders (optionally filter by parent or query) |
| `drive_search_files` | Full-text search across Drive |
| `drive_get_file` | Get file metadata and details |
| `drive_create_folder` | Create a new folder |
| `drive_move_file` | Move file to a different folder |
| `drive_copy_file` | Copy a file |
| `drive_delete_file` | Move file to trash |
| `drive_get_permissions` | Get sharing permissions for a file |
| `drive_share_file` | Share a file with an email address (viewer/commenter/editor) |

### Google Docs (6 tools)

| Tool | Description |
|------|-------------|
| `docs_get_document` | Get full document content (JSON format) |
| `docs_get_text` | Extract plain text from a document |
| `docs_create_document` | Create a new blank document |
| `docs_append_text` | Append text to the end of a document |
| `docs_replace_text` | Find and replace text in a document |
| `docs_insert_text` | Insert text at a specific character position |

### Google Sheets (8 tools)

| Tool | Description |
|------|-------------|
| `sheets_get_spreadsheet` | Get spreadsheet metadata and sheet names |
| `sheets_read_range` | Read values from a cell range (e.g., `Sheet1!A1:D10`) |
| `sheets_write_range` | Write values to a cell range |
| `sheets_create_spreadsheet` | Create a new spreadsheet |
| `sheets_append_rows` | Append rows of data to a sheet |
| `sheets_clear_range` | Clear all values in a cell range |
| `sheets_add_sheet` | Add a new sheet/tab |
| `sheets_delete_sheet` | Delete a sheet/tab by name |

## Local Development

```bash
npm install
npm run build

# Test locally
GOOGLE_ACCESS_TOKEN="..." GOOGLE_REFRESH_TOKEN="..." GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." npm start
```

Server will run on `http://localhost:8080`

- Health check: `curl http://localhost:8080/health`
- Claude Desktop connection: stdio with `TRANSPORT=stdio`

## Claude Desktop Configuration

### Remote (Railway HTTP)

```json
{
  "mcpServers": {
    "google": {
      "url": "https://your-app.up.railway.app/sse"
    }
  }
}
```

### Local (stdio)

```json
{
  "mcpServers": {
    "google": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_ACCESS_TOKEN": "your_access_token",
        "GOOGLE_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

## Railway Deployment

1. Create a GitHub repository and push this code
2. In Railway, create a new service → Deploy from GitHub
3. Select this repository
4. Set environment variables in Railway dashboard:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_ACCESS_TOKEN`
   - `GOOGLE_REFRESH_TOKEN`
5. Generate a domain: Settings → Networking → Generate Domain
6. Use `https://your-domain.up.railway.app/mcp` for claude.ai
7. Use `https://your-domain.up.railway.app/sse` for Claude Desktop

## License

MIT
