#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = new URL('.', import.meta.url).pathname;

async function runInstaller({ version, validChecksum, installed = false, installedVersion = '2.3.8', failNextInstall = false, legacyArgs = [] }) {
  const home = await mkdtemp(join(tmpdir(), 'gopeak-installer-home-'));
  const bin = join(home, 'bin');
  const log = join(home, 'bun.log');
  const curlLog = join(home, 'curl.log');
  await mkdir(bin);
  const archive = Buffer.from('verified release archive');
  const checksum = createHash('sha256').update(archive).digest('hex');

  const installedMarker = join(home, 'gopeak-installed');
  const failMarker = join(home, 'fail-next-install');
  if (installed) await writeFile(installedMarker, 'installed');
  if (failNextInstall) await writeFile(failMarker, 'fail once');
  await writeFile(join(bin, 'bun'), `#!/bin/sh
printf '%s\\n' "HOME=$HOME" "ARGS=$*" >> "$BUN_TEST_LOG"
if [ "$1 $2" = "pm ls" ] && [ -f "$BUN_INSTALLED_MARKER" ]; then
  printf '%s\\n' '└── gopeak@/tmp/previous-release.tgz'
  exit 0
fi
if [ "$1 $2 $3" = "remove -g gopeak" ]; then
  rm -f "$BUN_INSTALLED_MARKER"
  exit 0
fi
if [ "$1 $2" = "add -g" ]; then
  if [ -f "$BUN_FAIL_MARKER" ]; then
    rm -f "$BUN_FAIL_MARKER"
    printf '%s\n' 'simulated replacement failure' >&2
    exit 42
  fi
  if [ -f "$BUN_INSTALLED_MARKER" ]; then
    printf '%s\\n' 'dependency loop from previous tarball install' >&2
    exit 42
  fi
  : > "$BUN_INSTALLED_MARKER"
fi
`);
  await chmod(join(bin, 'bun'), 0o755);
  await writeFile(join(bin, 'gopeak'), `#!/bin/sh
printf '%s\n' 'gopeak v${installedVersion}'
`);
  await chmod(join(bin, 'gopeak'), 0o755);
  await writeFile(join(bin, 'curl'), `#!/bin/sh
printf '%s\n' "$*" >> "$CURL_TEST_LOG"
url=""
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */releases/latest) payload='{"tag_name":"v2.4.0"}' ;;
  *.tgz.sha256) payload='${validChecksum ? checksum : '0'.repeat(64)}  gopeak-${version ?? '2.4.0'}.tgz' ;;
  *.tgz) printf 'verified release archive' > "$output"; exit 0 ;;
  *) exit 22 ;;
esac
if [ -n "$output" ]; then printf '%s' "$payload" > "$output"; else printf '%s' "$payload"; fi
`);
  await chmod(join(bin, 'curl'), 0o755);

  const args = [join(root, 'install.sh')];
  if (version) args.push('--version', version);
  args.push(...legacyArgs);
  const result = await new Promise((resolve) => {
    const child = spawn('/bin/bash', args, {
      env: {
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        BUN_TEST_LOG: log,
        BUN_INSTALLED_MARKER: installedMarker,
        BUN_FAIL_MARKER: failMarker,
        CURL_TEST_LOG: curlLog,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  let bunLog = '';
  try { bunLog = await readFile(log, 'utf8'); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  let curlLogText = '';
  try { curlLogText = await readFile(curlLog, 'utf8'); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const installationPreserved = await readFile(installedMarker, 'utf8').then(() => true, () => false);
  await rm(home, { recursive: true, force: true });
  return { ...result, bunLog, curlLog: curlLogText, home, installationPreserved };
}

// Given no explicit version and an isolated HOME
// When the installer runs
// Then it resolves latest and installs the verified local tarball with Bun.
const fresh = await runInstaller({ validChecksum: true });
assert.equal(fresh.code, 0, fresh.stderr);
assert.match(fresh.stdout, /GoPeak 2\.4\.0/);
assert.match(fresh.bunLog, /ARGS=add -g .*gopeak-2\.4\.0\.tgz/);
assert.match(fresh.bunLog, new RegExp(`HOME=${fresh.home}`));
assert.match(fresh.curlLog, /--proto =https/);
assert.match(fresh.curlLog, /--proto-redir =https/);
assert.match(fresh.curlLog, /--max-filesize/);

// Given an explicit release version
// When the installer runs
// Then that exact release asset is installed.
const explicit = await runInstaller({ version: '2.3.9', validChecksum: true });
assert.equal(explicit.code, 0, explicit.stderr);
assert.match(explicit.bunLog, /gopeak-2\.3\.9\.tgz/);

// Given GoPeak was already installed from an earlier temporary tarball
// When the installer upgrades it from a newly downloaded tarball
// Then the stale global dependency is removed before Bun installs the replacement.
const upgraded = await runInstaller({ version: '2.3.9', validChecksum: true, installed: true });
assert.equal(upgraded.code, 0, upgraded.stderr);
assert.match(upgraded.bunLog, /ARGS=remove -g gopeak[\s\S]*ARGS=add -g/);

// Given the requested release is already installed
// When the shell installer checks the global package before downloading
// Then it performs no download, removal, or installation.
const unchanged = await runInstaller({ version: '2.3.9', validChecksum: true, installed: true, installedVersion: '2.3.9' });
assert.equal(unchanged.code, 0, unchanged.stderr);
assert.equal(unchanged.curlLog, '');
assert.doesNotMatch(unchanged.bunLog, /ARGS=(?:remove|add)/);
assert.match(unchanged.stdout, /already installed/i);

// Given a verified existing release and a replacement that Bun cannot install
// When the upgrade fails after removal
// Then the previous verified release is reinstalled before the installer exits.
const rolledBack = await runInstaller({ version: '2.4.0', validChecksum: true, installed: true, failNextInstall: true });
assert.notEqual(rolledBack.code, 0);
assert.equal(rolledBack.installationPreserved, true, rolledBack.stderr);
assert.match(rolledBack.bunLog, /ARGS=remove -g gopeak[\s\S]*ARGS=add -g .*2\.4\.0[\s\S]*ARGS=add -g .*2\.3\.8/);
assert.match(`${rolledBack.stdout}\n${rolledBack.stderr}`, /restored/i);

// Given callers still using the 2.3 installer flags
// When the Bun installer receives those legacy options
// Then it accepts them with migration warnings and prints the equivalent Bun-era config.
const legacy = await runInstaller({
  version: '2.3.9',
  validChecksum: true,
  legacyArgs: ['--dir', '/tmp/old-checkout', '--godot', '/Applications/Godot.app/Contents/MacOS/Godot', '--configure', 'claude'],
});
assert.equal(legacy.code, 0, legacy.stderr);
assert.match(legacy.stderr, /deprecated.*--dir/is);
assert.match(legacy.stderr, /deprecated.*--godot/is);
assert.match(legacy.stderr, /deprecated.*--configure/is);
assert.match(legacy.stdout, /"command": "gopeak"/);
assert.match(legacy.stdout, /"GODOT_PATH": "\/Applications\/Godot\.app\/Contents\/MacOS\/Godot"/);

// Given a release archive whose checksum is wrong
// When verification runs
// Then installation stops before Bun can replace the existing package.
const rejected = await runInstaller({ version: '2.3.9', validChecksum: false });
assert.notEqual(rejected.code, 0);
assert.doesNotMatch(rejected.bunLog, /ARGS=(?:remove|add)/);
assert.match(`${rejected.stdout}\n${rejected.stderr}`, /checksum/i);

async function reservePort() {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => rejectPort(new Error('could not reserve MCP bridge port')));
        return;
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

async function runProcess(command, args, env) {
  return await new Promise((resolveProcess) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveProcess({ code, stdout, stderr }));
  });
}

async function initializeInstalledBin(command, env) {
  const child = spawn(command, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const response = new Promise((resolveResponse, rejectResponse) => {
    const timeout = setTimeout(() => rejectResponse(new Error(`MCP initialize timed out: ${stderr}`)), 10_000);
    child.stdout.on('data', () => {
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === 1 && message.result?.serverInfo?.name === 'gopeak') {
            clearTimeout(timeout);
            resolveResponse(message);
            return;
          }
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      rejectResponse(new Error(`MCP bin exited before initialize response (code ${code}): ${stderr}`));
    });
  });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'distribution-test', version: '1.0.0' },
    },
  })}\n`);
  let exitTimeout;
  try {
    await response;
    child.stdin.end();
    await Promise.race([
      closed,
      new Promise((_, rejectExit) => {
        exitTimeout = setTimeout(() => rejectExit(new Error(`MCP bin did not exit after stdin closed: ${stderr}`)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(exitTimeout);
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await closed;
    }
  }
  const initializeResponses = stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((message) => message.id === 1);
  assert.equal(initializeResponses.length, 1, `${command} must emit exactly one initialize response`);
  assert.equal((stderr.match(/Godot MCP server running on stdio/g) ?? []).length, 1, `${command} must start exactly one MCP server`);
}

// Given the release tarball and a clean Bun global prefix
// When an end user installs it with the real Bun executable
// Then both installed bins report the release version and complete an MCP initialize handshake.
const realHome = await mkdtemp(join(tmpdir(), 'gopeak-real-global-'));
try {
  const bunInstall = join(realHome, '.bun');
  const realEnv = {
    ...process.env,
    HOME: realHome,
    BUN_INSTALL: bunInstall,
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    GODOT_PATH: process.execPath,
    GOPEAK_BRIDGE_HOST: '127.0.0.1',
  };
  const archivePath = resolve(root, 'dist', 'gopeak-2.3.9.tgz');
  const installation = await runProcess(process.execPath, ['add', '-g', archivePath], realEnv);
  assert.equal(installation.code, 0, installation.stderr);
  for (const binaryName of ['gopeak', 'godot-mcp']) {
    const binary = join(bunInstall, 'bin', binaryName);
    const versionResult = await runProcess(binary, ['version'], realEnv);
    assert.equal(versionResult.code, 0, versionResult.stderr);
    assert.match(versionResult.stdout, /gopeak v2\.3\.9/);
    await initializeInstalledBin(binary, {
      ...realEnv,
      GOPEAK_BRIDGE_PORT: String(await reservePort()),
    });
  }
} finally {
  await rm(realHome, { recursive: true, force: true });
}

console.log('Bun installer tests passed');
