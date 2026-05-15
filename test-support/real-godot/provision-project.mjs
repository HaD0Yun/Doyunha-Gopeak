import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';

export function provisionProject(fixturePath, runId) {
  const runDir = resolve(join('.test-runs', runId));
  mkdirSync(runDir, { recursive: true });
  const srcFixture = resolve(fixturePath);
  if (!existsSync(srcFixture)) {
    throw new Error(`Fixture project not found: ${srcFixture}`);
  }
  cpSync(srcFixture, runDir, { recursive: true });
  return runDir;
}

export function getProjectPath(runId) {
  return resolve(join('.test-runs', runId));
}

export function generateRunId() {
  return randomUUID().slice(0, 8);
}