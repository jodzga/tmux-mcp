import { exec as execCallback } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from 'uuid';

const exec = promisify(execCallback);

interface CommandExecution {
  id: string;
  paneId: string;
  command: string;
  status: 'pending' | 'completed' | 'error';
  startTime: Date;
  result?: string;
  exitCode?: number;
}

export type ShellType = 'bash' | 'zsh' | 'fish';

// Hardcoded pane ID for all operations
const HARDCODED_PANE_ID = 'aibot:aiexec';
const PANE_NOT_FOUND_MESSAGE = 'tmux-mcp uses session named `aibot` with an attached pane named `aiexec` to execute commands. Make sure to start tmux using `tmux new-session -s aibot -n aiexec`.';

let shellConfig: { type: ShellType } = { type: 'bash' };

export function setShellConfig(config: { type: string }): void {
  // Validate shell type
  const validShells: ShellType[] = ['bash', 'zsh', 'fish'];

  if (validShells.includes(config.type as ShellType)) {
    shellConfig = { type: config.type as ShellType };
  } else {
    shellConfig = { type: 'bash' };
  }
}

/**
 * Validate that the hardcoded pane exists
 */
async function validatePane(): Promise<void> {
  try {
    await executeTmux(`display-message -p -t '${HARDCODED_PANE_ID}' '#{pane_id}'`);
  } catch (error) {
    throw new Error(PANE_NOT_FOUND_MESSAGE);
  }
}

/**
 * Execute a tmux command and return the result
 */
export async function executeTmux(tmuxCommand: string): Promise<string> {
  try {
    const { stdout } = await exec(`tmux ${tmuxCommand}`);
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`Failed to execute tmux command: ${error.message}`);
  }
}

/**
 * Capture content from the hardcoded pane, by default the latest 200 lines.
 */
export async function capturePaneContent(lines: number = 200, includeColors: boolean = false): Promise<string> {
  // Validate pane exists
  await validatePane();
  
  const colorFlag = includeColors ? '-e' : '';
  return executeTmux(`capture-pane -p ${colorFlag} -t '${HARDCODED_PANE_ID}' -S -${lines} -E -`);
}

// Map to track ongoing command executions
const activeCommands = new Map<string, CommandExecution>();

const startMarkerText = 'TMUX_MCP_START';
const endMarkerPrefix = "TMUX_MCP_DONE_";

// Execute a command in a tmux pane and wait for completion
export async function executeCommand(command: string, timeoutMs: number = 300000): Promise<CommandExecution> {
  // Validate pane exists
  await validatePane();
  
  // Generate unique ID for this command execution
  const commandId = uuidv4();

  const endMarkerText = getEndMarkerText();
  const fullCommand = `echo "${startMarkerText}"; ${command}; echo "${endMarkerText}"`;

  // Store command in tracking map
  activeCommands.set(commandId, {
    id: commandId,
    paneId: HARDCODED_PANE_ID,
    command,
    status: 'pending',
    startTime: new Date()
  });

  // Send the command to the tmux pane
  await executeTmux(`send-keys -t '${HARDCODED_PANE_ID}' '${fullCommand.replace(/'/g, "'\\''")}' Enter`);

  // Give the command a moment to start executing before we begin polling
  // This prevents a race condition where we poll before the shell even starts
  await new Promise(resolve => setTimeout(resolve, 50));

  // Wait for command to complete
  const result = await waitForCommandCompletion(commandId, timeoutMs);
  return result;
}

// Wait for a command to complete with polling
async function waitForCommandCompletion(commandId: string, timeoutMs: number): Promise<CommandExecution> {
  const startTime = Date.now();
  const pollInterval = 200; // Poll every 200ms
  let pollCount = 0;

  while (true) {
    const command = await checkCommandStatus(commandId);
    pollCount++;
    
    if (!command) {
      throw new Error(`Command ${commandId} not found`);
    }

    // Command completed or errored
    if (command.status !== 'pending') {
      return command;
    }

    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      command.status = 'error';
      // Include diagnostic information in timeout message
      const elapsed = Date.now() - startTime;
      command.result = `Command execution timed out after ${elapsed}ms (${pollCount} polls, ${pollInterval}ms interval). The command may still be running in the tmux pane. Check the pane output manually to verify.`;
      activeCommands.set(commandId, command);
      return command;
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

export async function checkCommandStatus(commandId: string): Promise<CommandExecution | null> {
  const command = activeCommands.get(commandId);
  if (!command) return null;

  if (command.status !== 'pending') return command;

  try {
    const content = await capturePaneContent(1000);

    // Find the last occurrence of the start marker
    const startIndex = content.lastIndexOf(startMarkerText);
    
    if (startIndex === -1) {
      // Start marker not found yet - command still running
      return command;
    }

    // Find the end marker that comes AFTER this start marker
    // This ensures we match markers from the same command execution
    const endIndex = content.indexOf(endMarkerPrefix, startIndex);

    if (endIndex === -1) {
      // End marker not found yet - command still running
      return command;
    }

    // Extract exit code from the end marker line
    // Use a more flexible approach to handle potential line wrapping or whitespace issues
    const contentFromEnd = content.substring(endIndex);
    const endLine = contentFromEnd.split('\n')[0];
    const endMarkerRegex = new RegExp(`${endMarkerPrefix}(\\d+)`);
    const exitCodeMatch = endLine.match(endMarkerRegex);

    if (exitCodeMatch) {
      const exitCode = parseInt(exitCodeMatch[1], 10);

      command.status = exitCode === 0 ? 'completed' : 'error';
      command.exitCode = exitCode;

      // Extract output between the start and end markers
      const outputStart = startIndex + startMarkerText.length;
      const outputEnd = endIndex;
      const outputContent = content.substring(outputStart, outputEnd).trim();

      // The outputContent is the actual command output
      // (markers are echoed, so they don't appear in the output itself)
      command.result = outputContent;

      // Update in map
      activeCommands.set(commandId, command);
    } else {
      // Exit code pattern not found - this shouldn't happen but handle gracefully
      // The end marker was found but we couldn't extract the exit code
      // Leave command as pending and let it timeout if this persists
    }
  } catch (error) {
    // If capture fails, leave command as pending and let it be retried
    // This handles transient tmux issues without failing the command
  }

  return command;
}

function getEndMarkerText(): string {
  return shellConfig.type === 'fish'
    ? `${endMarkerPrefix}$status`
    : `${endMarkerPrefix}$?`;
}

