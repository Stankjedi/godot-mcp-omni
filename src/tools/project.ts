import path from 'path';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { spawn } from 'child_process';

import { execGodot } from '../godot_cli.js';

import type { ServerContext } from './context.js';
import type { GodotProcess, ToolHandler, ToolResponse } from './types.js';

function findGodotProjects(directory: string, recursive: boolean, logDebug: (message: string) => void): { path: string; name: string }[] {
  const projects: { path: string; name: string }[] = [];
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const subdir = path.join(directory, entry.name);
      const projectFile = path.join(subdir, 'project.godot');
      if (existsSync(projectFile)) {
        projects.push({ path: subdir, name: entry.name });
        continue;
      }

      if (recursive) projects.push(...findGodotProjects(subdir, true, logDebug));
    }
  } catch (error) {
    logDebug(`Error searching directory ${directory}: ${String(error)}`);
  }
  return projects;
}

async function getProjectStructureCounts(projectPath: string, logDebug: (message: string) => void): Promise<Record<string, number>> {
  const structure = { scenes: 0, scripts: 0, assets: 0, other: 0 };

  const scanDirectory = (currentPath: string) => {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        scanDirectory(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = entry.name.split('.').pop()?.toLowerCase();
      if (ext === 'tscn') structure.scenes += 1;
      else if (ext === 'gd' || ext === 'gdscript' || ext === 'cs') structure.scripts += 1;
      else if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'ttf', 'wav', 'mp3', 'ogg'].includes(ext ?? '')) {
        structure.assets += 1;
      } else {
        structure.other += 1;
      }
    }
  };

  try {
    scanDirectory(projectPath);
  } catch (error) {
    logDebug(`Error scanning project structure: ${String(error)}`);
  }

  return structure;
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

export function createProjectToolHandlers(ctx: ServerContext): Record<string, ToolHandler> {
  return {
    launch_editor: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath) {
        return {
          ok: false,
          summary: 'projectPath is required',
          details: { suggestions: ['Provide a Godot project directory'] },
        };
      }

      try {
        ctx.assertValidProject(args.projectPath);
        const godotPath = await ctx.ensureGodotPath(args.godotPath);
        spawn(godotPath, ['-e', '--path', args.projectPath], {
          stdio: 'ignore',
          detached: true,
          windowsHide: true,
        }).unref();
        return { ok: true, summary: 'Godot editor launched', details: { projectPath: args.projectPath } };
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to launch editor: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            suggestions: ['Ensure GODOT_PATH is correct', 'Verify the project contains project.godot'],
          },
        };
      }
    },

    run_project: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath) {
        return {
          ok: false,
          summary: 'projectPath is required',
          details: { suggestions: ['Provide a Godot project directory'] },
        };
      }

      try {
        ctx.assertValidProject(args.projectPath);
        const godotPath = await ctx.ensureGodotPath(args.godotPath);

        const existing = ctx.getActiveProcess();
        if (existing) {
          ctx.logDebug('Killing existing Godot process before starting a new one');
          existing.process.kill();
        }

        const cmdArgs = ['-d', '--path', args.projectPath];
        if (typeof args.scene === 'string' && args.scene.length > 0) {
          ctx.ensureNoTraversal(args.scene);
          cmdArgs.push(args.scene);
        }

        const proc = spawn(godotPath, cmdArgs, { stdio: 'pipe', windowsHide: true });
        const output: string[] = [];
        const errors: string[] = [];

        proc.stdout?.on('data', (data: Buffer) => output.push(...data.toString().split(/\r?\n/u)));
        proc.stderr?.on('data', (data: Buffer) => errors.push(...data.toString().split(/\r?\n/u)));

        proc.on('exit', () => {
          const current = ctx.getActiveProcess();
          if (current && current.process === proc) ctx.setActiveProcess(null);
        });
        proc.on('error', () => {
          const current = ctx.getActiveProcess();
          if (current && current.process === proc) ctx.setActiveProcess(null);
        });

        const state: GodotProcess = { process: proc, output, errors, projectPath: args.projectPath };
        ctx.setActiveProcess(state);
        return { ok: true, summary: 'Godot project started (debug mode)', details: { projectPath: args.projectPath } };
      } catch (error) {
        return {
          ok: false,
          summary: `Failed to run project: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            suggestions: ['Ensure GODOT_PATH is correct', 'Verify the project contains project.godot'],
          },
        };
      }
    },

    get_debug_output: async (): Promise<ToolResponse> => {
      const current = ctx.getActiveProcess();
      if (!current) {
        return { ok: false, summary: 'No active Godot process', details: { suggestions: ['Use run_project first'] } };
      }

      return {
        ok: true,
        summary: 'Collected debug output',
        details: { output: current.output, errors: current.errors },
      };
    },

    stop_project: async (): Promise<ToolResponse> => {
      const current = ctx.getActiveProcess();
      if (!current) {
        return { ok: false, summary: 'No active Godot process to stop', details: { suggestions: ['Use run_project first'] } };
      }

      current.process.kill();
      const output = current.output;
      const errors = current.errors;
      ctx.setActiveProcess(null);
      return { ok: true, summary: 'Godot project stopped', details: { finalOutput: output, finalErrors: errors } };
    },

    get_godot_version: async (): Promise<ToolResponse> => {
      try {
        const godotPath = await ctx.ensureGodotPath();
        const { stdout, stderr, exitCode } = await execGodot(godotPath, ['--version']);
        if (exitCode !== 0) {
          return {
            ok: false,
            summary: 'Failed to get Godot version',
            details: { exitCode },
            logs: splitLines(stderr),
          };
        }
        return { ok: true, summary: 'Godot version', details: { version: stdout.trim() } };
      } catch (error) {
        return { ok: false, summary: `Failed to get Godot version: ${error instanceof Error ? error.message : String(error)}` };
      }
    },

    list_projects: async (args: any): Promise<ToolResponse> => {
      if (!args.directory) return { ok: false, summary: 'directory is required' };

      try {
        ctx.ensureNoTraversal(args.directory);
        if (!existsSync(args.directory)) {
          return { ok: false, summary: `Directory does not exist: ${args.directory}` };
        }
        const recursive = args.recursive === true;
        const projects = findGodotProjects(args.directory, recursive, (m) => ctx.logDebug(m));
        return { ok: true, summary: `Found ${projects.length} project(s)`, details: { projects } };
      } catch (error) {
        return { ok: false, summary: `Failed to list projects: ${error instanceof Error ? error.message : String(error)}` };
      }
    },

    get_project_info: async (args: any): Promise<ToolResponse> => {
      if (!args.projectPath) return { ok: false, summary: 'projectPath is required' };

      try {
        ctx.assertValidProject(args.projectPath);
        const godotPath = await ctx.ensureGodotPath();
        const { stdout: versionStdout } = await execGodot(godotPath, ['--version']);

        const projectFile = path.join(args.projectPath, 'project.godot');
        let projectName = path.basename(args.projectPath);
        try {
          const contents = readFileSync(projectFile, 'utf8');
          const match = contents.match(/config\/name="([^"]+)"/u);
          if (match?.[1]) projectName = match[1];
        } catch {
          // ignore
        }

        const structure = await getProjectStructureCounts(args.projectPath, (m) => ctx.logDebug(m));
        return {
          ok: true,
          summary: 'Project info',
          details: {
            name: projectName,
            path: args.projectPath,
            godotVersion: versionStdout.trim(),
            structure,
          },
        };
      } catch (error) {
        return { ok: false, summary: `Failed to get project info: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}
