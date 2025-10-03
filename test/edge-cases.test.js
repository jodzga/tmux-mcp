#!/usr/bin/env node

/**
 * Unit tests for tmux-mcp edge cases
 * 
 * Prerequisites: tmux session "aibot:aiexec" must be running
 * Run: tmux new-session -d -s aibot -n aiexec
 */

import * as tmux from '../build/tmux.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Test results tracker
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} - ${name}`);
  if (!passed && details) {
    console.log(`  ${details}`);
  }
  results.tests.push({ name, passed, details });
  if (passed) results.passed++;
  else results.failed++;
}

async function ensureSession() {
  try {
    await execAsync('tmux has-session -t aibot:aiexec 2>/dev/null');
    return true;
  } catch (error) {
    console.error('❌ Prerequisites not met!');
    console.error('The tmux session "aibot:aiexec" does not exist.');
    console.error('Please create it first: tmux new-session -d -s aibot -n aiexec\n');
    return false;
  }
}

async function testCommandWithOutput() {
  console.log('\n--- Test: Command with output ---');
  try {
    const result = await tmux.executeCommand('echo "test output"', 5000);
    
    logTest('Status is completed', result.status === 'completed');
    logTest('Exit code is 0', result.exitCode === 0);
    logTest('Result contains output', result.result.includes('test output'));
    
    return result.status === 'completed' && result.exitCode === 0;
  } catch (error) {
    logTest('Command with output', false, error.message);
    return false;
  }
}

async function testFailedCommand() {
  console.log('\n--- Test: Failed command (exit code 1) ---');
  try {
    const result = await tmux.executeCommand('false', 5000);
    
    logTest('Status is error', result.status === 'error');
    logTest('Exit code is 1', result.exitCode === 1);
    logTest('Result is defined', result.result !== undefined);
    
    return result.status === 'error' && result.exitCode === 1;
  } catch (error) {
    logTest('Failed command', false, error.message);
    return false;
  }
}

async function testEmptyOutput() {
  console.log('\n--- Test: Empty output ---');
  try {
    const result = await tmux.executeCommand('true', 5000);
    
    logTest('Status is completed', result.status === 'completed');
    logTest('Exit code is 0', result.exitCode === 0);
    logTest('Result is empty string', result.result === '');
    
    return result.status === 'completed' && result.exitCode === 0;
  } catch (error) {
    logTest('Empty output', false, error.message);
    return false;
  }
}

async function testVariousExitCodes() {
  console.log('\n--- Test: Various exit codes ---');
  const testCases = [
    { code: 2, desc: 'Exit code 2' },
    { code: 127, desc: 'Exit code 127' },
    { code: 255, desc: 'Exit code 255' }
  ];
  
  let allPassed = true;
  for (const testCase of testCases) {
    try {
      const result = await tmux.executeCommand(`bash -c "exit ${testCase.code}"`, 5000);
      const passed = result.status === 'error' && result.exitCode === testCase.code;
      logTest(`${testCase.desc}`, passed, 
        passed ? '' : `Expected error/${testCase.code}, got ${result.status}/${result.exitCode}`);
      if (!passed) allPassed = false;
    } catch (error) {
      logTest(testCase.desc, false, error.message);
      allPassed = false;
    }
  }
  return allPassed;
}

async function testMultipleCommandsSequence() {
  console.log('\n--- Test: CRITICAL - Multiple commands in sequence ---');
  console.log('This tests the fix for the marker matching bug\n');
  
  try {
    // Execute multiple commands with different exit codes
    const r1 = await tmux.executeCommand('echo "success1"', 5000);
    const r2 = await tmux.executeCommand('false', 5000);
    const r3 = await tmux.executeCommand('echo "success2"', 5000);
    const r4 = await tmux.executeCommand('bash -c "exit 127"', 5000);
    const r5 = await tmux.executeCommand('true', 5000);
    
    // Verify each command has correct status and exit code
    const checks = [
      { 
        name: 'Command 1: echo success1',
        pass: r1.status === 'completed' && r1.exitCode === 0 && r1.result.includes('success1'),
        details: `status=${r1.status}, exitCode=${r1.exitCode}, result="${r1.result}"`
      },
      {
        name: 'Command 2: false',
        pass: r2.status === 'error' && r2.exitCode === 1,
        details: `status=${r2.status}, exitCode=${r2.exitCode}`
      },
      {
        name: 'Command 3: echo success2',
        pass: r3.status === 'completed' && r3.exitCode === 0 && r3.result.includes('success2'),
        details: `status=${r3.status}, exitCode=${r3.exitCode}, result="${r3.result}"`
      },
      {
        name: 'Command 4: exit 127',
        pass: r4.status === 'error' && r4.exitCode === 127,
        details: `status=${r4.status}, exitCode=${r4.exitCode}`
      },
      {
        name: 'Command 5: true',
        pass: r5.status === 'completed' && r5.exitCode === 0,
        details: `status=${r5.status}, exitCode=${r5.exitCode}`
      }
    ];
    
    let allPassed = true;
    for (const check of checks) {
      logTest(check.name, check.pass, check.pass ? '' : check.details);
      if (!check.pass) allPassed = false;
    }
    
    return allPassed;
  } catch (error) {
    logTest('Multiple commands sequence', false, error.message);
    return false;
  }
}

async function testMultiLineOutput() {
  console.log('\n--- Test: Multi-line output ---');
  try {
    const result = await tmux.executeCommand('printf "line1\\nline2\\nline3"', 5000);
    
    logTest('Status is completed', result.status === 'completed');
    logTest('Exit code is 0', result.exitCode === 0);
    logTest('Result has multiple lines', result.result.includes('\n'));
    logTest('Result contains all lines', 
      result.result.includes('line1') && 
      result.result.includes('line2') && 
      result.result.includes('line3'));
    
    return result.status === 'completed' && result.exitCode === 0;
  } catch (error) {
    logTest('Multi-line output', false, error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          tmux-mcp Edge Cases Unit Tests                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  // Check prerequisites
  const sessionReady = await ensureSession();
  if (!sessionReady) {
    process.exit(1);
  }
  
  console.log('✓ tmux session ready\n');
  console.log('Running tests...\n');
  
  // Run all test suites
  await testCommandWithOutput();
  await testFailedCommand();
  await testEmptyOutput();
  await testVariousExitCodes();
  await testMultipleCommandsSequence();
  await testMultiLineOutput();
  
  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total tests: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed} ✅`);
  console.log(`Failed: ${results.failed} ❌`);
  console.log('═'.repeat(60));
  
  if (results.failed === 0) {
    console.log('\n🎉 All tests passed!\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. See details above.\n');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

