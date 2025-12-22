import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendAuditLog,
  assertDangerousOpsAllowed,
  redactSecrets,
  resolveInsideProject,
} from '../build/security.js';

function mkdtemp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('resolveInsideProject allows inside paths and blocks escapes', () => {
  const projectRoot = mkdtemp('godot-mcp-omni-project-');
  const outsideRoot = mkdtemp('godot-mcp-omni-outside-');

  try {
    assert.equal(
      resolveInsideProject(projectRoot, 'res://scenes/main.tscn'),
      path.join(projectRoot, 'scenes', 'main.tscn')
    );
    assert.equal(resolveInsideProject(projectRoot, 'scenes/main.tscn'), path.join(projectRoot, 'scenes', 'main.tscn'));

    assert.throws(() => resolveInsideProject(projectRoot, '../outside.txt'), /Path escapes project root/u);
    assert.throws(() => resolveInsideProject(projectRoot, 'res://../outside.txt'), /Path escapes project root/u);
    assert.throws(() => resolveInsideProject(projectRoot, path.join(outsideRoot, 'x.txt')), /Path escapes project root/u);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('assertDangerousOpsAllowed gates dangerous ops', () => {
  const prev = process.env.ALLOW_DANGEROUS_OPS;
  try {
    delete process.env.ALLOW_DANGEROUS_OPS;
    assert.throws(() => assertDangerousOpsAllowed('export_mesh_library'), /Dangerous operation blocked/u);

    process.env.ALLOW_DANGEROUS_OPS = 'true';
    assert.doesNotThrow(() => assertDangerousOpsAllowed('export_mesh_library'));
  } finally {
    if (prev === undefined) delete process.env.ALLOW_DANGEROUS_OPS;
    else process.env.ALLOW_DANGEROUS_OPS = prev;
  }
});

test('appendAuditLog creates and rotates audit log', () => {
  const projectRoot = mkdtemp('godot-mcp-omni-audit-');
  const prevMax = process.env.GODOT_MCP_AUDIT_MAX_BYTES;
  const prevBackups = process.env.GODOT_MCP_AUDIT_BACKUPS;
  try {
    process.env.GODOT_MCP_AUDIT_MAX_BYTES = '200';
    process.env.GODOT_MCP_AUDIT_BACKUPS = '2';

    appendAuditLog(projectRoot, {
      ts: new Date().toISOString(),
      tool: 'test-tool',
      args: { a: 1 },
      ok: true,
      summary: 'x'.repeat(500),
    });
    appendAuditLog(projectRoot, {
      ts: new Date().toISOString(),
      tool: 'test-tool',
      args: { b: 2 },
      ok: true,
      summary: 'y'.repeat(500),
    });

    const auditDir = path.join(projectRoot, '.godot_mcp');
    const auditPath = path.join(auditDir, 'audit.log');
    const rotatedPath = `${auditPath}.1`;

    assert.ok(fs.existsSync(auditDir));
    assert.ok(fs.existsSync(auditPath));
    assert.ok(fs.existsSync(rotatedPath));

    const rotated = fs.readFileSync(rotatedPath, 'utf8');
    assert.match(rotated, /"tool":"test-tool"/u);
  } finally {
    if (prevMax === undefined) delete process.env.GODOT_MCP_AUDIT_MAX_BYTES;
    else process.env.GODOT_MCP_AUDIT_MAX_BYTES = prevMax;

    if (prevBackups === undefined) delete process.env.GODOT_MCP_AUDIT_BACKUPS;
    else process.env.GODOT_MCP_AUDIT_BACKUPS = prevBackups;

    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('redactSecrets masks common sensitive keys but avoids false positives', () => {
  const input = {
    password: 'x',
    apiKey: 'y',
    access_token: 't1',
    refreshToken: 't2',
    secret_key: 't3',
    nested: { client_secret: 'z' },
    monkey: 'ok',
  };

  const output = redactSecrets(input);

  assert.equal(output.password, '[REDACTED]');
  assert.equal(output.apiKey, '[REDACTED]');
  assert.equal(output.access_token, '[REDACTED]');
  assert.equal(output.refreshToken, '[REDACTED]');
  assert.equal(output.secret_key, '[REDACTED]');
  assert.equal(output.nested.client_secret, '[REDACTED]');
  assert.equal(output.monkey, 'ok');
});
