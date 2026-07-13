#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const SERVER_JSON_PATH = path.join(ROOT, 'server.json');
const VERSION_REFERENCE_PATHS = [
  'README.md',
  'README-de.md',
  'README-ja.md',
  'README-ko.md',
  'README-pt_BR.md',
  'README-zh.md',
  'index.html',
];
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const SEMVER_SOURCE = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?`;

const usage = `Usage:\n  bun scripts/bump-version.mjs <version|major|minor|patch> [--dry-run]\n\nExamples:\n  bun scripts/bump-version.mjs patch\n  bun scripts/bump-version.mjs 2.3.0 --dry-run`;

function assertVersion(version) {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
}

function bumpVersion(currentVersion, bumpType) {
  const match = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Current version is not a simple semver (x.y.z): ${currentVersion}`);
  }

  const [major, minor, patch] = match.slice(1).map(Number);
  if (bumpType === 'major') return `${major + 1}.0.0`;
  if (bumpType === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function replaceReleaseVersionReferences(content, nextVersion) {
  return content
    .replace(
      new RegExp(`(releases/download/v)${SEMVER_SOURCE}(/gopeak-)${SEMVER_SOURCE}(\\.tgz)`, 'g'),
      `$1${nextVersion}$2${nextVersion}$3`,
    )
    .replace(new RegExp(`(gopeak-)${SEMVER_SOURCE}(\\.tgz(?:\\.sha256)?)`, 'g'), `$1${nextVersion}$2`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeText(filePath, content, dryRun) {
  if (!dryRun) {
    await fs.writeFile(filePath, content, 'utf8');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const target = args.find((arg) => !arg.startsWith('-'));

  if (!target) {
    console.error(usage);
    process.exit(1);
  }

  const pkg = await readJson(PACKAGE_JSON_PATH);
  const currentVersion = pkg.version;
  let nextVersion;

  if (target === 'major' || target === 'minor' || target === 'patch') {
    nextVersion = bumpVersion(currentVersion, target);
  } else {
    assertVersion(target);
    nextVersion = target;
  }

  assertVersion(nextVersion);

  if (nextVersion === currentVersion) {
    console.log(`No changes needed. Version is already ${nextVersion}.`);
    return;
  }

  const changed = [];

  pkg.version = nextVersion;
  await writeText(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`, dryRun);
  changed.push('package.json');

  const server = await readJson(SERVER_JSON_PATH);
  server.version = nextVersion;
  await writeText(SERVER_JSON_PATH, `${JSON.stringify(server, null, 2)}\n`, dryRun);
  changed.push('server.json');

  for (const relativePath of VERSION_REFERENCE_PATHS) {
    const filePath = path.join(ROOT, relativePath);
    const original = await fs.readFile(filePath, 'utf8');
    const updated = replaceReleaseVersionReferences(original, nextVersion);
    if (updated !== original) {
      await writeText(filePath, updated, dryRun);
      changed.push(relativePath);
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Version bump ${currentVersion} -> ${nextVersion}`);
  console.log(`Updated: ${changed.join(', ')}`);
  if (dryRun) {
    console.log('No files were written.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
