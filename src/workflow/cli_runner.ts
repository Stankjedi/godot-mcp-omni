import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JsonRpcProcessClient } from '../utils/jsonrpc_process_client.js';
import { isRecord } from '../utils/object_shape.js';
import { deepSubstitute, validateWorkflowJson } from './workflow_validation.js';

type RunWorkflowCliOptions = {
  workflowPath: string;
  projectPath?: string;
  godotPath?: string;
  ciSafe: boolean;
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveServerEntryPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', 'index.js');
}

async function shutdownChildProcess(
  child: ReturnType<typeof spawn>,
): Promise<void> {
  if (child.exitCode !== null) return;

  try {
    child.stdin?.end();
  } catch {
    // Ignore.
  }

  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  child.kill();
  await Promise.race([exitPromise, sleep(2000)]);

  if (child.exitCode !== null) return;
  if (process.platform !== 'win32') {
    child.kill('SIGKILL');
    await Promise.race([exitPromise, sleep(2000)]);
  }
}

export async function runWorkflowCli(
  options: RunWorkflowCliOptions,
): Promise<{ ok: boolean; failures: number }> {
  const workflowPath = path.resolve(process.cwd(), options.workflowPath);
  const serverEntry = resolveServerEntryPath();

  let raw: string;
  try {
    raw = await fs.readFile(workflowPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read workflow file: ${workflowPath} (${formatError(error)})`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse workflow JSON: ${workflowPath} (${formatError(error)})`,
    );
  }

  const workflow = validateWorkflowJson(parsedJson, {
    workflowPathForErrors: workflowPath,
    allowWorkflowManagerTool: true,
  });

  const projectPathInput =
    typeof options.projectPath === 'string' && options.projectPath.trim()
      ? options.projectPath.trim()
      : typeof workflow.projectPath === 'string' && workflow.projectPath.trim()
        ? workflow.projectPath.trim()
        : null;

  const resolvedProjectPath =
    typeof projectPathInput === 'string' && projectPathInput.length > 0
      ? path.resolve(process.cwd(), projectPathInput)
      : null;

  const substitutions = { $PROJECT_PATH: resolvedProjectPath ?? '' };

  const effectiveGodotPath = options.ciSafe
    ? ''
    : (options.godotPath ?? process.env.GODOT_PATH ?? '').trim();

  const child = spawn(process.execPath, [serverEntry], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      ...(options.ciSafe
        ? { GODOT_PATH: '' }
        : { GODOT_PATH: effectiveGodotPath }),
      ALLOW_DANGEROUS_OPS: 'false',
    },
  });

  let failures = 0;
  const client = new JsonRpcProcessClient(child);

  try {
    await sleep(250);

    for (let index = 0; index < workflow.steps.length; index += 1) {
      const step = workflow.steps[index];
      const label = `[${index + 1}/${workflow.steps.length} ${step.id}] ${step.title}`;

      try {
        if (step.tool === 'tools/list') {
          if (step.expectOk !== true) {
            throw new Error('tools/list does not support expectOk=false');
          }

          const resp = await client.send('tools/list', {});
          if ('error' in resp) {
            throw new Error(`tools/list error: ${JSON.stringify(resp.error)}`);
          }

          console.log(`${label}: ok`);
          continue;
        }

        const substitutedArgs = deepSubstitute(step.args, substitutions);
        if (!isRecord(substitutedArgs)) {
          throw new Error(
            'Invalid step args after substitution: expected an object',
          );
        }

        const resp = await client.callTool(step.tool, substitutedArgs);
        if (resp.ok !== step.expectOk) {
          throw new Error(
            `Expected ok=${step.expectOk}, got ok=${resp.ok} (${resp.summary ?? 'no summary'})`,
          );
        }

        console.log(`${label}: ok (${resp.summary ?? 'no summary'})`);
      } catch (error) {
        failures += 1;
        console.error(`${label}: FAIL - ${formatError(error)}`);
      }
    }
  } finally {
    client.dispose();
    await shutdownChildProcess(child);
  }

  console.log('');
  console.log('DONE');
  console.log(`Workflow: ${workflowPath}`);
  if (resolvedProjectPath) console.log(`Project: ${resolvedProjectPath}`);

  return { ok: failures === 0, failures };
}
