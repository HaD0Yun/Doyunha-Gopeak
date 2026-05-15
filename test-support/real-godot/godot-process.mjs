import { spawn } from 'node:child_process';
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ERROR_PATTERNS = [
  /^ERROR:/,
  /^SCRIPT ERROR:/,
  /assertion failed/i,
  /^USER ERROR:/,
];

export function spawnGodot(projectPath, args = [], envOverrides = {}) {
  const godotBin = envOverrides.GOPEAK_GODOT_BIN || findGodotBin();
  const logDir = join(projectPath, '.gopeak');
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, 'godot.log');

  const defaultArgs = ['--headless', '--editor', '--path', projectPath];
  const fullArgs = [...defaultArgs, ...args];

  const childEnv = { ...process.env, ...envOverrides };

  const child = spawn(godotBin, fullArgs, {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const errorLines = [];
  let stderrText = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrText += chunk;
    appendFileSync(logFile, chunk);
    process.stdout.write(`[godot] ${chunk}`);
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && ERROR_PATTERNS.some((p) => p.test(trimmed))) {
        errorLines.push(trimmed);
      }
    }
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[godot] ${chunk}`);
  });

  return {
    child,
    logFile,
    stderr: () => stderrText,
    // Returns lines that matched ERROR: / SCRIPT ERROR: / assertion failed patterns.
    // Tests should call this after each phase and assert it's empty.
    errorLines: () => [...errorLines],
    clearErrors: () => { errorLines.length = 0; },
  };
}

function findGodotBin() {
  const PATH = process.env.PATH || process.env.Path || '';
  const separators = process.platform === 'win32' ? ';' : ':';
  const paths = PATH.split(separators);

  const candidates = process.platform === 'win32'
    ? ['godot.exe', 'godot4.exe']
    : ['godot', 'godot4'];

  for (const dir of paths) {
    for (const bin of candidates) {
      const fullPath = join(dir, bin);
      try {
        if (existsSync(fullPath)) {
          return fullPath;
        }
      } catch {
        // continue
      }
    }
  }

  return 'godot';
}

export async function awaitGodotAlive(child, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Godot process exited early with code ${child.exitCode}`);
    }
    await sleep(250);
  }
}

export function killGodot(child, signal = 'SIGTERM') {
  if (child.exitCode === null) {
    child.kill(signal);
  }
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
