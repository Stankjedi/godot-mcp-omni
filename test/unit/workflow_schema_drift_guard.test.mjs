import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateWorkflowJson } from '../../build/workflow/workflow_validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.join(__dirname, '..', '..');
const schemaPath = path.join(repoRoot, 'scripts', 'workflow.schema.json');

function assertArrayIncludes(label, arr, value) {
  assert.ok(Array.isArray(arr), `${label} must be an array`);
  assert.ok(
    arr.includes(value),
    `${label} must include ${JSON.stringify(value)}`,
  );
}

test('workflow.schema.json drift guard: schema has required constraints', async () => {
  const raw = await fs.readFile(schemaPath, 'utf8');
  const schema = JSON.parse(raw);

  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assertArrayIncludes('schema.required', schema.required, 'schemaVersion');
  assertArrayIncludes('schema.required', schema.required, 'steps');

  assert.ok(schema.properties && typeof schema.properties === 'object');
  assert.ok(
    schema.properties.schemaVersion &&
      typeof schema.properties.schemaVersion === 'object',
  );
  assert.equal(schema.properties.schemaVersion.const, 1);

  assert.ok(
    schema.properties.steps && typeof schema.properties.steps === 'object',
  );
  assert.equal(schema.properties.steps.type, 'array');

  const stepsItems = schema.properties.steps.items;
  assert.ok(stepsItems && typeof stepsItems === 'object');
  assert.equal(stepsItems.additionalProperties, false);
  assertArrayIncludes(
    'schema.properties.steps.items.required',
    stepsItems.required,
    'tool',
  );
});

test('workflow.schema.json drift guard: validateWorkflowJson stays aligned', () => {
  const normalized = validateWorkflowJson({
    schemaVersion: 1,
    steps: [{ tool: 'tools/list', args: {} }],
  });

  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.projectPath, null);
  assert.equal(normalized.steps.length, 1);

  const step = normalized.steps[0];
  assert.equal(step.id, 'STEP-1');
  assert.equal(step.title, 'tools/list');
  assert.equal(step.tool, 'tools/list');
  assert.deepEqual(step.args, {});
  assert.equal(step.expectOk, true);

  assert.throws(
    () => validateWorkflowJson({ schemaVersion: 2, steps: [] }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('schemaVersion must be 1'));
      return true;
    },
  );

  assert.throws(
    () => validateWorkflowJson({ schemaVersion: 1, steps: {} }),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('steps must be an array'));
      return true;
    },
  );
});
