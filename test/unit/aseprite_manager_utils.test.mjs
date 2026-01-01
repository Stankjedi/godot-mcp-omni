import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  absPathToResPath,
  ensureAPrefix,
  numberToFilenameToken,
  resolvePathLikeInsideProject,
  sanitizeFileComponent,
} from '../../build/pipeline/aseprite_manager_utils.js';

test('ensureAPrefix enforces A_ prefix without double-prefixing', () => {
  assert.equal(ensureAPrefix('hero'), 'A_hero');
  assert.equal(ensureAPrefix('A_hero'), 'A_hero');
});

test('sanitizeFileComponent removes unsafe filename characters', () => {
  assert.equal(sanitizeFileComponent('  a/b:c*?  '), 'a_b_c__');
  assert.equal(sanitizeFileComponent('name. '), 'name');
});

test('numberToFilenameToken formats numbers for filenames', () => {
  assert.equal(numberToFilenameToken(2), '2');
  assert.equal(numberToFilenameToken(1.5), '1p5');
  assert.equal(numberToFilenameToken(Number.POSITIVE_INFINITY), '0');
});

test('absPathToResPath maps project-relative paths to res://', () => {
  const projectRoot = path.join('/tmp', 'proj-root');
  const fileAbs = path.join(projectRoot, 'assets', 'a.png');
  assert.equal(absPathToResPath(projectRoot, fileAbs), 'res://assets/a.png');
  assert.equal(absPathToResPath(projectRoot, '/tmp/other.png'), null);
});

test('resolvePathLikeInsideProject resolves res:// and blocks escaping paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aseprite-utils-'));
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project, { recursive: true });

  const safeDir = path.join(project, 'safe');
  fs.mkdirSync(safeDir, { recursive: true });
  fs.writeFileSync(path.join(safeDir, 'file.txt'), 'ok', 'utf8');

  const resolved = resolvePathLikeInsideProject(project, 'res://safe/file.txt');
  assert.equal(resolved.resPath, 'res://safe/file.txt');
  assert.equal(resolved.absPath, path.join(safeDir, 'file.txt'));

  const outsideDir = path.join(tmp, 'outside');
  fs.mkdirSync(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, 'outside.txt');
  fs.writeFileSync(outsideFile, 'no', 'utf8');

  assert.throws(
    () => resolvePathLikeInsideProject(project, 'user://x'),
    /user:\/\//u,
  );
  assert.throws(
    () => resolvePathLikeInsideProject(project, outsideFile),
    /escapes project root/u,
  );
});

test('resolvePathLikeInsideProject blocks symlink escapes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aseprite-utils-symlink-'));
  const project = path.join(tmp, 'project');
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'evil.txt'), 'no', 'utf8');

  fs.symlinkSync(outside, path.join(project, 'link'), 'dir');

  assert.throws(
    () => resolvePathLikeInsideProject(project, 'res://link/evil.txt'),
    /escapes project root/u,
  );
});

test('resolvePathLikeInsideProject allowMissing returns a path for non-existent leafs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aseprite-utils-missing-'));
  const project = path.join(tmp, 'project');
  fs.mkdirSync(project, { recursive: true });

  const out = resolvePathLikeInsideProject(project, 'res://out/new.png', {
    allowMissing: true,
  });
  assert.equal(out.resPath, 'res://out/new.png');
  assert.equal(out.absPath, path.join(project, 'out', 'new.png'));
});
