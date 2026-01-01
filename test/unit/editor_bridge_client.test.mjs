import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

import { EditorBridgeClient } from '../../build/editor_bridge_client.js';
import { PACKAGE_VERSION } from '../../build/version.js';

function startFakeBridge({
  expectedToken = 'test-token',
  helloMode = 'ok',
  onRequest,
} = {}) {
  let clientSocket = null;
  const server = net.createServer((socket) => {
    clientSocket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    let buffer = '';
    let authed = false;

    const send = (obj) => {
      socket.write(`${JSON.stringify(obj)}\n`);
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const raw = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!raw) continue;

        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }

        if (!authed) {
          if (msg?.type !== 'hello') {
            send({
              type: 'hello_error',
              error: 'First message must be hello.',
            });
            return;
          }
          if (String(msg.token ?? '') !== expectedToken) {
            send({ type: 'hello_error', error: 'Invalid token.' });
            return;
          }
          authed = true;
          if (helloMode === 'error') {
            send({ type: 'hello_error', error: 'Invalid token.' });
          } else {
            send({
              type: 'hello_ok',
              capabilities: {
                protocol: 'tcp-jsonl-1',
                plugin_version: PACKAGE_VERSION,
              },
            });
          }
          continue;
        }

        if (typeof onRequest === 'function') {
          onRequest(msg, socket);
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((r) => server.close(r)),
        destroyClient: () => clientSocket?.destroy(),
      });
    });
  });
}

test('connect resolves on hello_ok', async () => {
  const bridge = await startFakeBridge({
    expectedToken: 'test-token',
    helloMode: 'ok',
  });
  const client = new EditorBridgeClient();
  try {
    const hello = await client.connect({
      host: '127.0.0.1',
      port: bridge.port,
      token: 'test-token',
      timeoutMs: 200,
    });
    assert.equal(hello.type, 'hello_ok');
  } finally {
    client.close();
    await bridge.close();
  }
});

test('connect rejects on hello_error', async () => {
  const bridge = await startFakeBridge({
    expectedToken: 'test-token',
    helloMode: 'error',
  });
  const client = new EditorBridgeClient();
  try {
    await assert.rejects(
      client.connect({
        host: '127.0.0.1',
        port: bridge.port,
        token: 'test-token',
        timeoutMs: 200,
      }),
      /token/i,
    );
  } finally {
    client.close();
    await bridge.close();
  }
});

test('request resolves with matching id', async () => {
  const bridge = await startFakeBridge({
    onRequest: (msg, socket) => {
      socket.write(
        `${JSON.stringify({ id: msg.id, ok: true, result: { pong: true } })}\n`,
      );
    },
  });
  const client = new EditorBridgeClient();
  try {
    await client.connect({
      host: '127.0.0.1',
      port: bridge.port,
      token: 'test-token',
      timeoutMs: 200,
    });
    const resp = await client.request('ping', {}, 200);
    assert.equal(resp.id, 1);
    assert.equal(resp.ok, true);
  } finally {
    client.close();
    await bridge.close();
  }
});

test('request rejects on timeout when no response', async () => {
  const bridge = await startFakeBridge({
    onRequest: () => {
      // Intentionally do nothing to trigger timeout.
    },
  });
  const client = new EditorBridgeClient();
  try {
    await client.connect({
      host: '127.0.0.1',
      port: bridge.port,
      token: 'test-token',
      timeoutMs: 200,
    });
    await assert.rejects(client.request('ping', {}, 50), /timeout/i);
  } finally {
    client.close();
    await bridge.close();
  }
});

test('pending requests reject on socket close', async () => {
  const bridge = await startFakeBridge({
    onRequest: (_msg, socket) => {
      socket.destroy();
    },
  });
  const client = new EditorBridgeClient();
  try {
    await client.connect({
      host: '127.0.0.1',
      port: bridge.port,
      token: 'test-token',
      timeoutMs: 200,
    });
    await assert.rejects(client.request('ping', {}, 200), /socket closed/i);
  } finally {
    client.close();
    await bridge.close();
  }
});
