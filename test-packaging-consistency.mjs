#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = import.meta.dirname;
const pkg = await Bun.file(path.join(root, 'package.json')).json();
const archiveName = `gopeak-${pkg.version}.tgz`;
const archivePath = path.join(root, 'dist', archiveName);
const checksumPath = `${archivePath}.sha256`;

assert.equal(await Bun.file(archivePath).exists(), true, `${archiveName} should exist; run bun run release:pack first`);
assert.equal(await Bun.file(checksumPath).exists(), true, `${archiveName}.sha256 should exist`);
assert.deepEqual(
  (await readdir(path.join(root, 'dist'))).sort(),
  [archiveName, `${archiveName}.sha256`],
  'release packing should remove stale version artifacts',
);

const archiveBytes = new Uint8Array(await Bun.file(archivePath).arrayBuffer());
const actualChecksum = createHash('sha256').update(archiveBytes).digest('hex');
const checksumFile = (await readFile(checksumPath, 'utf8')).trim();
assert.equal(checksumFile, `${actualChecksum}  ${archiveName}`, 'SHA-256 sidecar should match the release archive');

const tarList = Bun.spawnSync(['tar', '-tzf', archivePath], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
assert.equal(tarList.exitCode, 0, tarList.stderr.toString());
const archiveEntries = tarList.stdout.toString().trim().split('\n');
const packedFiles = new Set(archiveEntries);
assert.equal(
  packedFiles.size,
  archiveEntries.length,
  'release archive should not contain duplicate paths',
);
assert.equal(
  archiveEntries.some((entry) => entry.startsWith('package/node_modules/')),
  false,
  'release archive should contain bundles instead of a node_modules tree',
);

for (const requiredFile of [
  'package/package.json',
  'package/build/cli.js',
  'package/build/godot-mcp.js',
  'package/build/index.js',
  'package/build/visualizer.html',
  'package/build/scripts/godot_operations.gd',
  'package/build/addon/auto_reload/plugin.cfg',
  'package/build/addon/godot_mcp_editor/plugin.cfg',
  'package/build/addon/godot_mcp_runtime/plugin.cfg',
  'package/README.md',
  'package/LICENSE',
]) {
  assert.ok(packedFiles.has(requiredFile), `release archive should include ${requiredFile}`);
}

for (const forbiddenFile of [
  'package/src/cli.ts',
  'package/build/godot-bridge.js',
  'package/scripts/postinstall.mjs',
  'package/scripts/build-release.mjs',
]) {
  assert.equal(packedFiles.has(forbiddenFile), false, `release archive should exclude ${forbiddenFile}`);
}

const extractionRoot = await mkdtemp(path.join(os.tmpdir(), 'gopeak-packaging-'));
try {
  const extract = Bun.spawnSync(['tar', '-xzf', archivePath, '-C', extractionRoot], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(extract.exitCode, 0, extract.stderr.toString());

  const packedRoot = path.join(extractionRoot, 'package');
  const packedPackage = JSON.parse(await readFile(path.join(packedRoot, 'package.json'), 'utf8'));
  assert.deepEqual(packedPackage.dependencies ?? {}, {}, 'packed runtime should not fetch dependencies');
  assert.deepEqual(packedPackage.peerDependencies ?? {}, {}, 'packed runtime should not fetch peer dependencies');
  assert.deepEqual(packedPackage.optionalDependencies ?? {}, {}, 'packed runtime should not fetch optional dependencies');
  assert.equal(packedPackage.devDependencies, undefined, 'packed runtime should not include development dependencies');
  assert.equal(packedPackage.scripts?.prepare, undefined, 'packed package should not require prepare');
  assert.equal(packedPackage.scripts?.postinstall, undefined, 'packed package should not require postinstall');

  const scriptCommands = Object.values(packedPackage.scripts ?? {}).join('\n');
  assert.doesNotMatch(scriptCommands, /\b(?:npm|npx)\b/, 'packed scripts should use Bun, not npm or npx commands');

  const cliPath = path.join(packedRoot, 'build', 'cli.js');
  const cliMode = (await stat(cliPath)).mode & 0o777;
  assert.equal(cliMode, 0o755, 'packed CLI should be executable without world-writable permissions');
  assert.equal(
    (await stat(path.join(packedRoot, 'build', 'godot-mcp.js'))).mode & 0o777,
    0o755,
    'packed compatibility bin should be executable without world-writable permissions',
  );
  assert.ok(
    (await readFile(cliPath, 'utf8')).startsWith('#!/usr/bin/env bun\n'),
    'packed CLI should execute with Bun when linked as a global bin',
  );
  for (const bundleName of ['cli.js', 'index.js']) {
    const bundle = await readFile(path.join(packedRoot, 'build', bundleName), 'utf8');
    const externalPackageImport = bundle.match(
      /(?:from\s+|import\()["'](?:@modelcontextprotocol|fs-extra)(?:[\/"'])/,
    )?.[0] ?? null;
    assert.equal(
      externalPackageImport,
      null,
      `${bundleName} should not import a package that is absent from the release manifest`,
    );
  }

  // Some archive tools on Windows do not restore executable mode; Bun can still run the prebuilt bin.
  await chmod(cliPath, 0o755);
  const cli = Bun.spawnSync([process.execPath, cliPath, 'version'], {
    cwd: packedRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  assert.equal(cli.exitCode, 0, cli.stderr.toString());
  assert.equal(cli.stdout.toString().trim(), `gopeak v${pkg.version}`, 'packed bin should report the archive version');
} finally {
  await rm(extractionRoot, { recursive: true, force: true });
}

console.log(`Bun release archive verified: dist/${archiveName}`);
