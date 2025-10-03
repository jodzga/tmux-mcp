#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as tmux from "./tmux.js";

// Create MCP server
const server = new McpServer({
  name: "tmux-mcp",
  version: "0.3.0"
}, {
  capabilities: {
    tools: {},
    logging: {}
  }
});

// Capture pane content - Tool
server.tool(
  "capture-pane",
  "Capture content from the aibot:aiexec tmux pane with configurable lines count and optional color preservation",
  {
    lines: z.string().optional().describe("Number of lines to capture (default: 200)"),
    colors: z.boolean().optional().describe("Include color/escape sequences for text and background attributes in output")
  },
  async ({ lines, colors }) => {
    try {
      // Parse lines parameter if provided
      const linesCount = lines ? parseInt(lines, 10) : undefined;
      const includeColors = colors || false;
      const content = await tmux.capturePaneContent(linesCount, includeColors);
      return {
        content: [{
          type: "text",
          text: content || "No content captured"
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error capturing pane content: ${error}`
        }],
        isError: true
      };
    }
  }
);

// Execute command in pane - Tool
server.tool(
  "execute-command",
  "Execute a command in the aibot:aiexec tmux pane and wait for it to complete. Returns the command output and exit status. Avoid heredoc syntax (cat << EOF) and other multi-line constructs as they conflict with command wrapping. For file writing, prefer: printf 'content\\n' > file, echo statements, or write to temp files instead. Note: If commands timeout, increase the timeout value - slow shell initialization (especially with kubectl/aws/gcloud completions) can take 10-30 seconds for the first command",
  {
    command: z.string().describe("Command to execute"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 300000). Increase for slow commands or shells with heavy initialization")
  },
  async ({ command, timeout }) => {
    try {
      const result = await tmux.executeCommand(command, timeout);

      const statusText = result.status === 'completed' ? 'Success' : 'Error';
      const exitCodeText = result.exitCode !== undefined ? `\nExit code: ${result.exitCode}` : '';
      const output = result.result || 'No output';

      return {
        content: [{
          type: "text",
          text: `Status: ${statusText}${exitCodeText}\nCommand: ${result.command}\n\n--- Output ---\n${output}`
        }],
        isError: result.status === 'error'
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error executing command: ${error}`
        }],
        isError: true
      };
    }
  }
);

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        'shell-type': { type: 'string', default: 'bash', short: 's' }
      }
    });

    // Set shell configuration
    tmux.setShellConfig({
      type: values['shell-type'] as string
    });

    // Start the MCP server
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Failed to start MCP server:", error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
