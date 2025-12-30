import type {
  PixelManifest,
  PixelManifestStep,
  PixelProjectProfile,
} from '../../pipeline/pixel_types.js';
import {
  readPixelManifest,
  writePixelManifest,
} from '../../pipeline/pixel_manifest.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export async function appendManifest(
  projectPath: string,
  patch: {
    profile?: PixelProjectProfile;
    seed?: number;
    step?: PixelManifestStep;
    outputs?: Record<string, unknown>;
  },
): Promise<void> {
  const existing = await readPixelManifest(projectPath);
  const manifest: PixelManifest =
    existing ??
    ({
      schemaVersion: 1,
      generatedAt: nowIso(),
      projectPath,
      steps: [],
      outputs: {},
    } satisfies PixelManifest);

  manifest.generatedAt = nowIso();
  if (patch.profile) manifest.profile = patch.profile;
  if (patch.seed !== undefined) manifest.seed = patch.seed;
  if (patch.step) manifest.steps.push(patch.step);
  if (patch.outputs) {
    manifest.outputs = { ...(manifest.outputs ?? {}), ...patch.outputs };
  }

  await writePixelManifest(projectPath, manifest);
}
