import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function loadReport(projectPath, runId) {
  const reportPath = resolve(projectPath, '.gopeak', 'test-runs', `${runId}.json`);
  if (!existsSync(reportPath)) {
    throw new Error(`Report not found: ${reportPath}`);
  }
  return JSON.parse(readFileSync(reportPath, 'utf-8'));
}

export function loadLatestReport(projectPath) {
  const runsDir = resolve(projectPath, '.gopeak', 'test-runs');
  if (!existsSync(runsDir)) {
    throw new Error(`Runs directory not found: ${runsDir}`);
  }
  const files = readdirSync(runsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No test reports found');
  }

  const latest = files[0];
  return JSON.parse(readFileSync(join(runsDir, latest), 'utf-8'));
}

export function listReports(projectPath, limit = 5) {
  const runsDir = resolve(projectPath, '.gopeak', 'test-runs');
  if (!existsSync(runsDir)) {
    return [];
  }
  return readdirSync(runsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => f.replace('.json', ''));
}

export function assertReportPassed(report) {
  if (!report || report.passed !== true) {
    throw new Error(`Report ${report?.id} did not pass: passed=${report?.passed}`);
  }
  return true;
}

export function assertReportHasId(report, expectedId) {
  if (report.id !== expectedId) {
    throw new Error(`Report id mismatch: expected ${expectedId}, got ${report.id}`);
  }
  return true;
}

export function assertScenarioName(report, expectedName) {
  if (report.scenarioName !== expectedName) {
    throw new Error(`Scenario name mismatch: expected ${expectedName}, got ${report.scenarioName}`);
  }
  return true;
}