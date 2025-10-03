# Timeout Troubleshooting Guide

## Overview

Sometimes commands may timeout even though they complete successfully in the tmux pane. This guide helps diagnose and fix timeout issues.

## Symptoms

**MCP reports:**
```
Status: Error
Command execution timed out after 10000ms
```

**But tmux pane shows:**
```
TMUX_MCP_START
[command output]
TMUX_MCP_DONE_0    # Command completed successfully!
```

## Common Causes

### 1. Shell Initialization Delay

**Problem:** The shell takes time to load configuration, plugins, and completion scripts.

**Common culprits:**
- **Oh-My-Zsh** with many plugins
- **kubectl completion** (`source <(kubectl completion bash)`)
- **Other completions** (aws, gcloud, etc.)
- Heavy `.bashrc` or `.zshrc` files

**Solution:**
```bash
# Option 1: Increase timeout (recommended)
tmux.executeCommand('kubectl config get-contexts', 30000)  # 30 seconds

# Option 2: Use a minimal shell profile for the tmux session
# Create a minimal .zshrc_minimal without heavy plugins
tmux new-session -d -s aibot -n aiexec 'ZDOTDIR=~/.config/zsh-minimal zsh'
```

### 2. Short Timeout Values

**Problem:** Default timeout (10 seconds) may be too short for some commands.

**Recommended timeouts:**
- Simple commands (echo, ls): 5,000ms (5 seconds)
- Local file operations: 10,000ms (10 seconds)
- kubectl local commands: 30,000ms (30 seconds)
- kubectl cluster commands: 60,000ms (60 seconds)
- Long-running commands: 300,000ms (5 minutes)

**Example:**
```javascript
// MCP configuration
{
  "command": "kubectl get pods",
  "timeout": 30000  // 30 seconds
}
```

### 3. Slow Tmux Operations

**Problem:** In some cases, `tmux capture-pane` itself may be slow.

**Diagnostic:**
```bash
# Test how long capture takes
time tmux capture-pane -p -t aibot:aiexec -S -1000
```

**Solution:**
- Reduce the number of lines captured (we capture 1000 lines by default)
- This is a rare issue but can happen on systems with slow I/O

### 4. First Command Delay

**Problem:** The first command in a new session is always slower.

**Why:** Shell initialization, history loading, completion setup all happen on first use.

**Solution:**
```bash
# After creating session, run a dummy command to "warm up" the shell
tmux new-session -d -s aibot -n aiexec
tmux send-keys -t aibot:aiexec 'echo warmup' Enter
sleep 1
# Now your first real command will be faster
```

## Diagnostic Steps

### Step 1: Check if command completed

```bash
# View the tmux pane manually
tmux capture-pane -p -t aibot:aiexec -S -50 | tail -20

# Look for:
# - TMUX_MCP_START
# - Your command output
# - TMUX_MCP_DONE_N (where N is the exit code)
```

If you see both markers, the command completed but MCP didn't detect it in time.

### Step 2: Measure command execution time

```bash
# Run the command directly in tmux with timing
tmux send-keys -t aibot:aiexec 'time kubectl config get-contexts' Enter

# Check how long it actually took
```

### Step 3: Check shell configuration

```bash
# Test shell startup time
time zsh -i -c exit

# If this takes > 1 second, your shell config is slow
```

### Step 4: Test with increased timeout

Try the same command with a much longer timeout (e.g., 60 seconds). If it works, the issue is the timeout value.

## Fixes

### Fix 1: Increase Timeout

Update your MCP server call to use longer timeouts:

```typescript
// In your MCP tool configuration
{
  "timeout": 60000  // 60 seconds instead of 10
}
```

### Fix 2: Optimize Shell Configuration

For the tmux session used by MCP, create a minimal shell profile:

```bash
# ~/.zshrc_mcp
# Minimal zsh configuration for MCP

# Only essential environment variables
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Skip expensive completions
# compinit is often the slowest part
```

Then create the session with:
```bash
ZDOTDIR=~/.config/zsh-mcp tmux new-session -d -s aibot -n aiexec
```

### Fix 3: Disable kubectl Completion

For the MCP session, don't load kubectl completion:

```bash
# Comment out in your shell profile:
# source <(kubectl completion zsh)  # SLOW!

# Or use conditional loading:
if [[ "$TMUX_PANE" != *"aiexec"* ]]; then
  source <(kubectl completion zsh)
fi
```

### Fix 4: Use Persistent Session

Keep the tmux session running rather than creating new ones:

```bash
# Create once
tmux new-session -d -s aibot -n aiexec

# Reuse the same session for all commands
# Don't kill and recreate it
```

## Recent Improvements

**Version 0.2.3+** includes:
- ✅ Better timeout error messages with poll count
- ✅ 50ms delay before starting to poll (prevents race conditions)
- ✅ Try-catch around pane capture (handles transient errors)
- ✅ More helpful diagnostic info in timeout messages

## Still Having Issues?

If you're still experiencing timeouts after trying these fixes:

1. **Check tmux version:**
   ```bash
   tmux -V  # Should be 2.0 or higher
   ```

2. **Verify session exists:**
   ```bash
   tmux has-session -t aibot:aiexec && echo "Session exists" || echo "Session missing"
   ```

3. **Test basic commands:**
   ```bash
   # Try a simple command first
   tmux send-keys -t aibot:aiexec 'echo test' Enter
   sleep 1
   tmux capture-pane -p -t aibot:aiexec | tail -5
   ```

4. **Check system resources:**
   - High CPU/memory usage can slow everything down
   - Disk I/O issues can affect tmux

## Example: kubectl Timeout Fix

**Before (timing out):**
```javascript
executeCommand('kubectl config get-contexts', 10000)
```

**After (working):**
```javascript
// Increase timeout for kubectl commands
executeCommand('kubectl config get-contexts', 30000)

// Or optimize shell for the session
// Create session with minimal profile
```

## Summary

Most timeout issues are caused by:
1. 🐌 **Slow shell initialization** (80% of cases)
2. ⏱️ **Timeout too short** (15% of cases)  
3. 🐛 **Actual bugs** (5% of cases)

**Quick fix:** Try increasing the timeout to 30-60 seconds first!

