import assert from 'node:assert/strict';
import test from 'node:test';

import { createImageGenAdapter } from '../../build/pipeline/image_gen_adapter.js';

function withTempEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('createImageGenAdapter allows https IMAGE_GEN_URL', () => {
  withTempEnv(
    {
      ALLOW_EXTERNAL_TOOLS: 'true',
      IMAGE_GEN_URL: 'https://example.com/generate',
      ALLOW_INSECURE_IMAGE_GEN_HTTP: undefined,
    },
    () => {
      const adapter = createImageGenAdapter({ allowExternalTools: true });
      assert.equal(adapter.name, 'http');
    },
  );
});

test('createImageGenAdapter allows http localhost IMAGE_GEN_URL', () => {
  withTempEnv(
    {
      ALLOW_EXTERNAL_TOOLS: 'true',
      IMAGE_GEN_URL: 'http://127.0.0.1:1234/generate',
      ALLOW_INSECURE_IMAGE_GEN_HTTP: undefined,
    },
    () => {
      const adapter = createImageGenAdapter({ allowExternalTools: true });
      assert.equal(adapter.name, 'http');
    },
  );
});

test('createImageGenAdapter blocks http remote IMAGE_GEN_URL by default', () => {
  withTempEnv(
    {
      ALLOW_EXTERNAL_TOOLS: 'true',
      IMAGE_GEN_URL: 'http://example.com/generate',
      ALLOW_INSECURE_IMAGE_GEN_HTTP: undefined,
    },
    () => {
      assert.throws(
        () => createImageGenAdapter({ allowExternalTools: true }),
        /http: is only allowed for localhost/u,
      );
    },
  );
});

test('createImageGenAdapter blocks non-http(s) IMAGE_GEN_URL', () => {
  withTempEnv(
    {
      ALLOW_EXTERNAL_TOOLS: 'true',
      IMAGE_GEN_URL: 'file:///tmp/image.png',
      ALLOW_INSECURE_IMAGE_GEN_HTTP: undefined,
    },
    () => {
      assert.throws(
        () => createImageGenAdapter({ allowExternalTools: true }),
        /must use http: or https:/u,
      );
    },
  );
});

test('createImageGenAdapter blocks credentials in IMAGE_GEN_URL', () => {
  withTempEnv(
    {
      ALLOW_EXTERNAL_TOOLS: 'true',
      IMAGE_GEN_URL: 'https://user:pass@example.com/generate',
      ALLOW_INSECURE_IMAGE_GEN_HTTP: undefined,
    },
    () => {
      assert.throws(
        () => createImageGenAdapter({ allowExternalTools: true }),
        /credentials are not allowed/u,
      );
    },
  );
});

test('createImageGenAdapter allows remote http IMAGE_GEN_URL with explicit opt-in', () => {
  withTempEnv(
    {
      ALLOW_EXTERNAL_TOOLS: 'true',
      IMAGE_GEN_URL: 'http://example.com/generate',
      ALLOW_INSECURE_IMAGE_GEN_HTTP: 'true',
    },
    () => {
      const adapter = createImageGenAdapter({ allowExternalTools: true });
      assert.equal(adapter.name, 'http');
    },
  );
});
