import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpawnEnv } from '../../build/cli/runner_utils.js';

test('buildSpawnEnv does not inherit secrets and forces safety defaults (CI-safe)', () => {
  const parentEnv = {
    PATH: '/usr/bin:/bin',
    HOME: '/home/test',
    AWS_SECRET_ACCESS_KEY: 'must-not-leak',
    SPEC_GEN_URL: 'http://127.0.0.1:1',
    GODOT_PATH: '/parent/ignored/by-ci-safe',
    DEBUG: 'true',
  };

  const env = buildSpawnEnv({
    parentEnv,
    ciSafe: true,
    effectiveGodotPath: '/ignored/by-ci-safe',
  });

  assert.equal(env.PATH, parentEnv.PATH);
  assert.equal(env.HOME, parentEnv.HOME);
  assert.equal(env.DEBUG, parentEnv.DEBUG);

  assert.equal(env.GODOT_PATH, '');
  assert.equal(env.ALLOW_DANGEROUS_OPS, 'false');
  assert.equal(env.ALLOW_EXTERNAL_TOOLS, 'false');

  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.SPEC_GEN_URL, undefined);
});

test('buildSpawnEnv sets GODOT_PATH deterministically when not CI-safe', () => {
  const parentEnv = {
    PATH: '/usr/bin:/bin',
    AWS_SECRET_ACCESS_KEY: 'must-not-leak',
    GODOT_PATH: '/parent/godot',
  };

  const env = buildSpawnEnv({
    parentEnv,
    ciSafe: false,
    effectiveGodotPath: '/explicit/godot',
  });

  assert.equal(env.GODOT_PATH, '/explicit/godot');
  assert.equal(env.ALLOW_DANGEROUS_OPS, 'false');
  assert.equal(env.ALLOW_EXTERNAL_TOOLS, 'false');
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
});
