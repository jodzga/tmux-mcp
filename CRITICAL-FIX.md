# Critical Bug Fix - Marker Matching

## The Problem

A **critical bug** was discovered where failed commands could be reported as successful when multiple commands were executed in sequence.

### Real-World Example

The user reported this issue:

**Command 1** (reported incorrectly):
```
Command: kubectl --context prod-gcp-us-west1 debug node/kubernetes-ha-master-0 -it --image=ubuntu
Terminal showed: TMUX_MCP_DONE_1 (exit code 1 - FAILURE)
MCP reported: Status: Success, Exit code: 0 (WRONG!)
```

**Command 2** (reported correctly):
```
Command: kubectl --context prod-gcp-us-west1 debug node/kubernetes-ha-master-0 -it --image=busybox -- /bin/sh
Terminal showed: TMUX_MCP_DONE_1 (exit code 1 - FAILURE)
MCP reported: Status: Error, Exit code: 1 (CORRECT!)
```

## Root Cause

The `checkCommandStatus()` function used `lastIndexOf` independently for both START and END markers:

```typescript
// WRONG: Independent searches
const startIndex = content.lastIndexOf(startMarkerText);
const endIndex = content.lastIndexOf(endMarkerPrefix);
```

When multiple commands were in the buffer:
```
Command A: TMUX_MCP_START ... output ... TMUX_MCP_DONE_0
Command B: TMUX_MCP_START ... output ... TMUX_MCP_DONE_1
Command C: TMUX_MCP_START ... output ... TMUX_MCP_DONE_0
```

The code would:
1. Find the LAST START marker (Command C)
2. Find the LAST END marker (Command C) ✓ Usually correct
3. **BUT** in some cases, it could match markers from different commands, especially if the buffer was captured at different timing

The subtle issue was that both markers were searched from the beginning of the content, which could lead to mismatched pairs in certain timing conditions.

## The Fix

Changed to search for the END marker starting AFTER the START marker:

```typescript
// CORRECT: Sequential search
const startIndex = content.lastIndexOf(startMarkerText);  // Find the most recent command
const endIndex = content.indexOf(endMarkerPrefix, startIndex);  // Find its END marker
```

This ensures we always match the START and END markers from the **same command execution**.

## Verification

### Automated Unit Tests

A comprehensive test suite has been created to verify this fix:

```bash
npm test
```

The test suite includes a specific test case `testMultipleCommandsSequence()` that executes 5 consecutive commands with different exit codes and verifies each one individually.

### Test Details

Tested with 5 consecutive commands with different exit codes:

```javascript
const r1 = await tmux.executeCommand('echo success1', 5000);      // exit 0
const r2 = await tmux.executeCommand('false', 5000);              // exit 1
const r3 = await tmux.executeCommand('echo success2', 5000);      // exit 0
const r4 = await tmux.executeCommand('bash -c "exit 127"', 5000); // exit 127
const r5 = await tmux.executeCommand('true', 5000);               // exit 0
```

**Results:** ✅ All commands correctly reported with their actual exit codes

## Impact

This was a **critical** bug that could cause:
- ❌ Failed commands to be reported as successful
- ❌ Incorrect exit codes
- ❌ Wrong command outputs
- ❌ Misleading status information to users

All of these issues are now **FIXED**.

## Files Changed

- `src/tmux.ts` - Modified `checkCommandStatus()` function
  - Changed line 144 from `lastIndexOf(endMarkerPrefix)` to `indexOf(endMarkerPrefix, startIndex)`
  - Split marker validation into separate checks for better clarity

## Date Fixed

2025-10-02

