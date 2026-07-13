#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = import.meta.dirname;
const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'gopeak-version-bump-'));
const maintainedFiles = [
  'README.md',
  'README-de.md',
  'README-ja.md',
  'README-ko.md',
  'README-pt_BR.md',
  'README-zh.md',
  'index.html',
];

try {
  // Given: every maintained install surface points at the current release asset.
  await mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true });
  await cp(path.join(root, 'scripts', 'bump-version.mjs'), path.join(fixtureRoot, 'scripts', 'bump-version.mjs'));
  await writeFile(path.join(fixtureRoot, 'package.json'), '{"name":"gopeak","version":"2.3.9"}\n');
  await writeFile(path.join(fixtureRoot, 'server.json'), '{"name":"io.github.HaD0Yun/gopeak","version":"2.3.9"}\n');
  for (const fileName of maintainedFiles) {
    await writeFile(
      path.join(fixtureRoot, fileName),
      'https://github.com/HaD0Yun/Doyunha-Gopeak/releases/download/v2.3.9/gopeak-2.3.9.tgz\n' +
        'gopeak-2.3.9.tgz.sha256\nbun add -g "$PWD/gopeak-2.3.9.tgz"\n',
    );
  }

  // When: the release version is bumped once.
  const bump = Bun.spawnSync([process.execPath, 'scripts/bump-version.mjs', '2.4.0'], {
    cwd: fixtureRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Then: metadata and every maintained download/install reference move together.
  assert.equal(bump.exitCode, 0, bump.stderr.toString());
  assert.equal(JSON.parse(await readFile(path.join(fixtureRoot, 'package.json'), 'utf8')).version, '2.4.0');
  assert.equal(JSON.parse(await readFile(path.join(fixtureRoot, 'server.json'), 'utf8')).version, '2.4.0');
  for (const fileName of maintainedFiles) {
    const content = await readFile(path.join(fixtureRoot, fileName), 'utf8');
    assert.doesNotMatch(content, /2\.3\.9/, `${fileName} should not retain the previous release version`);
    assert.match(content, /releases\/download\/v2\.4\.0\/gopeak-2\.4\.0\.tgz/);
    assert.match(content, /gopeak-2\.4\.0\.tgz\.sha256/);
    assert.match(content, /\$PWD\/gopeak-2\.4\.0\.tgz/);
  }
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log('version bump synchronization checks passed');
