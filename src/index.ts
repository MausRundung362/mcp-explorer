#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

// Import modular tools and handlers
import { exploreProjectTool, handleExploreProject } from './explore-project.js';
import { listAllowedTool, handleListAllowed } from './list-allowed.js';
import { searchTool, handleSearch } from './search.js';
import { renameFileTool, handleRenameFile } from './rename-file.js';
import { deleteFileTool, handleDeleteFile } from './delete-file.js';
import { checkOutdatedTool, handleCheckOutdated } from './check-outdated.js';

// Get allowed directories from command line arguments (all args after the script path)
const ALLOWED_DIRECTORIES = process.argv.slice(2).map(dir => dir.replace(/\\/g, '/'));

// Log the command arguments for debugging
console.error("Command arguments:", process.argv);
console.error("Allowed directories:", ALLOWED_DIRECTORIES);

// Initialize the MCP server
const server = new Server({
  name: "project-explorer",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {}
  }
});

// Define available tools using imported tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("LIST TOOLS called, returning allowed dirs:", ALLOWED_DIRECTORIES);
  
  return {
    tools: [
      exploreProjectTool,
      listAllowedTool,
      searchTool,
      renameFileTool,
      deleteFileTool,
      checkOutdatedTool
    ]
  };
});

// Handle tool execution using imported handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error("TOOL CALL received:", request.params.name);
  
  // Safely access arguments with null checking
  const args = request.params.arguments || {};
  
  // Route to appropriate handler based on tool name
  switch (request.params.name) {
    case "list_allowed_directories":
      return await handleListAllowed(args, ALLOWED_DIRECTORIES);
      
    case "explore_project":
      return await handleExploreProject(args, ALLOWED_DIRECTORIES);
      
    case "search_files":
      return await handleSearch(args, ALLOWED_DIRECTORIES);
      
    case "rename_file":
      return await handleRenameFile(args, ALLOWED_DIRECTORIES);
      
    case "delete_file":
      return await handleDeleteFile(args, ALLOWED_DIRECTORIES);
      
    case "check_outdated":
      return await handleCheckOutdated(args, ALLOWED_DIRECTORIES);
      
    default:
      throw new McpError(
        ErrorCode.InvalidRequest, 
        `Unknown tool: ${request.params.name}`
      );
  }
});

// Start the server
const transport = new StdioServerTransport();
console.error("Server starting with allowed directories:", ALLOWED_DIRECTORIES);
await server.connect(transport);
