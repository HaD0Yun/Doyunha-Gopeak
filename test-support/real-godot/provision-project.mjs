import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';

const ADDON_SOURCE_DIR = resolve('src/addon');
const REQUIRED_ADDONS = ['godot_mcp_editor', 'godot_mcp_runtime'];

export function provisionProject(fixturePath, runId) {
  const runDir = resolve(join('.test-runs', runId));
  mkdirSync(runDir, { recursive: true });
  const srcFixture = resolve(fixturePath);
  if (!existsSync(srcFixture)) {
    throw new Error(`Fixture project not found: ${srcFixture}`);
  }
  cpSync(srcFixture, runDir, { recursive: true });

  const addonsDir = join(runDir, 'addons');
  mkdirSync(addonsDir, { recursive: true });
  for (const addon of REQUIRED_ADDONS) {
    const src = join(ADDON_SOURCE_DIR, addon);
    if (!existsSync(src)) {
      throw new Error(`Required addon source not found: ${src}`);
    }
    cpSync(src, join(addonsDir, addon), { recursive: true });
  }

  return runDir;
}

export function getProjectPath(runId) {
  return resolve(join('.test-runs', runId));
}

export function generateRunId() {
  return randomUUID().slice(0, 8);
}