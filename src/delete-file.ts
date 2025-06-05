import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';

export interface DeleteResult {
  success: boolean;
  deletedPath: string;
  type: 'file' | 'directory';
  message: string;
}

export const deleteFileTool = {
  name: "delete_file",
  description: "Delete a file or directory. Use with extreme caution as this operation cannot be undone. When deleting directories, all contents will be permanently removed. The recursive option must be explicitly set to true to delete non-empty directories. Only works within allowed directories.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file or directory to delete"
      },
      recursive: {
        type: "boolean",
        description: "Set to true to delete directories and their contents recursively. Required for non-empty directories.",
        default: false
      },
      force: {
        type: "boolean", 
        description: "Set to true to force deletion even if file is read-only. Use with caution.",
        default: false
      }
    },
    required: ["path"],
    additionalProperties: false
  }
};

export async function handleDeleteFile(args: any, allowedDirectories: string[]) {
  const { path: targetPath, recursive = false, force = false } = args;

  if (!targetPath) {
    throw new McpError(ErrorCode.InvalidParams, "Path is required");
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(targetPath);

  // Check if path is within allowed directories
  const isPathAllowed = allowedDirectories.some(dir => {
    const normalizedDir = path.resolve(dir);
    return resolvedPath.startsWith(normalizedDir);
  });

  if (!isPathAllowed) {
    throw new McpError(ErrorCode.InvalidParams, `Path "${resolvedPath}" is not within allowed directories`);
  }

  try {
    // Check if path exists
    if (!fs.existsSync(resolvedPath)) {
      throw new McpError(ErrorCode.InvalidParams, `Path "${resolvedPath}" does not exist`);
    }

    // Get file stats to determine if it's a file or directory
    const stats = fs.statSync(resolvedPath);
    const isDirectory = stats.isDirectory();

    if (isDirectory) {
      // Check if directory is empty
      const contents = fs.readdirSync(resolvedPath);
      const isEmpty = contents.length === 0;

      if (!isEmpty && !recursive) {
        throw new McpError(
          ErrorCode.InvalidParams, 
          `Directory "${resolvedPath}" is not empty. Set recursive=true to delete directory and all its contents.`
        );
      }

      // Delete directory
      if (recursive) {
        fs.rmSync(resolvedPath, { recursive: true, force: force });
      } else {
        fs.rmdirSync(resolvedPath);
      }

      return {
        toolResult: {
          success: true,
          deletedPath: resolvedPath,
          type: 'directory',
          message: `Successfully deleted directory "${targetPath}"${recursive ? ' and all its contents' : ''}`
        }
      };

    } else {
      // Delete file
      if (force) {
        // Remove read-only attribute if forcing
        try {
          fs.chmodSync(resolvedPath, 0o666);
        } catch (chmodError) {
          // Ignore chmod errors, proceed with deletion
        }
      }

      fs.unlinkSync(resolvedPath);

      return {
        toolResult: {
          success: true,
          deletedPath: resolvedPath,
          type: 'file',
          message: `Successfully deleted file "${targetPath}"`
        }
      };
    }

  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }

    // Provide more specific error messages
    let errorMessage = `Failed to delete "${targetPath}": ${error.message}`;
    
    if (error.code === 'ENOTEMPTY') {
      errorMessage = `Directory "${targetPath}" is not empty. Use recursive=true to delete directory and contents.`;
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      errorMessage = `Permission denied when trying to delete "${targetPath}". Try using force=true or check file permissions.`;
    } else if (error.code === 'EBUSY') {
      errorMessage = `File "${targetPath}" is currently in use and cannot be deleted.`;
    }
    
    throw new McpError(ErrorCode.InternalError, errorMessage);
  }
}
