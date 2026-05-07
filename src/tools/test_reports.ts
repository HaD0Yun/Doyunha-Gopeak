import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TEST_RUNS_SUBDIR = '.gopeak/test-runs';

export interface TestStepRecord {
  index: number;
  type: string;
  args?: unknown;
  ok: boolean;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface TestAssertionRecord {
  index: number;
  type: string;
  description?: string;
  expected?: unknown;
  actual?: unknown;
  ok: boolean;
  error?: string;
}

export interface TestRunRecord {
  id: string;
  scenarioName?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  passed: boolean;
  steps: TestStepRecord[];
  asserts: TestAssertionRecord[];
  setup?: TestStepRecord[];
  teardown?: TestStepRecord[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export function getTestRunsDir(projectPath: string): string {
  return resolve(projectPath, TEST_RUNS_SUBDIR);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

export function writeTestRun(projectPath: string, record: TestRunRecord): string {
  const dir = getTestRunsDir(projectPath);
  ensureDir(dir);
  const filePath = join(dir, `${record.id}.json`);
  writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return filePath;
}

export function listTestRuns(projectPath: string): Array<{ id: string; path: string; mtime: number; size: number }> {
  const dir = getTestRunsDir(projectPath);
  if (!existsSync(dir)) {
    return [];
  }
  const entries = readdirSync(dir).filter((f) => f.endsWith('.json'));
  return entries
    .map((file) => {
      const full = join(dir, file);
      const stat = statSync(full);
      return { id: file.replace(/\.json$/, ''), path: full, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function readTestRun(projectPath: string, id: string): TestRunRecord {
  const file = join(getTestRunsDir(projectPath), `${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`Test run not found: ${id}`);
  }
  const raw = readFileSync(file, 'utf-8');
  return JSON.parse(raw) as TestRunRecord;
}

export function readTestRunRaw(projectPath: string, id: string): { mimeType: string; text: string } {
  const file = join(getTestRunsDir(projectPath), `${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`Test run not found: ${id}`);
  }
  return { mimeType: 'application/json', text: readFileSync(file, 'utf-8') };
}
