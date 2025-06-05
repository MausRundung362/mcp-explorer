import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

// Tool definition
export const listAllowedTool = {
  name: "list_allowed_directories",
  description: "Returns the list of directories that this MCP server is allowed to access. This is useful for understanding which directories can be explored or searched before attempting to use other tools. The allowed directories are configured when the server starts and cannot be modified at runtime.",
  inputSchema: {
    type: "object",
    properties: {},
    required: []
  }
};

// Tool handler
export async function handleListAllowed(args: any, allowedDirectories: string[]) {
  console.error("LIST_ALLOWED_DIRECTORIES called, returning:", allowedDirectories);
  
  return {
    toolResult: {
      allowedDirectories: allowedDirectories
    }
  };
}
