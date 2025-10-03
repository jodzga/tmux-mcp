# Testing Guide for tmux-mcp Edge Cases

This document describes the tests and fixes for edge cases in tmux-mcp.

## Issues Fixed

### 1. Commands with Non-Zero Exit Codes
**Problem:** When a command failed (returned exit code other than 0), the server didn't correctly handle the response.

**Fix:** Modified `checkCommandStatus()` in `src/tmux.ts` to:
- Correctly set `status` to 'error' when exitCode !== 0
- Properly extract and return the exit code
- Handle the case when markers are not found yet (command still running)

### 2. Commands with Empty Output
**Problem:** When a command succeeded but produced no output, the result extraction logic failed.

**Fix:** Simplified the output extraction logic in `checkCommandStatus()`:
- Removed incorrect logic that was skipping lines
- Now correctly extracts content between START and END markers
- Handles both empty output and single/multi-line output correctly

## Running Tests

### Automated Unit Tests

The project includes comprehensive automated unit tests:

```bash
# Build the project
npm run build

# Create the required tmux session
tmux new-session -d -s aibot -n aiexec

# Run the automated tests
npm test
```

The test suite includes:
- ✅ Command with output
- ✅ Failed command (exit code 1)
- ✅ Empty output
- ✅ Various exit codes (2, 127, 255)
- ✅ **CRITICAL:** Multiple commands in sequence (tests the marker matching fix)
- ✅ Multi-line output

**Total: 21 individual test assertions**

### Prerequisites
```bash
# Create the required tmux session
tmux new-session -d -s aibot -n aiexec
```

### Manual Tests

Run these commands to verify all edge cases work correctly:

```bash
# Build the project
npm run build

# Test 1: Successful command with output
node -e "import('./build/tmux.js').then(t=>t.executeCommand('echo test',5000).then(r=>console.log('Test 1:',JSON.stringify(r,null,2))))"

# Expected: status="completed", exitCode=0, result="test"

# Test 2: Failed command (exit code 1)
node -e "import('./build/tmux.js').then(t=>t.executeCommand('false',5000).then(r=>console.log('Test 2:',JSON.stringify(r,null,2))))"

# Expected: status="error", exitCode=1, result=""

# Test 3: Successful command with empty output
node -e "import('./build/tmux.js').then(t=>t.executeCommand('true',5000).then(r=>console.log('Test 3:',JSON.stringify(r,null,2))))"

# Expected: status="completed", exitCode=0, result=""

# Test 4: Command with specific exit code
node -e "import('./build/tmux.js').then(t=>t.executeCommand('bash -c \"exit 127\"',5000).then(r=>console.log('Test 4:',JSON.stringify(r,null,2))))"

# Expected: status="error", exitCode=127, result=""

# Test 5: Multi-line output
node -e "import('./build/tmux.js').then(t=>t.executeCommand('printf \"line1\\\\nline2\\\\nline3\"',5000).then(r=>console.log('Test 5:',JSON.stringify(r,null,2))))"

# Expected: status="completed", exitCode=0, result="line1\nline2\nline3"
```

### Critical Bug Test: Multiple Commands

This test verifies the fix for the critical bug where multiple commands in the buffer could have their markers mixed up:

```bash
# Run multiple commands in sequence
node -e "
import('./build/tmux.js').then(async (tmux) => {
  const r1 = await tmux.executeCommand('echo success1', 5000);
  const r2 = await tmux.executeCommand('false', 5000);
  const r3 = await tmux.executeCommand('echo success2', 5000);
  const r4 = await tmux.executeCommand('bash -c \"exit 127\"', 5000);
  const r5 = await tmux.executeCommand('true', 5000);
  
  console.log('Test 1:', r1.status, r1.exitCode);
  console.log('Test 2:', r2.status, r2.exitCode);
  console.log('Test 3:', r3.status, r3.exitCode);
  console.log('Test 4:', r4.status, r4.exitCode);
  console.log('Test 5:', r5.status, r5.exitCode);
}).catch(console.error);
"

# Expected output:
# Test 1: completed 0
# Test 2: error 1
# Test 3: completed 0
# Test 4: error 127
# Test 5: completed 0
```

**Why this test is important:** Before the fix, when multiple commands were in the buffer, the code could match the START marker from one command with the END marker from a different command, causing incorrect exit codes to be reported.

## Test Results

All tests verified on 2025-10-02:

✅ Test 1 - Successful command with output: PASSED
- Command: `echo test`
- Status: completed ✓
- Exit code: 0 ✓
- Result: "test" ✓

✅ Test 2 - Failed command: PASSED
- Command: `false`
- Status: error ✓
- Exit code: 1 ✓
- Result: "" (empty) ✓

✅ Test 3 - Successful command with empty output: PASSED
- Command: `true`
- Status: completed ✓
- Exit code: 0 ✓
- Result: "" (empty) ✓

✅ Test 4 - Various exit codes: PASSED
- Command: `bash -c "exit 127"`
- Status: error ✓
- Exit code: 127 ✓
- Result: "" (empty) ✓

✅ Test 5 - Multi-line output: PASSED
- Command: `printf "line1\nline2\nline3"`
- Status: completed ✓
- Exit code: 0 ✓
- Result: "line1\nline2\nline3" ✓

## Code Changes

### src/tmux.ts - checkCommandStatus()

**Before:**
```typescript
if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  command.result = "Command output could not be captured properly";
  return command;
}
// ... complex logic to skip lines ...
```

**After:**
```typescript
if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  // Markers not found yet - command still running
  return command;
}
// ... simplified extraction ...
command.result = outputContent; // Direct assignment
```

## Notes

- The `exit` command cannot be tested directly as it exits the shell, causing the tmux session to terminate
- Use `false` or `bash -c "exit N"` to test non-zero exit codes
- Empty output is correctly handled and returns an empty string in the `result` field
- Multi-line output is preserved with newline characters


