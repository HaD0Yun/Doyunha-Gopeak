#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { lstat, mkdtemp, readlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = import.meta.dirname;
const pkg = await Bun.file(path.join(root, 'package.json')).json();
const archivePath = path.join(root, 'dist', `gopeak-${pkg.version}.tgz`);
const installRoot = await mkdtemp(path.join(os.tmpdir(), 'gopeak-offline-install-'));

try {
  // Given: an isolated Bun home whose registry and proxies cannot reach a package server.
  const env = {
    ...process.env,
    HOME: installRoot,
    BUN_INSTALL: installRoot,
    BUN_INSTALL_CACHE_DIR: path.join(installRoot, 'cache'),
    BUN_CONFIG_REGISTRY: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '',
  };

  // When: the versioned GitHub Release artifact is installed globally.
  const install = Bun.spawnSync([process.execPath, 'add', '--global', archivePath], {
    cwd: installRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Then: installation needs no registry and exposes both supported commands.
  assert.equal(install.exitCode, 0, install.stderr.toString());
  for (const [binName, targetName] of [['gopeak', 'cli.js'], ['godot-mcp', 'godot-mcp.js']]) {
    const binPath = path.join(installRoot, 'bin', binName);
    assert.equal((await lstat(binPath)).isSymbolicLink(), true, `${binName} should be linked globally`);
    assert.ok((await readlink(binPath)).endsWith(`/node_modules/gopeak/build/${targetName}`));

    const version = Bun.spawnSync([binPath, 'version'], {
      cwd: installRoot,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    assert.equal(version.exitCode, 0, version.stderr.toString());
    assert.equal(version.stdout.toString().trim(), `gopeak v${pkg.version}`);
  }
} finally {
  await rm(installRoot, { recursive: true, force: true });
}

console.log(`Offline Bun release install verified with Bun ${Bun.version}`);
