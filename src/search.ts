import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import * as fs from 'fs';
import * as path from 'path';

// Interface for search results
export interface SearchResult {
  filePath: string;
  relativePath: string;
  matches: SearchMatch[];
  fileSize: number;
  fileSizeFormatted: string;
  lastModified: Date;
  fileExtension: string;
}

export interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
  snippet: string;
}

// Interface for search options
export interface SearchOptions {
  pattern: string;
  searchPath: string;
  extensions?: string[];
  excludeExtensions?: string[];
  excludePatterns?: string[];
  regexMode?: boolean;
  caseSensitive?: boolean;
  wordBoundary?: boolean;
  multiline?: boolean;
  maxDepth?: number;
  followSymlinks?: boolean;
  includeBinary?: boolean;
  minSize?: number;
  maxSize?: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
  snippetLength?: number;
  maxResults?: number;
  sortBy?: 'relevance' | 'file' | 'lineNumber' | 'modified' | 'size';
  groupByFile?: boolean;
  excludeComments?: boolean;
  excludeStrings?: boolean;
  outputFormat?: 'text' | 'json' | 'structured';
}

// Default excluded directories
const DEFAULT_EXCLUDED_DIRS = ['.git', 'node_modules', '.next', 'dist', 'build', '#export'];

// Helper function to check if a path should be excluded
function shouldExcludePath(pathToCheck: string, excludePatterns: string[]): boolean {
  const basename = path.basename(pathToCheck);
  
  // Check default excluded directories
  if (DEFAULT_EXCLUDED_DIRS.includes(basename)) {
    return true;
  }
  
  // Check custom exclude patterns
  return excludePatterns.some(pattern => {
    if (pattern.includes('*') || pattern.includes('?')) {
      // Simple glob pattern matching
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(regexPattern, 'i').test(basename);
    }
    return basename.includes(pattern);
  });
}

// Helper function to check if a path is inside an allowed directory
function isPathAllowed(pathToCheck: string, allowedDirectories: string[]): boolean {
  const normalizedPath = path.normalize(pathToCheck).replace(/\\/g, '/');
  return allowedDirectories.some(dir => {
    const normalizedDir = path.normalize(dir).replace(/\\/g, '/');
    return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + '/');
  });
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to check if file matches size criteria
function matchesSize(fileSize: number, minSize?: number, maxSize?: number): boolean {
  if (minSize !== undefined && fileSize < minSize) return false;
  if (maxSize !== undefined && fileSize > maxSize) return false;
  return true;
}

// Helper function to check if file matches date criteria
function matchesDate(fileStat: fs.Stats, modifiedAfter?: string, modifiedBefore?: string): boolean {
  if (modifiedAfter) {
    const afterDate = new Date(modifiedAfter);
    if (fileStat.mtime < afterDate) return false;
  }
  if (modifiedBefore) {
    const beforeDate = new Date(modifiedBefore);
    if (fileStat.mtime > beforeDate) return false;
  }
  return true;
}

// Helper function to check if file matches extension criteria
function matchesExtension(filePath: string, extensions?: string[], excludeExtensions?: string[]): boolean {
  const ext = path.extname(filePath).toLowerCase();
  
  if (excludeExtensions && excludeExtensions.some(excludeExt => 
    excludeExt.toLowerCase() === ext || excludeExt.toLowerCase() === ext.slice(1))) {
    return false;
  }
  
  if (extensions && extensions.length > 0) {
    return extensions.some(allowedExt => 
      allowedExt.toLowerCase() === ext || allowedExt.toLowerCase() === '.' + ext.slice(1));
  }
  
  return true;
}

// Helper function to check if content is likely binary
function isBinaryContent(content: Buffer): boolean {
  // Check for null bytes which are common in binary files
  for (let i = 0; i < Math.min(1024, content.length); i++) {
    if (content[i] === 0) return true;
  }
  return false;
}

// Helper function to remove comments and strings if specified
function preprocessContent(content: string, excludeComments: boolean, excludeStrings: boolean, fileExtension: string): string {
  if (!excludeComments && !excludeStrings) return content;
  
  let processed = content;
  
  // Remove comments based on file type
  if (excludeComments) {
    switch (fileExtension) {
      case '.js':
      case '.jsx':
      case '.ts':
      case '.tsx':
      case '.java':
      case '.c':
      case '.cpp':
      case '.cs':
        // Remove single-line comments
        processed = processed.replace(/\/\/.*$/gm, '');
        // Remove multi-line comments
        processed = processed.replace(/\/\*[\s\S]*?\*\//g, '');
        break;
      case '.py':
        // Remove Python comments
        processed = processed.replace(/#.*$/gm, '');
        break;
      case '.html':
      case '.xml':
        // Remove HTML/XML comments
        processed = processed.replace(/<!--[\s\S]*?-->/g, '');
        break;
    }
  }
  
  // Remove string literals if specified
  if (excludeStrings) {
    // Remove double-quoted strings
    processed = processed.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    // Remove single-quoted strings
    processed = processed.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    // Remove template literals (backticks)
    processed = processed.replace(/`(?:[^`\\]|\\.)*`/g, '``');
  }
  
  return processed;
}

// Main search function
async function searchInFile(filePath: string, options: SearchOptions): Promise<SearchMatch[]> {
  try {
    const content = await fs.promises.readFile(filePath);
    
    // Check if binary and skip if not allowed
    if (!options.includeBinary && isBinaryContent(content)) {
      return [];
    }
    
    const textContent = content.toString('utf-8');
    const fileExtension = path.extname(filePath).toLowerCase();
    
    // Preprocess content to remove comments/strings if specified
    const processedContent = preprocessContent(textContent, 
      options.excludeComments || false, 
      options.excludeStrings || false, 
      fileExtension);
    
    const lines = processedContent.split('\n');
    const matches: SearchMatch[] = [];
    
    // Create regex pattern
    let regexFlags = 'g';
    if (!options.caseSensitive) regexFlags += 'i';
    if (options.multiline) regexFlags += 'm';
    
    let pattern = options.pattern;
    if (!options.regexMode) {
      // Escape special regex characters if not in regex mode
      pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    if (options.wordBoundary) {
      pattern = `\\b${pattern}\\b`;
    }
    
    const regex = new RegExp(pattern, regexFlags);
    
    // Search through lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      
      while ((match = regex.exec(line)) !== null) {
        const snippetStart = Math.max(0, match.index - (options.snippetLength || 50));
        const snippetEnd = Math.min(line.length, match.index + match[0].length + (options.snippetLength || 50));
        
        matches.push({
          lineNumber: i + 1,
          lineContent: line,
          matchStart: match.index,
          matchEnd: match.index + match[0].length,
          snippet: line.substring(snippetStart, snippetEnd)
        });
        
        // Prevent infinite loop with zero-width matches
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    }
    
    return matches;
  } catch (error) {
    console.error(`Error searching in file ${filePath}:`, error);
    return [];
  }
}

// Recursive directory search
async function searchDirectory(
  dirPath: string, 
  options: SearchOptions, 
  allowedDirectories: string[],
  currentDepth: number = 0
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  if (options.maxDepth !== undefined && currentDepth > options.maxDepth) {
    return results;
  }
  
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      
      // Skip excluded paths
      if (shouldExcludePath(entryPath, options.excludePatterns || [])) {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const subdirResults = await searchDirectory(entryPath, options, allowedDirectories, currentDepth + 1);
        results.push(...subdirResults);
      } else if (entry.isFile() || (entry.isSymbolicLink() && options.followSymlinks)) {
        try {
          const stat = await fs.promises.stat(entryPath);
          
          // Check size criteria
          if (!matchesSize(stat.size, options.minSize, options.maxSize)) {
            continue;
          }
          
          // Check date criteria
          if (!matchesDate(stat, options.modifiedAfter, options.modifiedBefore)) {
            continue;
          }
          
          // Check extension criteria
          if (!matchesExtension(entryPath, options.extensions, options.excludeExtensions)) {
            continue;
          }
          
          // Search in file
          const matches = await searchInFile(entryPath, options);
          
          if (matches.length > 0) {
            const relativePath = options.searchPath ? path.relative(options.searchPath, entryPath) : entryPath;
            
            results.push({
              filePath: entryPath,
              relativePath: relativePath,
              matches: matches,
              fileSize: stat.size,
              fileSizeFormatted: formatFileSize(stat.size),
              lastModified: stat.mtime,
              fileExtension: path.extname(entryPath).toLowerCase()
            });
          }
        } catch (error) {
          console.error(`Error processing file ${entryPath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error searching directory ${dirPath}:`, error);
  }
  
  return results;
}

// Sort results based on criteria
function sortResults(results: SearchResult[], sortBy: string): SearchResult[] {
  switch (sortBy) {
    case 'file':
      return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    case 'lineNumber':
      return results.sort((a, b) => a.matches[0]?.lineNumber - b.matches[0]?.lineNumber);
    case 'modified':
      return results.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    case 'size':
      return results.sort((a, b) => b.fileSize - a.fileSize);
    case 'relevance':
    default:
      return results.sort((a, b) => b.matches.length - a.matches.length);
  }
}

// Format results for output
function formatResults(results: SearchResult[], options: SearchOptions): string {
  if (options.outputFormat === 'json') {
    return JSON.stringify(results, null, 2);
  }
  
  const lines: string[] = [];
  
  if (results.length === 0) {
    lines.push(`No matches found for pattern: ${options.pattern}`);
    return lines.join('\n');
  }
  
  lines.push(`# Search Results for: "${options.pattern}"`);
  lines.push(`Found ${results.length} file(s) with matches\n`);
  
  if (options.groupByFile) {
    // Group results by file
    for (const result of results) {
      lines.push(`## ${result.relativePath}`);
      lines.push(`Size: ${result.fileSizeFormatted} | Modified: ${result.lastModified.toISOString()}`);
      lines.push(`Matches: ${result.matches.length}\n`);
      
      for (const match of result.matches.slice(0, 10)) { // Limit to 10 matches per file
        lines.push(`Line ${match.lineNumber}: ${match.snippet}`);
      }
      
      if (result.matches.length > 10) {
        lines.push(`... and ${result.matches.length - 10} more matches`);
      }
      
      lines.push('');
    }
  } else {
    // Flat list of all matches
    let totalMatches = 0;
    for (const result of results) {
      for (const match of result.matches) {
        if (totalMatches >= (options.maxResults || 100)) break;
        lines.push(`${result.relativePath}:${match.lineNumber}: ${match.snippet}`);
        totalMatches++;
      }
      if (totalMatches >= (options.maxResults || 100)) break;
    }
    
    if (totalMatches >= (options.maxResults || 100)) {
      lines.push(`\n... search truncated at ${options.maxResults || 100} results`);
    }
  }
  
  return lines.join('\n');
}

// Tool definition
export const searchTool = {
  name: "search_files",
  description: "Advanced file and code search tool with comprehensive filtering and matching capabilities. Searches for patterns in files within allowed directories with support for regex patterns, file type filtering, size constraints, date filtering, and content preprocessing. When called without arguments, searches for common patterns in the current directory. Supports excluding comments and string literals for cleaner code searches. Results can be formatted as text, JSON, or structured output with configurable sorting and grouping options.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Search pattern - can be literal text or regex depending on regexMode. Defaults to searching for common file types if not specified",
        default: ".*"
      },
      searchPath: {
        type: "string",
        description: "Directory path to search in. Must be within allowed directories. Defaults to first allowed directory if not specified"
      },
      extensions: {
        type: "array",
        items: { type: "string" },
        description: "Array of file extensions to include (e.g., ['.js', '.ts', '.py']). Include the dot prefix"
      },
      excludeExtensions: {
        type: "array",
        items: { type: "string" },
        description: "Array of file extensions to exclude"
      },
      excludePatterns: {
        type: "array",
        items: { type: "string" },
        description: "Array of filename patterns to exclude (supports simple wildcards)"
      },
      regexMode: {
        type: "boolean",
        description: "Whether to treat pattern as a regular expression",
        default: false
      },
      caseSensitive: {
        type: "boolean",
        description: "Whether search should be case sensitive",
        default: false
      },
      wordBoundary: {
        type: "boolean",
        description: "Whether to match whole words only",
        default: false
      },
      multiline: {
        type: "boolean",
        description: "Whether to enable multiline regex matching",
        default: false
      },
      maxDepth: {
        type: "integer",
        description: "Maximum directory recursion depth. Unlimited if not specified"
      },
      followSymlinks: {
        type: "boolean",
        description: "Whether to follow symbolic links",
        default: false
      },
      includeBinary: {
        type: "boolean",
        description: "Whether to search in binary files",
        default: false
      },
      minSize: {
        type: "integer",
        description: "Minimum file size in bytes"
      },
      maxSize: {
        type: "integer",
        description: "Maximum file size in bytes"
      },
      modifiedAfter: {
        type: "string",
        description: "Only include files modified after this date (ISO 8601 format)"
      },
      modifiedBefore: {
        type: "string",
        description: "Only include files modified before this date (ISO 8601 format)"
      },
      snippetLength: {
        type: "integer",
        description: "Length of text snippet around matches",
        default: 50
      },
      maxResults: {
        type: "integer",
        description: "Maximum number of match results to return",
        default: 100
      },
      sortBy: {
        type: "string",
        enum: ["relevance", "file", "lineNumber", "modified", "size"],
        description: "How to sort the results",
        default: "relevance"
      },
      groupByFile: {
        type: "boolean",
        description: "Whether to group results by file",
        default: true
      },
      excludeComments: {
        type: "boolean",
        description: "Whether to exclude comments from search (language-aware)",
        default: false
      },
      excludeStrings: {
        type: "boolean",
        description: "Whether to exclude string literals from search",
        default: false
      },
      outputFormat: {
        type: "string",
        enum: ["text", "json", "structured"],
        description: "Output format for results",
        default: "text"
      }
    },
    required: []
  }
};

// Tool handler
export async function handleSearch(args: any, allowedDirectories: string[]) {
  console.error("SEARCH_FILES called with args:", args);
  
  // Set up default options
  const options: SearchOptions = {
    pattern: args.pattern || ".*",
    searchPath: args.searchPath || (allowedDirectories.length > 0 ? allowedDirectories[0] : ""),
    extensions: args.extensions,
    excludeExtensions: args.excludeExtensions,
    excludePatterns: args.excludePatterns || [],
    regexMode: args.regexMode || false,
    caseSensitive: args.caseSensitive || false,
    wordBoundary: args.wordBoundary || false,
    multiline: args.multiline || false,
    maxDepth: args.maxDepth,
    followSymlinks: args.followSymlinks || false,
    includeBinary: args.includeBinary || false,
    minSize: args.minSize,
    maxSize: args.maxSize,
    modifiedAfter: args.modifiedAfter,
    modifiedBefore: args.modifiedBefore,
    snippetLength: args.snippetLength || 50,
    maxResults: args.maxResults || 100,
    sortBy: args.sortBy || 'relevance',
    groupByFile: args.groupByFile !== undefined ? args.groupByFile : true,
    excludeComments: args.excludeComments || false,
    excludeStrings: args.excludeStrings || false,
    outputFormat: args.outputFormat || 'text'
  };
  
  // Validate search path
  if (!options.searchPath) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "No search path specified and no allowed directories available"
    );
  }
  
  // Ensure searchPath is not empty string
  if (options.searchPath.trim() === "") {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Search path cannot be empty"
    );
  }
  
  // Normalize search path
  options.searchPath = path.normalize(options.searchPath);
  
  // Check if search path is allowed
  if (!isPathAllowed(options.searchPath, allowedDirectories)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Access denied: The path '${options.searchPath}' is not in the list of allowed directories: ${allowedDirectories.join(', ')}`
    );
  }
  
  // Validate that the search path exists and is a directory
  try {
    const stat = await fs.promises.stat(options.searchPath);
    if (!stat.isDirectory()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `The path '${options.searchPath}' is not a directory`
      );
    }
  } catch (error) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `The path '${options.searchPath}' does not exist or cannot be accessed`
    );
  }
  
  try {
    console.error(`Searching in: ${options.searchPath} for pattern: ${options.pattern}`);
    
    // Perform the search
    const results = await searchDirectory(options.searchPath, options, allowedDirectories);
    
    // Sort results
    const sortedResults = sortResults(results, options.sortBy || 'relevance');
    
    // Limit results
    const limitedResults = sortedResults.slice(0, options.maxResults);
    
    // Format output
    const formattedResults = formatResults(limitedResults, options);
    
    return {
      toolResult: formattedResults
    };
  } catch (error) {
    console.error("Error in search_files:", error);
    
    if (error instanceof McpError) {
      throw error;
    }
    
    throw new McpError(
      ErrorCode.InternalError,
      `Error during search: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
