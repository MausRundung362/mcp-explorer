import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';

// Directories to exclude from scanning
const EXCLUDED_DIRS = ['.next', 'node_modules', '#export', '.git', 'dist', 'build'];

// File types to analyze for imports/exports
const CODE_FILE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const CONFIG_FILE_EXTENSIONS = ['.json'];
const ANALYZED_EXTENSIONS = [...CODE_FILE_EXTENSIONS, ...CONFIG_FILE_EXTENSIONS];

// Helper function to check if a path should be excluded
function shouldExcludePath(pathToCheck: string): boolean {
  const basename = path.basename(pathToCheck);
  return EXCLUDED_DIRS.includes(basename);
}

// Helper function to get file stats
async function getFileStats(filePath: string): Promise<{
  size: number;
  isEmpty: boolean;
  isFile: boolean;
  isDirectory: boolean;
} | null> {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      size: stats.size,
      isEmpty: stats.size === 0,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  } catch (error) {
    console.error(`Error getting stats for ${filePath}:`, error);
    return null;
  }
}

// Helper function to extract imports and exports
async function extractImportsAndExports(filePath: string): Promise<{imports: string[], exports: string[]}> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const imports = lines.filter(line => 
      line.trim().startsWith('import ') || 
      line.trim().includes('require(')
    );
    
    const exports = lines.filter(line => 
      line.trim().startsWith('export ') || 
      line.trim().includes('module.exports') ||
      line.trim().includes('exports.')
    );
    
    return { imports, exports };
  } catch (error) {
    console.error(`Error analyzing ${filePath}:`, error);
    return { imports: [], exports: [] };
  }
}

// Interface for file information
export interface FileInfo {
  path: string;
  size: number;
  sizeFormatted: string;
  isEmpty: boolean;
  imports?: string[];
  exports?: string[];
  fileType?: string;
}

// Helper function to recursively scan a directory
async function scanDirectory(dirPath: string, rootPath: string): Promise<FileInfo[]> {
  const results: FileInfo[] = [];
  
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      // Skip excluded directories
      if (entry.isDirectory() && shouldExcludePath(entryPath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subdirResults = await scanDirectory(entryPath, rootPath);
        results.push(...subdirResults);
      } else if (entry.isFile()) {
        const stats = await getFileStats(entryPath);
        
        if (!stats) continue;
        
        const fileInfo: FileInfo = {
          path: entryPath,
          size: stats.size,
          sizeFormatted: formatFileSize(stats.size),
          isEmpty: stats.isEmpty
        };
        
        // Check if this is a file type we should analyze for imports/exports
        const ext = path.extname(entryPath).toLowerCase();
        if (ANALYZED_EXTENSIONS.includes(ext)) {
          if (CODE_FILE_EXTENSIONS.includes(ext)) {
            const { imports, exports } = await extractImportsAndExports(entryPath);
            fileInfo.imports = imports;
            fileInfo.exports = exports;
          } else if (CONFIG_FILE_EXTENSIONS.includes(ext)) {
            fileInfo.fileType = 'config';
          }
        }
        
        results.push(fileInfo);
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dirPath}:`, error);
  }
  
  return results;
}

// Helper function to format file size to human-readable format
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to format the results into a readable text output
function formatResults(files: FileInfo[], dirPath: string): string {
  const lines: string[] = [];
  
  lines.push(`# Project Analysis Results for: ${dirPath}`);
  lines.push(`Total files found: ${files.length}\n`);
  
  // Sort files by path for easier reading
  files.sort((a, b) => a.path.localeCompare(b.path));
  
  for (const file of files) {
    // Display relative path
    const relativePath = path.relative(dirPath, file.path);
    lines.push(`## ${relativePath}`);
    lines.push(`Size: ${file.sizeFormatted} ${file.isEmpty ? '(Empty File)' : ''}`);
    
    if (file.imports && file.imports.length > 0) {
      lines.push(`\nImports:`);
      file.imports.forEach((imp: string) => lines.push(`- \`${imp.trim()}\``));
    }
    
    if (file.exports && file.exports.length > 0) {
      lines.push(`\nExports:`);
      file.exports.forEach((exp: string) => lines.push(`- \`${exp.trim()}\``));
    }
    
    lines.push(''); // Add empty line between files
  }
  
  return lines.join('\n');
}

// Helper function to check if a path is inside an allowed directory
function isPathAllowed(pathToCheck: string, allowedDirectories: string[]): boolean {
  const normalizedPath = path.normalize(pathToCheck).replace(/\\/g, '/');
  return allowedDirectories.some(dir => {
    const normalizedDir = path.normalize(dir).replace(/\\/g, '/');
    return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + '/');
  });
}

// Tool definition
export const exploreProjectTool = {
  name: "explore_project",
  description: "Lists all files in a directory with their sizes and imports/exports. Analyzes JavaScript/TypeScript files for import/export statements and provides detailed file information including size formatting. Excludes common build directories like node_modules, .git, dist, etc.",
  inputSchema: {
    type: "object",
    properties: {
      directory: { 
        type: "string",
        description: "The directory path to analyze"
      },
      subDirectory: {
        type: "string",
        description: "Optional subdirectory within the main directory to analyze",
        default: ""
      },
      includeHidden: { 
        type: "boolean", 
        description: "Whether to include hidden files and directories (starting with .)",
        default: false
      }
    },
    required: ["directory"]
  }
};

// Tool handler
export async function handleExploreProject(args: any, allowedDirectories: string[]) {
  const directory = args.directory as string;
  const subDirectory = args.subDirectory as string || "";
  const includeHidden = (args.includeHidden as boolean) || false;
  
  console.error(`EXPLORE_PROJECT called with directory=${directory}, subDirectory=${subDirectory}`);
  
  if (!directory) {
    throw new McpError(
      ErrorCode.InvalidRequest, 
      "Directory parameter is required"
    );
  }
  
  try {
    // Construct the full directory path
    let fullDirPath = directory;
    if (subDirectory) {
      fullDirPath = path.join(directory, subDirectory);
    }
    
    // Normalize path for comparison
    fullDirPath = path.normalize(fullDirPath);
    
    console.error(`Checking if path is allowed: ${fullDirPath}`);
    console.error(`Allowed directories: ${allowedDirectories.join(', ')}`);
    
    // Check if the path is allowed
    if (!isPathAllowed(fullDirPath, allowedDirectories)) {
      throw new McpError(
        ErrorCode.InvalidRequest, 
        `Access denied: The path '${fullDirPath}' is not in the list of allowed directories: ${allowedDirectories.join(', ')}`
      );
    }
    
    // Validate that the directory exists
    const dirStats = await getFileStats(fullDirPath);
    if (!dirStats || !dirStats.isDirectory) {
      throw new McpError(
        ErrorCode.InvalidRequest, 
        `The path '${fullDirPath}' does not exist or is not a directory.`
      );
    }
    
    console.error(`Scanning directory: ${fullDirPath}`);
    const files = await scanDirectory(fullDirPath, fullDirPath);
    
    // Filter out hidden files if not includeHidden
    const filteredFiles = includeHidden 
      ? files 
      : files.filter(file => !path.basename(file.path).startsWith('.'));
    
    const formattedResults = formatResults(filteredFiles, fullDirPath);
    
    return {
      toolResult: formattedResults
    };
  } catch (error) {
    console.error("Error in explore_project:", error);
    
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError, 
      `Error analyzing project: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
