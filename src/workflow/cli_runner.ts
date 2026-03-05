import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import {
  buildSpawnEnv,
  drainChildStderr,
  formatError,
  resolveServerEntryPath,
  shutdownChildProcess,
  waitForServerReady,
} from '../cli/runner_utils.js';
import { JsonRpcProcessClient } from '../utils/jsonrpc_process_client.js';
import { isRecord } from '../utils/object_shape.js';
import { deepSubstitute, validateWorkflowJson } from './workflow_validation.js';

type RunWorkflowCliOptions = {
  workflowPath: string;
  projectPath?: string;
  godotPath?: string;
  ciSafe: boolean;
  jsonStdout?: boolean;
};

export async function runWorkflowCli(
  options: RunWorkflowCliOptions,
): Promise<{ ok: boolean; failures: number }> {
  const jsonStdout = options.jsonStdout === true;
  const workflowPath = path.resolve(process.cwd(), options.workflowPath);
  const serverEntry = resolveServerEntryPath(import.meta.url);

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
    env: buildSpawnEnv({ ciSafe: options.ciSafe, effectiveGodotPath }),
  });

  drainChildStderr(child);

  let failures = 0;
  const client = new JsonRpcProcessClient(child);

  try {
    await waitForServerReady(client);

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

          if (!jsonStdout) console.log(`${label}: ok`);
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

        if (!jsonStdout) {
          console.log(`${label}: ok (${resp.summary ?? 'no summary'})`);
        }
      } catch (error) {
        failures += 1;
        if (!jsonStdout) {
          console.error(`${label}: FAIL - ${formatError(error)}`);
        }
      }
    }
  } finally {
    client.dispose();
    await shutdownChildProcess(child);
  }

  if (jsonStdout) {
    console.log(
      JSON.stringify({
        ok: failures === 0,
        failures,
        stepsTotal: workflow.steps.length,
        workflowPath,
        projectPath: resolvedProjectPath ?? null,
      }),
    );
  } else {
    console.log('');
    console.log('DONE');
    console.log(`Workflow: ${workflowPath}`);
    if (resolvedProjectPath) console.log(`Project: ${resolvedProjectPath}`);
  }

  return { ok: failures === 0, failures };
}
