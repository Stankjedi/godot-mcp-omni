import fs from 'fs/promises';
import { existsSync } from 'node:fs';

import { resolveInsideProject } from '../../security.js';

import type { MacroOp, PrepareResult } from './types.js';
import { getStringField } from './ops.js';

async function readTextIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf8');
  } catch {
    return null;
  }
}

export async function prepareMacroOps(
  projectPath: string,
  ops: MacroOp[],
  forceRegenerate: boolean,
): Promise<PrepareResult> {
  const skippedScenePaths = new Set<string>();
  const created: string[] = [];
  const skippedExisting: string[] = [];
  const skippedUnchanged: string[] = [];
  const skippedDifferent: string[] = [];

  // Pass 1: decide which create_scene operations can run.
  for (const op of ops) {
    if (op.operation !== 'create_scene') continue;
    const scenePath = getStringField(op.params, ['scenePath', 'scene_path']);
    if (!scenePath) continue;
    const abs = resolveInsideProject(projectPath, scenePath);
    if (existsSync(abs) && !forceRegenerate) {
      skippedScenePaths.add(scenePath);
      skippedExisting.push(scenePath);
    }
  }

  // Pass 2: filter ops by safety rules.
  const out: MacroOp[] = [];
  for (const op of ops) {
    const scenePath = getStringField(op.params, ['scenePath', 'scene_path']);
    if (scenePath && skippedScenePaths.has(scenePath)) {
      // Do not modify existing scenes unless forceRegenerate is enabled.
      continue;
    }

    if (op.operation === 'write_text_file') {
      const p = getStringField(op.params, ['path']);
      const content = getStringField(op.params, ['content']) ?? '';
      if (!p) {
        out.push(op);
        continue;
      }

      const abs = resolveInsideProject(projectPath, p);
      const existing = await readTextIfExists(abs);
      if (existing === null) {
        created.push(p);
        out.push(op);
        continue;
      }

      if (existing === content) {
        skippedUnchanged.push(p);
        continue;
      }

      if (!forceRegenerate) {
        skippedDifferent.push(p);
        continue;
      }

      created.push(p);
      out.push(op);
      continue;
    }

    if (op.operation === 'create_scene') {
      const p = scenePath;
      if (!p) {
        out.push(op);
        continue;
      }
      const abs = resolveInsideProject(projectPath, p);
      if (existsSync(abs) && !forceRegenerate) {
        skippedExisting.push(p);
        continue;
      }
      created.push(p);
      out.push(op);
      continue;
    }

    out.push(op);
  }

  return {
    plannedOps: ops.length,
    ops: out,
    created,
    skippedExisting,
    skippedUnchanged,
    skippedDifferent,
  };
}
