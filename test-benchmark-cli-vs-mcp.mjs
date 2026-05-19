#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const repoRoot = resolve(new URL('.', import.meta.url).pathname);
const benchmarkScript = join(repoRoot, 'scripts', 'benchmark', 'cli-vs-mcp-benchmark.mjs');
const fixtureProject = process.env.GOPEAK_TEST_PROJECT || join(repoRoot, 'test-fixtures', 'benchmark-project');

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), 'gopeak-benchmark-capabilities-'));
  const projectCopy = join(tempRoot, 'benchmark-project');
  const reportPath = join(tempRoot, 'benchmark-report.json');

  try {
    await execFile('cp', ['-R', fixtureProject, projectCopy], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 20,
    });

    const { stdout } = await execFile(process.execPath, [
      benchmarkScript,
      '--projectPath', projectCopy,
      '--tasks', 'scene_create',
      '--iterations', '1',
      '--output', reportPath,
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        GOPEAK_TOOL_PROFILE: 'compact',
        GODOT_PATH: process.env.GODOT_PATH || 'godot',
      },
      maxBuffer: 1024 * 1024 * 20,
    });

    const report = JSON.parse(stdout);
    const writtenReport = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual(writtenReport, report, 'stdout report and --output report should match');

    assert.equal(report.benchmark, 'gopeak-cli-vs-mcp');
    assert.equal(report.capabilities.editor_bridge, false);
    assert.equal(report.tasks.length, 1);

    const [task] = report.tasks;
    assert.equal(task.taskId, 'scene_create');
    assert.equal(task.runs.length, 2);
    assert.equal(task.summary.cli.okRuns, 1);
    assert.equal(task.summary.cli.skippedRuns, 0);
    assert.equal(task.summary.mcp.okRuns, 0);
    assert.equal(task.summary.mcp.skippedRuns, 1);

    const mcpRun = task.runs.find((run) => run.surface === 'mcp');
    assert.equal(mcpRun.ok, false);
    assert.equal(mcpRun.skipped, true);
    assert.equal(mcpRun.skipReason, 'missing capabilities: editor_bridge');
    assert.equal(mcpRun.invocationCount, 0);
    assert.equal(mcpRun.interfaceTokenEstimate, 0);

    console.log('benchmark capability skip regression checks passed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
