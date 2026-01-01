import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const runnerPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run_mcp_scenarios.js',
);

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

test('Scenario runner supports --out-dir report generation and --no-report', async () => {
  const tmp = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-scenarios-report-'),
  );

  const jsonPath = path.join(tmp, 'scenario_run_report.json');
  const mdPath = path.join(tmp, 'scenario_run_report.md');

  try {
    const resWrite = spawnSync(
      process.execPath,
      [runnerPath, '--ci-safe', '--out-dir', tmp],
      { encoding: 'utf8' },
    );

    assert.equal(
      resWrite.status,
      0,
      `Expected exit 0, got ${resWrite.status}\n\nSTDOUT:\n${resWrite.stdout}\n\nSTDERR:\n${resWrite.stderr}`,
    );

    assert.equal(await pathExists(jsonPath), true, 'Expected JSON report');
    assert.equal(await pathExists(mdPath), true, 'Expected Markdown report');

    const reportJson = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    assert.equal(typeof reportJson.schemaVersion, 'number');
    assert.ok(reportJson.totals && typeof reportJson.totals === 'object');
    assert.ok(Array.isArray(reportJson.scenarios));

    const reportMd = await fs.readFile(mdPath, 'utf8');
    assert.match(reportMd, /schemaVersion/u);
    assert.match(reportMd, /totals/u);
    assert.match(reportMd, /scenarios/u);

    await fs.rm(jsonPath, { force: true });
    await fs.rm(mdPath, { force: true });

    const resNoReport = spawnSync(
      process.execPath,
      [runnerPath, '--ci-safe', '--no-report', '--out-dir', tmp],
      { encoding: 'utf8' },
    );

    assert.equal(
      resNoReport.status,
      0,
      `Expected exit 0, got ${resNoReport.status}\n\nSTDOUT:\n${resNoReport.stdout}\n\nSTDERR:\n${resNoReport.stderr}`,
    );

    assert.equal(await pathExists(jsonPath), false, 'Expected no JSON report');
    assert.equal(
      await pathExists(mdPath),
      false,
      'Expected no Markdown report',
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
