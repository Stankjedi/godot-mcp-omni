import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs } from '../../build/cli/args/parse_args.js';

test('parseArgs: --scenarios-json without --run-scenarios preserves error contract', () => {
  assert.throws(
    () => parseArgs(['node', 'build/index.js', '--scenarios-json']),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /only supported with --run-scenarios/);
      assert.match(error.message, /Usage:/);
      return true;
    },
  );
});

test('parseArgs: --workflow-json without --run-workflow preserves error contract', () => {
  assert.throws(
    () => parseArgs(['node', 'build/index.js', '--workflow-json']),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /only supported with --run-workflow/);
      assert.match(error.message, /Usage:/);
      return true;
    },
  );
});
