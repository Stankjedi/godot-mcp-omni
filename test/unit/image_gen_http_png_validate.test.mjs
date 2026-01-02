import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { HttpImageGenAdapter } from '../../build/pipeline/image_gen_adapter.js';

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7qkAAAAASUVORK5CYII=',
  'base64',
);

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('HttpImageGenAdapter writes file for valid PNG response', async () => {
  await withServer(
    (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(VALID_PNG);
    },
    async (baseUrl) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'http-image-gen-'));
      const outPath = path.join(dir, 'out.png');
      try {
        const adapter = new HttpImageGenAdapter(`${baseUrl}/generate`);
        const result = await adapter.generateImage('hello', {
          width: 1,
          height: 1,
          outputPath: outPath,
        });
        assert.equal(result.pngPath, outPath);

        const written = await readFile(outPath);
        assert.deepEqual(written, VALID_PNG);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

test('HttpImageGenAdapter rejects non-PNG bytes and does not write output', async () => {
  await withServer(
    (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from('not a png'));
    },
    async (baseUrl) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'http-image-gen-'));
      const outPath = path.join(dir, 'out.png');
      try {
        const adapter = new HttpImageGenAdapter(`${baseUrl}/generate`);
        await assert.rejects(
          adapter.generateImage('hello', {
            width: 1,
            height: 1,
            outputPath: outPath,
          }),
          /invalid PNG/u,
        );
        await assert.rejects(() => readFile(outPath), /ENOENT/u);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

test('HttpImageGenAdapter fails on redirects (does not follow)', async () => {
  let pngHits = 0;
  await withServer(
    (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }

      if (req.url === '/redirect') {
        res.statusCode = 302;
        res.setHeader('Location', '/png');
        res.end();
        return;
      }

      if (req.url === '/png') {
        pngHits += 1;
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(VALID_PNG);
        return;
      }

      res.statusCode = 404;
      res.end();
    },
    async (baseUrl) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'http-image-gen-'));
      const outPath = path.join(dir, 'out.png');
      try {
        const adapter = new HttpImageGenAdapter(`${baseUrl}/redirect`);
        await assert.rejects(
          adapter.generateImage('hello', {
            width: 1,
            height: 1,
            outputPath: outPath,
          }),
          /HTTP 302/u,
        );
        assert.equal(pngHits, 0);
        await assert.rejects(() => readFile(outPath), /ENOENT/u);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
