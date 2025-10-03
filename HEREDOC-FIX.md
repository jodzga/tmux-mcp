# Heredoc Exit Code Fix

## Problem Description

When executing commands that contain heredoc syntax (e.g., `python3 << 'EOF' ... EOF`), the tmux-mcp server was not correctly capturing exit codes. This occurred because:

1. The command wrapping logic added markers like: `echo "START"; python3 << 'EOF' ... EOF; echo "DONE_$?"`
2. When sent to tmux, the shell would:
   - Start the heredoc after `python3 << 'EOF'`
   - Treat all subsequent input as heredoc content, including `EOF; echo "DONE_$?"`
   - Never find the proper EOF delimiter on its own line
   - Hang in heredoc input mode or execute the echo separately

This resulted in:
- Commands timing out
- Exit codes being captured from the wrong command (the `echo` instead of the actual command)
- The shell hanging in heredoc input mode

## Root Cause

The original command wrapping:
```typescript
const fullCommand = `echo "${startMarkerText}"; ${command}; echo "${endMarkerText}"`;
```

Would create:
```bash
echo "TMUX_MCP_START"; python3 << 'EOF'
line1
line2
EOF; echo "TMUX_MCP_DONE_$?"
```

The problem: `EOF; echo ...` is on the same line, so the shell never finds EOF as a standalone delimiter.

## Solution

### 1. Heredoc Detection
Added a function to detect heredoc syntax in commands:
```typescript
function containsHeredoc(command: string): boolean {
  return /<<-?\s*['"]?\w+['"]?/.test(command);
}
```

This detects patterns like:
- `<< EOF`
- `<< 'EOF'`
- `<< "EOF"`
- `<<-EOF` (with strip-tabs variant)

### 2. Special Wrapping for Heredocs
When a heredoc is detected, the command is wrapped differently:
```typescript
if (containsHeredoc(command)) {
  return `echo "${startMarkerText}"; ( ${command}\n); echo "${endMarkerText}"`;
} else {
  return `echo "${startMarkerText}"; ${command}; echo "${endMarkerText}"`;
}
```

This creates:
```bash
echo "TMUX_MCP_START"; ( python3 << 'EOF'
line1
line2
EOF
); echo "TMUX_MCP_DONE_$?"
```

**Key insights:**
- Wrap the heredoc in a subshell `( ... )`
- Add a literal newline `\n` after the command
- This ensures the closing `) ; echo` appears on a separate line after EOF
- The subshell captures the exit code of the heredoc command

## Test Results

All tests pass, including new heredoc-specific tests:
- ✅ Successful heredoc command (exit code 0)
- ✅ Failed heredoc command (exit code 42)
- ✅ Complex Python heredoc with CSV processing
- ✅ All existing tests continue to pass (no regressions)

## Example Execution

Before fix (hung in heredoc mode):
```bash
% echo "TMUX_MCP_START"; python3 << 'EOF'
heredoc> import sys
heredoc> sys.exit(42)
heredoc> EOF; echo "TMUX_MCP_DONE_$?"
heredoc> [hangs waiting for EOF]
```

After fix (works correctly):
```bash
% echo "TMUX_MCP_START"; ( python3 << 'EOF'
subsh heredoc> import sys
subsh heredoc> sys.exit(42)
subsh heredoc> EOF
subsh> ); echo "TMUX_MCP_DONE_$?"
TMUX_MCP_START
TMUX_MCP_DONE_42
```

## Files Modified

- `src/tmux.ts`: Added heredoc detection and special wrapping logic
- `test/edge-cases.test.js`: Added 3 new test cases for heredoc commands

## Related Issues

This fix addresses the corner case described in the user report where complex Python scripts using heredocs were causing incorrect exit code reporting.

