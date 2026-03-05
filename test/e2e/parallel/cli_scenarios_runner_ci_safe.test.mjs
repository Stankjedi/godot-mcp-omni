import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildIndexPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'build',
  'index.js',
);

test('CLI scenarios runner executes CI-safe scenarios and exits 0', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--run-scenarios', '--ci-safe'],
    { encoding: 'utf8' },
  );

  assert.equal(res.status, 0);
  assert.match(res.stdout, /SCENARIOS: OK/u);
  assert.equal(res.stderr.trim(), '');
});

test('CLI scenarios runner supports JSON-only stdout report mode (CI-safe)', () => {
  const res = spawnSync(
    process.execPath,
    [buildIndexPath, '--run-scenarios', '--ci-safe', '--scenarios-json'],
    { encoding: 'utf8' },
  );

  assert.equal(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed && typeof parsed === 'object');
  assert.ok('schemaVersion' in parsed);
  assert.ok('totals' in parsed);
  assert.ok('scenarios' in parsed);
});

test('CLI scenarios runner supports --scenario filtering (CI-safe + JSON)', () => {
  const res = spawnSync(
    process.execPath,
    [
      buildIndexPath,
      '--run-scenarios',
      '--ci-safe',
      '--scenarios-json',
      '--scenario',
      'SCN-001',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.totals?.total, 1);
  assert.equal(parsed.scenarios?.length, 1);
});

test('CLI scenarios runner prints JSON-only error output for unknown --scenario ids (CI-safe + JSON)', () => {
  const res = spawnSync(
    process.execPath,
    [
      buildIndexPath,
      '--run-scenarios',
      '--ci-safe',
      '--scenarios-json',
      '--scenario',
      'DOES_NOT_EXIST',
    ],
    { encoding: 'utf8' },
  );

  assert.notEqual(res.status, 0);
  assert.equal(res.stderr.trim(), '');

  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error?.code, 'E_SCENARIO_FILTER');
});
