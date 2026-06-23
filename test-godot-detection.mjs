#!/usr/bin/env node
/**
 * Unit tests for Godot versioned-binary auto-detection (Issue #67).
 *
 * Godot release downloads use versioned filenames such as
 * `Godot_v4.4.1-stable_win64.exe` that the hard-coded candidate list in
 * detectGodotPath() cannot match. scanDirectoryForGodotBinaries() globs an
 * install directory for any Godot executable and returns candidates sorted
 * newest-first by mtime.
 *
 * These tests run against a real temp directory with synthetic files so the
 * glob/sort logic is exercised without requiring an actual Godot install.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { scanDirectoryForGodotBinaries } = await import('./build/index.js');

function testIgnoresEmptyAndMissingDirectories() {
  assert.deepEqual(scanDirectoryForGodotBinaries(''), [], 'empty directory returns no candidates');
  assert.deepEqual(
    scanDirectoryForGodotBinaries('/nonexistent/path/xyz'),
    [],
    'missing directory returns no candidates',
  );
}

function testDetectsVersionedWindowsBinaries() {
  const dir = mkdtempSync(join(tmpdir(), 'gopeak-detect-win-'));
  try {
    writeFileSync(join(dir, 'Godot_v4.4.1-stable_win64.exe'), '');
    writeFileSync(join(dir, 'Godot_v4.3-stable_win64.exe'), '');
    writeFileSync(join(dir, 'notepad.exe'), '');
    writeFileSync(join(dir, 'readme.txt'), '');

    const result = scanDirectoryForGodotBinaries(dir, 'win32');
    assert.equal(result.length, 2, 'should find both Godot exe files');
    assert.ok(result.every((p) => /\.exe$/i.test(p)), 'all win32 candidates must be .exe');
    assert.ok(
      result.some((p) => p.includes('Godot_v4.4.1-stable_win64.exe')),
      'should include the versioned 4.4.1 binary',
    );
    assert.ok(
      !result.some((p) => p.includes('notepad.exe')),
      'should not include non-Godot executables',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testDetectsVersionedLinuxBinaries() {
  const dir = mkdtempSync(join(tmpdir(), 'gopeak-detect-linux-'));
  try {
    writeFileSync(join(dir, 'godot_v4.4.1-stable_linux.x86_64'), '');
    writeFileSync(join(dir, 'godot4'), '');
    writeFileSync(join(dir, 'godot'), '');
    writeFileSync(join(dir, 'unrelated_tool'), '');

    const result = scanDirectoryForGodotBinaries(dir, 'linux');
    assert.equal(result.length, 3, 'should find all godot-prefixed binaries');
    assert.ok(
      result.some((p) => p.includes('godot_v4.4.1-stable_linux.x86_64')),
      'should include the versioned linux binary',
    );
    assert.ok(
      !result.some((p) => p.includes('unrelated_tool')),
      'should not include non-godot files',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testNewestFirstOrdering() {
  const dir = mkdtempSync(join(tmpdir(), 'gopeak-detect-order-'));
  try {
    writeFileSync(join(dir, 'Godot_v4.0-stable_win64.exe'), 'old');
    const past = new Date(Date.now() - 120_000);
    utimesSync(join(dir, 'Godot_v4.0-stable_win64.exe'), past, past);

    writeFileSync(join(dir, 'Godot_v4.4.1-stable_win64.exe'), 'new');

    const result = scanDirectoryForGodotBinaries(dir, 'win32');
    assert.equal(result.length, 2, 'both binaries found');
    assert.ok(
      result[0].includes('Godot_v4.4.1-stable_win64.exe'),
      'newest binary should be returned first, got: ' + result[0],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testIgnoresDirectoriesMatchingPattern() {
  const dir = mkdtempSync(join(tmpdir(), 'gopeak-detect-dir-'));
  try {
    mkdirSync(join(dir, 'Godot_temp'));
    writeFileSync(join(dir, 'Godot_v4.4.1-stable_win64.exe'), '');

    const result = scanDirectoryForGodotBinaries(dir, 'win32');
    assert.equal(result.length, 1, 'should only return files, not directories');
    assert.ok(result[0].includes('Godot_v4.4.1-stable_win64.exe'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  testIgnoresEmptyAndMissingDirectories();
  testDetectsVersionedWindowsBinaries();
  testDetectsVersionedLinuxBinaries();
  testNewestFirstOrdering();
  testIgnoresDirectoriesMatchingPattern();
  console.log('godot detection tests passed');
}

await main();
