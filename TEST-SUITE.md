# Test Suite Documentation

## Overview

A comprehensive automated test suite has been created to verify all edge cases and bug fixes in tmux-mcp.

## Running the Tests

```bash
# 1. Build the project
npm run build

# 2. Create the required tmux session
tmux new-session -d -s aibot -n aiexec

# 3. Run the tests
npm test
```

## Test Coverage

### 1. Command with Output
**Purpose:** Verify successful command execution with normal output

**Test:**
```javascript
executeCommand('echo "test output"', 5000)
```

**Assertions:**
- ✅ Status is "completed"
- ✅ Exit code is 0
- ✅ Result contains the output text

### 2. Failed Command (Exit Code 1)
**Purpose:** Verify failed commands are reported correctly

**Test:**
```javascript
executeCommand('false', 5000)
```

**Assertions:**
- ✅ Status is "error"
- ✅ Exit code is 1
- ✅ Result is defined

### 3. Empty Output
**Purpose:** Verify commands with no output work correctly

**Test:**
```javascript
executeCommand('true', 5000)
```

**Assertions:**
- ✅ Status is "completed"
- ✅ Exit code is 0
- ✅ Result is empty string

### 4. Various Exit Codes
**Purpose:** Verify different exit codes are captured correctly

**Tests:**
- Exit code 2: `bash -c "exit 2"`
- Exit code 127: `bash -c "exit 127"` (command not found)
- Exit code 255: `bash -c "exit 255"`

**Assertions (for each):**
- ✅ Status is "error"
- ✅ Exit code matches expected value

### 5. Multiple Commands in Sequence (CRITICAL)
**Purpose:** Verify the marker matching bug fix - ensures markers from different commands don't get mixed up

This is the **most important test** as it verifies the critical bug fix.

**Tests:**
```javascript
executeCommand('echo "success1"', 5000);  // completed, exit 0
executeCommand('false', 5000);            // error, exit 1
executeCommand('echo "success2"', 5000);  // completed, exit 0
executeCommand('bash -c "exit 127"', 5000); // error, exit 127
executeCommand('true', 5000);             // completed, exit 0
```

**Assertions:**
- ✅ Command 1: status=completed, exitCode=0, result contains "success1"
- ✅ Command 2: status=error, exitCode=1
- ✅ Command 3: status=completed, exitCode=0, result contains "success2"
- ✅ Command 4: status=error, exitCode=127
- ✅ Command 5: status=completed, exitCode=0

**Why this is critical:** Before the fix, when multiple commands were in the buffer, markers could be mismatched, causing a failed command to be reported as successful (e.g., exit code 1 reported as exit code 0).

### 6. Multi-line Output
**Purpose:** Verify multi-line output is preserved correctly

**Test:**
```javascript
executeCommand('printf "line1\\nline2\\nline3"', 5000)
```

**Assertions:**
- ✅ Status is "completed"
- ✅ Exit code is 0
- ✅ Result contains newlines
- ✅ Result contains all three lines

## Total Test Coverage

- **Test Suites:** 6
- **Individual Assertions:** 21
- **All tests passing:** ✅

## Test Implementation

The tests are implemented in `test/edge-cases.test.js` using:
- Native Node.js modules (no test framework dependencies)
- Direct imports from the built tmux module
- Clear, descriptive test names
- Detailed pass/fail reporting

## Continuous Testing

To ensure the bug fixes remain working:

1. Run tests before commits: `npm test`
2. Run tests after any changes to `src/tmux.ts`
3. Run tests before releases

## Known Requirements

- **tmux session:** Tests require a tmux session named `aibot:aiexec`
- **Built code:** Tests run against `build/tmux.js`, so `npm run build` must be run first
- **Clean environment:** Each test run should start with a fresh tmux session

## Example Output

```
╔════════════════════════════════════════════════════════════╗
║          tmux-mcp Edge Cases Unit Tests                   ║
╚════════════════════════════════════════════════════════════╝

✓ tmux session ready

Running tests...

--- Test: Command with output ---
✅ PASS - Status is completed
✅ PASS - Exit code is 0
✅ PASS - Result contains output

--- Test: CRITICAL - Multiple commands in sequence ---
This tests the fix for the marker matching bug

✅ PASS - Command 1: echo success1
✅ PASS - Command 2: false
✅ PASS - Command 3: echo success2
✅ PASS - Command 4: exit 127
✅ PASS - Command 5: true

════════════════════════════════════════════════════════════
SUMMARY
════════════════════════════════════════════════════════════
Total tests: 21
Passed: 21 ✅
Failed: 0 ❌
════════════════════════════════════════════════════════════

🎉 All tests passed!
```

## Related Documentation

- `TESTING.md` - Manual testing instructions
- `CRITICAL-FIX.md` - Details on the critical marker matching bug
- `BUGFIX-SUMMARY.md` - Summary of all bug fixes

