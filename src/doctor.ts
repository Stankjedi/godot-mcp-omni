import fs from 'node:fs/promises';
import path from 'node:path';

import {
  detectGodotPath,
  GodotPathDetectionError,
  isValidGodotPath,
} from './godot_cli.js';

type DoctorGodotDetails = {
  ok: boolean;
  path: string | null;
  origin: 'cli' | 'env' | 'auto' | 'none';
  strictPathValidation: boolean;
  error?: string;
  attemptedCandidates?: { origin: string; candidate: string; valid: boolean }[];
};

type DoctorProjectDetails = {
  ok: boolean;
  path: string;
  projectGodotPath: string;
  hasProjectGodot: boolean;
  hasBridgeAddon: boolean;
  hasTokenFile: boolean;
  hasPortFile: boolean;
  hasHostFile: boolean;
  error?: string;
};

export type DoctorResult = {
  ok: boolean;
  summary: string;
  details: {
    godot: DoctorGodotDetails;
    project?: DoctorProjectDetails;
  };
  suggestions: string[];
};

export type DoctorOptions = {
  godotPath?: string;
  projectPath?: string;
  strictPathValidation?: boolean;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveGodotDetails(
  options: DoctorOptions,
): Promise<{ details: DoctorGodotDetails; suggestions: string[] }> {
  const suggestions: string[] = [];
  const cache = new Map<string, boolean>();
  const strictPathValidation = options.strictPathValidation === true;

  const fromCli = options.godotPath?.trim();
  if (fromCli) {
    const ok = await isValidGodotPath(fromCli, cache);
    if (ok)
      return {
        details: {
          ok: true,
          path: fromCli,
          origin: 'cli',
          strictPathValidation,
        },
        suggestions,
      };
    suggestions.push(
      `Fix the provided --godot-path (expected '${fromCli} --version' to succeed).`,
    );
    return {
      details: {
        ok: false,
        path: fromCli,
        origin: 'cli',
        strictPathValidation,
        error: `Godot executable is not valid: ${fromCli}`,
      },
      suggestions,
    };
  }

  const fromEnv = process.env.GODOT_PATH?.trim();
  if (fromEnv) {
    const ok = await isValidGodotPath(fromEnv, cache);
    if (ok)
      return {
        details: {
          ok: true,
          path: fromEnv,
          origin: 'env',
          strictPathValidation,
        },
        suggestions,
      };
    suggestions.push(
      `Godot path from GODOT_PATH is invalid: ${fromEnv} (expected '${fromEnv} --version' to succeed)`,
    );
  }

  try {
    const detected = await detectGodotPath({ strictPathValidation });
    const ok = await isValidGodotPath(detected, cache);
    if (!ok) {
      suggestions.push(
        `Auto-detected Godot path is invalid: ${detected} (expected '${detected} --version' to succeed)`,
      );
      suggestions.push(
        'Set GODOT_PATH to a working Godot binary, or pass --godot-path <path>.',
      );
      suggestions.push('Verify it works by running: <godot> --version');
      return {
        details: {
          ok: false,
          path: detected,
          origin: 'auto',
          strictPathValidation,
          error: `Godot executable is not valid: ${detected}`,
        },
        suggestions,
      };
    }

    return {
      details: {
        ok: true,
        path: detected,
        origin: 'auto',
        strictPathValidation,
      },
      suggestions,
    };
  } catch (error) {
    if (error instanceof GodotPathDetectionError) {
      const attemptedCandidates = error.attemptedCandidates.map((a) => ({
        origin: a.origin,
        candidate: a.normalized,
        valid: a.valid,
      }));
      suggestions.push(
        'Set GODOT_PATH to a working Godot binary, or pass --godot-path <path>.',
      );
      suggestions.push('Verify it works by running: <godot> --version');
      return {
        details: {
          ok: false,
          path: null,
          origin: 'none',
          strictPathValidation,
          error: error.message,
          attemptedCandidates,
        },
        suggestions,
      };
    }

    suggestions.push(
      'Set GODOT_PATH to a working Godot binary, or pass --godot-path <path>.',
    );
    suggestions.push('Verify it works by running: <godot> --version');
    const message = error instanceof Error ? error.message : String(error);
    return {
      details: {
        ok: false,
        path: null,
        origin: 'none',
        strictPathValidation,
        error: message,
      },
      suggestions,
    };
  }
}

async function resolveProjectDetails(
  projectPath: string,
): Promise<{ details: DoctorProjectDetails; suggestions: string[] }> {
  const suggestions: string[] = [];
  const absProjectPath = path.resolve(projectPath);

  try {
    const exists = await pathExists(absProjectPath);
    if (!exists) {
      return {
        details: {
          ok: false,
          path: absProjectPath,
          projectGodotPath: path.join(absProjectPath, 'project.godot'),
          hasProjectGodot: false,
          hasBridgeAddon: false,
          hasTokenFile: false,
          hasPortFile: false,
          hasHostFile: false,
          error: `Project path does not exist: ${absProjectPath}`,
        },
        suggestions: [
          `Pass a valid Godot project root containing project.godot (got: ${absProjectPath}).`,
        ],
      };
    }

    const projectGodotPath = path.join(absProjectPath, 'project.godot');
    const hasProjectGodot = await pathExists(projectGodotPath);

    const bridgeAddonPath = path.join(
      absProjectPath,
      'addons',
      'godot_mcp_bridge',
    );
    const hasBridgeAddon = await pathExists(bridgeAddonPath);

    const tokenPath = path.join(absProjectPath, '.godot_mcp_token');
    const hasTokenFile = await pathExists(tokenPath);

    const portPath = path.join(absProjectPath, '.godot_mcp_port');
    const hasPortFile = await pathExists(portPath);

    const hostPath = path.join(absProjectPath, '.godot_mcp_host');
    const hasHostFile = await pathExists(hostPath);

    if (!hasProjectGodot) {
      suggestions.push(
        `Missing project.godot at: ${projectGodotPath} (pass the Godot project root).`,
      );
    }

    if (!hasBridgeAddon) {
      suggestions.push(
        `Missing editor bridge addon at: ${bridgeAddonPath} (non-fatal).`,
      );
      suggestions.push(
        `To install/sync it: npm run sync:addon -- --project ${absProjectPath}`,
      );
    }

    if (!hasTokenFile) {
      suggestions.push(
        `Missing .godot_mcp_token at: ${tokenPath} (non-fatal).`,
      );
      suggestions.push(`Create it with any random string token.`);
    }

    if (!hasPortFile) {
      suggestions.push(`Missing .godot_mcp_port at: ${portPath} (non-fatal).`);
      suggestions.push(`(Optional) Create it with a port number like 8765.`);
    }

    if (!hasHostFile) {
      suggestions.push(`Missing .godot_mcp_host at: ${hostPath} (non-fatal).`);
      suggestions.push(
        `(Optional) Create it with a host value like 127.0.0.1.`,
      );
    }

    return {
      details: {
        ok: hasProjectGodot,
        path: absProjectPath,
        projectGodotPath,
        hasProjectGodot,
        hasBridgeAddon,
        hasTokenFile,
        hasPortFile,
        hasHostFile,
      },
      suggestions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      details: {
        ok: false,
        path: absProjectPath,
        projectGodotPath: path.join(absProjectPath, 'project.godot'),
        hasProjectGodot: false,
        hasBridgeAddon: false,
        hasTokenFile: false,
        hasPortFile: false,
        hasHostFile: false,
        error: message,
      },
      suggestions: [`Failed to check project: ${message}`],
    };
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const suggestions: string[] = [];

  const godot = await resolveGodotDetails(options);
  suggestions.push(...godot.suggestions);

  let projectDetails: DoctorProjectDetails | undefined;
  if (options.projectPath) {
    const project = await resolveProjectDetails(options.projectPath);
    projectDetails = project.details;
    suggestions.push(...project.suggestions);
  }

  const ok = Boolean(godot.details.ok) && (projectDetails?.ok ?? true);
  const summary = ok
    ? 'DOCTOR OK: environment looks good.'
    : 'DOCTOR FAIL: one or more checks failed.';

  return {
    ok,
    summary,
    details: { godot: godot.details, project: projectDetails },
    suggestions: Array.from(new Set(suggestions)).filter(Boolean),
  };
}

export function formatDoctorReport(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push(result.summary);

  const godot = result.details.godot;
  lines.push(`Strict path validation: ${godot.strictPathValidation}`);
  if (godot.ok) {
    lines.push(`Godot: OK (${godot.origin}) -> ${godot.path}`);
  } else {
    lines.push(`Godot: FAIL -> ${godot.error ?? 'not found'}`);
    if (godot.attemptedCandidates && godot.attemptedCandidates.length > 0) {
      const tried = godot.attemptedCandidates
        .slice(0, 6)
        .map((a) => `${a.origin}=${a.candidate}`)
        .join(', ');
      lines.push(
        `Godot tried: ${tried}${godot.attemptedCandidates.length > 6 ? ', …' : ''}`,
      );
    }
  }

  const project = result.details.project;
  if (!project) {
    lines.push('Project: SKIPPED (pass --project <path> to enable checks)');
  } else if (project.ok) {
    lines.push(`Project: OK -> ${project.path}`);
    lines.push(`- project.godot: OK (${project.projectGodotPath})`);
    lines.push(
      `- addons/godot_mcp_bridge: ${project.hasBridgeAddon ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_token: ${project.hasTokenFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_port: ${project.hasPortFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_host: ${project.hasHostFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
  } else {
    lines.push(`Project: FAIL -> ${project.error ?? 'invalid project'}`);
    lines.push(
      `- project.godot: ${project.hasProjectGodot ? 'OK' : 'MISSING'} (${project.projectGodotPath})`,
    );
    lines.push(
      `- addons/godot_mcp_bridge: ${project.hasBridgeAddon ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_token: ${project.hasTokenFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_port: ${project.hasPortFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
    lines.push(
      `- .godot_mcp_host: ${project.hasHostFile ? 'OK' : 'MISSING (non-fatal)'}`,
    );
  }

  if (result.suggestions.length > 0) {
    lines.push('');
    lines.push('Suggestions:');
    for (const s of result.suggestions) lines.push(`- ${s}`);
  }

  return lines.join('\n');
}
