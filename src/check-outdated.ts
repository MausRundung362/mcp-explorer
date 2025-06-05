import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface OutdatedPackage {
  package: string;
  current: string;
  wanted: string;
  latest: string;
  location: string;
  type: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';
}

export interface OutdatedResult {
  success: boolean;
  hasOutdated: boolean;
  outdatedPackages: OutdatedPackage[];
  totalOutdated: number;
  packageJsonPath: string;
  message: string;
  rawOutput?: string;
}

export const checkOutdatedTool = {
  name: "check_outdated",
  description: "Check for outdated npm packages in package.json using 'npm outdated'. Analyzes the current project's dependencies and shows which packages have newer versions available. Requires npm to be installed and accessible from the command line.",
  inputSchema: {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description: "Path to the directory containing package.json. Defaults to the first allowed directory if not specified."
      },
      includeDevDependencies: {
        type: "boolean",
        description: "Whether to include dev dependencies in the check",
        default: true
      },
      outputFormat: {
        type: "string",
        enum: ["detailed", "summary", "raw"],
        description: "Format of the output: detailed (full info), summary (counts only), or raw (npm command output)",
        default: "detailed"
      }
    },
    additionalProperties: false
  }
};

export async function handleCheckOutdated(args: any, allowedDirectories: string[]) {
  const { 
    projectPath = allowedDirectories[0], 
    includeDevDependencies = true,
    outputFormat = "detailed"
  } = args;

  if (!projectPath) {
    throw new McpError(ErrorCode.InvalidParams, "No project path specified and no allowed directories available");
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(projectPath);

  // Check if path is within allowed directories
  const isPathAllowed = allowedDirectories.some(dir => {
    const normalizedDir = path.resolve(dir);
    return resolvedPath.startsWith(normalizedDir);
  });

  if (!isPathAllowed) {
    throw new McpError(ErrorCode.InvalidParams, `Path "${resolvedPath}" is not within allowed directories`);
  }

  // Check if package.json exists
  const packageJsonPath = path.join(resolvedPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new McpError(ErrorCode.InvalidParams, `package.json not found in "${resolvedPath}"`);
  }

  try {
    // Build npm outdated command
    let command = 'npm outdated --json';
    if (!includeDevDependencies) {
      command += ' --prod';
    }

    // Execute npm outdated command
    const { stdout, stderr } = await execAsync(command, { 
      cwd: resolvedPath,
      timeout: 30000 // 30 second timeout
    });

    let outdatedData: any = {};
    let rawOutput = stdout || stderr;

    // npm outdated returns exit code 1 when packages are outdated, so we need to handle both stdout and stderr
    if (stdout && stdout.trim()) {
      try {
        outdatedData = JSON.parse(stdout);
      } catch (parseError) {
        // If JSON parsing fails, treat as no outdated packages
        outdatedData = {};
      }
    } else if (stderr && stderr.includes('{')) {
      try {
        // Sometimes npm outputs to stderr
        outdatedData = JSON.parse(stderr);
      } catch (parseError) {
        outdatedData = {};
      }
    }

    // Parse the outdated packages
    const outdatedPackages: OutdatedPackage[] = [];
    
    for (const [packageName, info] of Object.entries(outdatedData)) {
      if (typeof info === 'object' && info !== null) {
        const packageInfo = info as any;
        outdatedPackages.push({
          package: packageName,
          current: packageInfo.current || 'unknown',
          wanted: packageInfo.wanted || 'unknown', 
          latest: packageInfo.latest || 'unknown',
          location: packageInfo.location || resolvedPath,
          type: packageInfo.type || 'dependencies'
        });
      }
    }

    const totalOutdated = outdatedPackages.length;
    const hasOutdated = totalOutdated > 0;

    let message: string;
    if (!hasOutdated) {
      message = "All packages are up to date! 🎉";
    } else {
      message = `Found ${totalOutdated} outdated package${totalOutdated === 1 ? '' : 's'}`;
      
      if (outputFormat === "detailed") {
        message += ":\n\n";
        outdatedPackages.forEach(pkg => {
          message += `📦 ${pkg.package}\n`;
          message += `   Current: ${pkg.current}\n`;
          message += `   Wanted:  ${pkg.wanted}\n`;
          message += `   Latest:  ${pkg.latest}\n`;
          message += `   Type:    ${pkg.type}\n\n`;
        });
        message += "Run 'npm update' to update to wanted versions or 'npm install <package>@latest' for latest versions.";
      } else if (outputFormat === "summary") {
        const depTypes = outdatedPackages.reduce((acc, pkg) => {
          acc[pkg.type] = (acc[pkg.type] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        message += "\n\nBreakdown by type:\n";
        Object.entries(depTypes).forEach(([type, count]) => {
          message += `- ${type}: ${count}\n`;
        });
      }
    }

    return {
      toolResult: {
        success: true,
        hasOutdated,
        outdatedPackages,
        totalOutdated,
        packageJsonPath,
        message,
        rawOutput: outputFormat === "raw" ? rawOutput : undefined
      }
    };

  } catch (error: any) {
    // npm outdated exits with code 1 when packages are outdated, this is normal
    if (error.code === 1 && error.stdout) {
      // This is the normal case - packages are outdated
      return handleCheckOutdated(args, allowedDirectories);
    }

    let errorMessage = `Failed to check outdated packages: ${error.message}`;
    
    if (error.code === 'ENOENT') {
      errorMessage = "npm command not found. Please ensure npm is installed and available in your PATH.";
    } else if (error.message.includes('timeout')) {
      errorMessage = "npm outdated command timed out. The operation took too long to complete.";
    } else if (error.message.includes('ENOTDIR') || error.message.includes('ENOENT')) {
      errorMessage = `Invalid project directory: "${resolvedPath}"`;
    }

    throw new McpError(ErrorCode.InternalError, errorMessage);
  }
}
