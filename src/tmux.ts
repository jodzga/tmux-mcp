import { exec as execCallback, execFile as execFileCallback } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from 'uuid';

const exec = promisify(execCallback);
const execFile = promisify(execFileCallback);

// Optional cross-harness safety gate. When TMUX_MCP_SHELLFIRM_BIN points at a
// `shellfirm` binary, every execute-command is screened with `shellfirm
// pre-command --test` before it is sent to the pane. This is the ONLY way to
// gate command execution on harnesses (e.g. Codex) whose approval/hook layer
// cannot block a tool call, so the check lives inside the server itself.
const SHELLFIRM_BIN_ENV = 'TMUX_MCP_SHELLFIRM_BIN';

export interface ShellfirmResult {
  risky: boolean;
  detail?: string;
}

/**
 * Screen a raw command with shellfirm's read-only `pre-command --test`.
 *
 * - No-op (safe) when TMUX_MCP_SHELLFIRM_BIN is unset — the gate is opt-in.
 * - Fails CLOSED (risky) when the binary is configured but cannot be run, so a
 *   misconfigured gate never silently permits a dangerous command.
 *
 * shellfirm `--test` exits 0 for both safe and risky commands and prints a
 * `---` line followed by YAML: `[]` means no rule matched (safe); otherwise a
 * list of matched rules, each with a `description:` we surface to the caller.
 */
export async function shellfirmCheck(command: string): Promise<ShellfirmResult> {
  const bin = process.env[SHELLFIRM_BIN_ENV];
  if (!bin) return { risky: false };

  let stdout: string;
  try {
    const res = await execFile(bin, ['pre-command', '--test', '--command', command]);
    stdout = res.stdout;
  } catch (error: any) {
    // Binary missing / crashed / non-zero exit — do NOT let a broken gate pass.
    return {
      risky: true,
      detail: `shellfirm safety check could not run (${bin}): ${error?.message ?? error}`
    };
  }

  const lines = stdout.split('\n');
  const sepIndex = lines.findIndex(line => line.trim() === '---');
  const body = (sepIndex >= 0 ? lines.slice(sepIndex + 1) : lines).join('\n').trim();
  if (body === '' || body === '[]') return { risky: false };

  const descriptions = lines
    .filter(line => line.trim().startsWith('description:'))
    .map(line => line.replace(/^\s*description:\s*/, '').replace(/^["']|["']$/g, '').trim())
    .filter(Boolean);
  const detail = descriptions.length > 0
    ? descriptions.join('; ')
    : 'Command matched shellfirm safety rules.';
  return { risky: true, detail };
}

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

/**
 * Detect if a command contains heredoc syntax
 */
function containsHeredoc(command: string): boolean {
  // Look for heredoc patterns: << or <<-
  // Common patterns: << EOF, << 'EOF', << "EOF", <<-EOF, etc.
  return /<<-?\s*['"]?\w+['"]?/.test(command);
}

/**
 * Wrap a command to ensure proper exit code capture
 * For heredoc commands, we need special handling to ensure the end marker
 * is on its own line after the heredoc completes
 */
function wrapCommandWithMarkers(command: string): string {
  const endMarkerText = getEndMarkerText();
  
  if (containsHeredoc(command)) {
    // For heredoc commands, we need to ensure the end marker echo is on a new line
    // after the heredoc EOF delimiter. We also wrap in parentheses to capture exit code.
    // The key is having a newline after the command before the semicolon
    return `echo "${startMarkerText}"; ( ${command}\n); echo "${endMarkerText}"`;
  } else {
    // For regular commands, use simple semicolon separation
    return `echo "${startMarkerText}"; ${command}; echo "${endMarkerText}"`;
  }
}

// Execute a command in a tmux pane and wait for completion
export async function executeCommand(
  command: string,
  timeoutMs: number = 300000,
  allowRisky: boolean = false
): Promise<CommandExecution> {
  // Validate pane exists
  await validatePane();

  // Safety gate (cross-harness): screen with shellfirm and refuse risky commands
  // unless the caller explicitly overrides after human approval. capture-pane is
  // read-only and intentionally NOT gated.
  if (!allowRisky) {
    const check = await shellfirmCheck(command);
    if (check.risky) {
      const blockedId = uuidv4();
      const blocked: CommandExecution = {
        id: blockedId,
        paneId: HARDCODED_PANE_ID,
        command,
        status: 'error',
        startTime: new Date(),
        result:
          `⚠️ Blocked by shellfirm safety check — the command was NOT executed.\n` +
          `${check.detail ?? 'Command matched shellfirm safety rules.'}\n\n` +
          `If you have explicit human approval, re-invoke execute-command with allowRisky: true.`
      };
      activeCommands.set(blockedId, blocked);
      return blocked;
    }
  }

  // Generate unique ID for this command execution
  const commandId = uuidv4();

  const fullCommand = wrapCommandWithMarkers(command);

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

