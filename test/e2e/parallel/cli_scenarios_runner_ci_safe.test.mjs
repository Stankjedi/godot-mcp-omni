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
