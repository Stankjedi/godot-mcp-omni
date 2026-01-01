import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAsepriteManagerToolHandlers } from '../../build/tools/aseprite_manager.js';

function createTempProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aseprite-contract-'));
  const projectPath = path.join(tmp, 'project');
  fs.mkdirSync(projectPath, { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'project.godot'), '; test', 'utf8');
  return { tmp, projectPath };
}

function createTestCtx() {
  return {
    assertValidProject(projectPath) {
      const root = path.resolve(projectPath);
      const marker = path.join(root, 'project.godot');
      assert.ok(
        fs.existsSync(marker),
        `Expected a valid Godot project at ${projectPath}`,
      );
    },
  };
}

function createStubDeps(callLog) {
  return {
    getAsepriteStatus() {
      return {
        externalToolsEnabled: true,
        asepritePathEnv: null,
        resolvedExecutable: 'aseprite',
        attemptedCandidates: ['aseprite'],
      };
    },
    async runAseprite(args, opts = {}) {
      callLog.push({ args, opts });
      return {
        ok: true,
        summary: 'stub',
        command: 'aseprite',
        args,
        exitCode: 0,
        durationMs: 0,
        stdout: '',
        stderr: '',
        capabilities: {},
        suggestions: [],
      };
    },
  };
}

function getHandler(projectPath, deps) {
  const ctx = createTestCtx();
  const baseHandlers = {};
  return createAsepriteManagerToolHandlers(ctx, baseHandlers, deps)
    .aseprite_manager;
}

test('aseprite_manager rejects user:// paths', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { projectPath } = createTempProject();
  const handler = getHandler(projectPath, deps);

  await assert.rejects(
    () =>
      handler({
        action: 'export_sheet',
        projectPath,
        inputFile: 'user://sprite.aseprite',
        sheet: { sheetType: 'packed' },
      }),
    /user:\/\//u,
  );
  assert.equal(calls.length, 0);
});

test('aseprite_manager rejects paths escaping the project root', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { tmp, projectPath } = createTempProject();

  const outsideDir = path.join(tmp, 'outside');
  fs.mkdirSync(outsideDir, { recursive: true });
  const outsideFile = path.join(outsideDir, 'outside.aseprite');
  fs.writeFileSync(outsideFile, 'x', 'utf8');

  const handler = getHandler(projectPath, deps);
  await assert.rejects(
    () =>
      handler({
        action: 'export_sheet',
        projectPath,
        inputFile: outsideFile,
        sheet: { sheetType: 'packed' },
      }),
    /escapes project root/u,
  );
  assert.equal(calls.length, 0);
});

test('aseprite_manager rejects symlink escape paths', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { tmp, projectPath } = createTempProject();
  const handler = getHandler(projectPath, deps);

  const outsideDir = path.join(tmp, 'outside');
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'evil.aseprite'), 'x', 'utf8');

  const linkPath = path.join(projectPath, 'link');
  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(outsideDir, linkPath, symlinkType);

  await assert.rejects(
    () =>
      handler({
        action: 'export_sheet',
        projectPath,
        inputFile: 'res://link/evil.aseprite',
        sheet: { sheetType: 'packed' },
      }),
    /escapes project root/u,
  );
  assert.equal(calls.length, 0);
});

test('aseprite_manager rejects output.baseName containing path separators', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { projectPath } = createTempProject();

  const inputAbs = path.join(projectPath, 'art', 'sprite.aseprite');
  fs.mkdirSync(path.dirname(inputAbs), { recursive: true });
  fs.writeFileSync(inputAbs, 'x', 'utf8');

  const handler = getHandler(projectPath, deps);

  await assert.rejects(
    () =>
      handler({
        action: 'export_sheet',
        projectPath,
        inputFile: 'res://art/sprite.aseprite',
        sheet: { sheetType: 'packed' },
        output: { baseName: 'bad/name' },
      }),
    /path separators/u,
  );
  await assert.rejects(
    () =>
      handler({
        action: 'export_sheet',
        projectPath,
        inputFile: 'res://art/sprite.aseprite',
        sheet: { sheetType: 'packed' },
        output: { baseName: 'bad\\\\name' },
      }),
    /path separators/u,
  );

  assert.equal(calls.length, 0);
});

test('aseprite_manager preview mode does not create missing output directories', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { projectPath } = createTempProject();

  const inputAbs = path.join(projectPath, 'art', 'sprite.aseprite');
  fs.mkdirSync(path.dirname(inputAbs), { recursive: true });
  fs.writeFileSync(inputAbs, 'x', 'utf8');

  const missingOutputDirAbs = path.join(projectPath, 'out', 'missing');
  assert.equal(fs.existsSync(missingOutputDirAbs), false);

  const handler = getHandler(projectPath, deps);
  await assert.rejects(
    () =>
      handler({
        action: 'export_sheet',
        projectPath,
        inputFile: 'res://art/sprite.aseprite',
        sheet: { sheetType: 'packed' },
        options: { preview: true },
        output: { outputDir: 'res://out/missing', baseName: 'preview' },
      }),
    /preview mode/u,
  );

  assert.equal(fs.existsSync(missingOutputDirAbs), false);
  assert.equal(calls.length, 0);
});

test('aseprite_manager preview mode does not write output files', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { projectPath } = createTempProject();

  const inputAbs = path.join(projectPath, 'art', 'sprite.aseprite');
  fs.mkdirSync(path.dirname(inputAbs), { recursive: true });
  fs.writeFileSync(inputAbs, 'x', 'utf8');

  const outputDirAbs = path.join(projectPath, 'art', 'export');
  fs.mkdirSync(outputDirAbs, { recursive: true });

  const handler = getHandler(projectPath, deps);
  const resp = await handler({
    action: 'export_sheet',
    projectPath,
    inputFile: 'res://art/sprite.aseprite',
    sheet: { sheetType: 'packed' },
    options: { preview: true },
    output: { outputDir: 'res://art/export', baseName: 'preview' },
  });

  assert.equal(resp.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--preview'));

  assert.equal(
    fs.existsSync(path.join(outputDirAbs, 'A_preview.png')),
    false,
    'preview should not write output images',
  );
  assert.equal(
    fs.existsSync(path.join(outputDirAbs, 'A_preview.json')),
    false,
    'preview should not write output data files',
  );
});

test('aseprite_manager collects output files by prefix (non-preview)', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { projectPath } = createTempProject();

  const inputAbs = path.join(projectPath, 'art', 'sprite.aseprite');
  fs.mkdirSync(path.dirname(inputAbs), { recursive: true });
  fs.writeFileSync(inputAbs, 'x', 'utf8');

  const outputDirAbs = path.join(projectPath, 'out');
  fs.mkdirSync(outputDirAbs, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirAbs, 'A_collect__frame_0.png'),
    'x',
    'utf8',
  );
  fs.writeFileSync(
    path.join(outputDirAbs, 'A_collect__frame_1.png'),
    'x',
    'utf8',
  );

  const handler = getHandler(projectPath, deps);
  const resp = await handler({
    action: 'export_sprite',
    projectPath,
    inputFile: 'res://art/sprite.aseprite',
    export: { mode: 'frames', format: 'png' },
    output: { outputDir: 'res://out', baseName: 'collect', overwrite: true },
  });

  assert.equal(resp.ok, true);
  assert.equal(calls.length, 1);

  const files = (resp.files ?? [])
    .filter((f) => typeof f.resPath === 'string')
    .sort((a, b) => String(a.resPath).localeCompare(String(b.resPath)));

  assert.deepEqual(
    files.map((f) => f.resPath),
    ['res://out/A_collect__frame_0.png', 'res://out/A_collect__frame_1.png'],
  );
  assert.ok(files.every((f) => f.kind === 'frame_image'));
  assert.ok(files.every((f) => f.bytes === 1));
});

test('aseprite_manager overwrite=false prechecks collisions before running', async () => {
  const calls = [];
  const deps = createStubDeps(calls);
  const { projectPath } = createTempProject();

  const inputAbs = path.join(projectPath, 'art', 'sprite.aseprite');
  fs.mkdirSync(path.dirname(inputAbs), { recursive: true });
  fs.writeFileSync(inputAbs, 'x', 'utf8');

  const outputDirAbs = path.join(projectPath, 'art', 'export');
  fs.mkdirSync(outputDirAbs, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirAbs, 'A_collision__frame_0.png'),
    'x',
    'utf8',
  );

  const handler = getHandler(projectPath, deps);
  const resp = await handler({
    action: 'export_sprite',
    projectPath,
    inputFile: 'res://art/sprite.aseprite',
    export: { mode: 'frames', format: 'png' },
    output: { outputDir: 'res://art/export', baseName: 'collision' },
  });

  assert.equal(resp.ok, false);
  assert.equal(calls.length, 0);
  assert.ok(resp.errors?.some((e) => e.code === 'E_OUTPUT_EXISTS'));
});
