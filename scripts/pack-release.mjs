#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePackage = await Bun.file(path.join(root, 'package.json')).json();
const outputDirectory = path.join(root, 'dist');
const archiveName = `gopeak-${sourcePackage.version}.tgz`;
const archivePath = path.join(outputDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;
const stagingRoot = await mkdtemp(path.join(os.tmpdir(), 'gopeak-release-pack-'));

const releasePackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  mcpName: sourcePackage.mcpName,
  description: sourcePackage.description,
  type: sourcePackage.type,
  main: sourcePackage.main,
  bin: {
    gopeak: 'build/cli.js',
    'godot-mcp': 'build/godot-mcp.js',
  },
  engines: sourcePackage.engines,
  license: sourcePackage.license,
  repository: sourcePackage.repository,
  homepage: sourcePackage.homepage,
  bugs: sourcePackage.bugs,
  author: sourcePackage.author,
  funding: sourcePackage.funding,
  keywords: sourcePackage.keywords,
};

try {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(path.join(stagingRoot, 'build'), { recursive: true });

  await Promise.all([
    ...['cli.js', 'godot-mcp.js', 'index.js', 'visualizer.html'].map((name) =>
      cp(path.join(root, 'build', name), path.join(stagingRoot, 'build', name))),
    cp(path.join(root, 'build', 'addon'), path.join(stagingRoot, 'build', 'addon'), { recursive: true }),
    cp(path.join(root, 'build', 'scripts'), path.join(stagingRoot, 'build', 'scripts'), { recursive: true }),
    cp(path.join(root, 'README.md'), path.join(stagingRoot, 'README.md')),
    cp(path.join(root, 'LICENSE'), path.join(stagingRoot, 'LICENSE')),
    writeFile(
      path.join(stagingRoot, 'package.json'),
      `${JSON.stringify(releasePackage, null, 2)}\n`,
      'utf8',
    ),
  ]);

  const stagedArchive = path.join(stagingRoot, archiveName);
  const pack = Bun.spawnSync([
    process.execPath,
    'pm',
    'pack',
    '--ignore-scripts',
    '--filename',
    stagedArchive,
    '--quiet',
  ], {
    cwd: stagingRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (pack.exitCode !== 0) {
    throw new Error(`bun pm pack failed:\n${pack.stderr.toString().trim()}`);
  }

  await rename(stagedArchive, archivePath);
  const archive = await readFile(archivePath);
  const checksum = createHash('sha256').update(archive).digest('hex');
  await writeFile(checksumPath, `${checksum}  ${archiveName}\n`, 'utf8');
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

console.log(path.relative(root, archivePath));
console.log(path.relative(root, checksumPath));
