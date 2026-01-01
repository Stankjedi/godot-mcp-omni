import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JsonRpcProcessClient } from '../utils/jsonrpc_process_client.js';
import { deepSubstitute, isRecord } from '../utils/object_shape.js';
import { DEFAULT_CI_SAFE_SCENARIOS } from './default_scenarios.js';

type RunScenariosCliOptions = {
  ciSafe: boolean;
  godotPath?: string;
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

async function writeMinimalProject(projectPath: string): Promise<void> {
  await fs.mkdir(path.join(projectPath, 'scenes'), { recursive: true });

  const lines: string[] = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-omni-ci-safe-scenarios"',
    '',
  ];

  await fs.writeFile(
    path.join(projectPath, 'project.godot'),
    lines.join('\n'),
    'utf8',
  );
}

export async function runScenariosCli(
  options: RunScenariosCliOptions,
): Promise<{ ok: boolean; failures: number }> {
  const serverEntry = resolveServerEntryPath();
  const scenarios = DEFAULT_CI_SAFE_SCENARIOS;

  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'godot-mcp-omni-cli-scenarios-'),
  );
  const projectPath = path.join(tmpRoot, 'project');
  await writeMinimalProject(projectPath);

  const substitutions = { $PROJECT_PATH: projectPath };
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

    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const label = `[${index + 1}/${scenarios.length} ${scenario.id}] ${scenario.title}`;

      try {
        if (scenario.tool === 'tools/list') {
          if (scenario.expectOk !== true) {
            throw new Error('tools/list does not support expectOk=false');
          }
          const resp = await client.send('tools/list', {});
          if ('error' in resp) {
            throw new Error(`tools/list error: ${JSON.stringify(resp.error)}`);
          }
          console.log(`${label}: ok`);
          continue;
        }

        const substitutedArgs = deepSubstitute(scenario.args, substitutions);
        if (!isRecord(substitutedArgs)) {
          throw new Error(
            'Invalid scenario args after substitution: expected an object',
          );
        }

        const resp = await client.callTool(scenario.tool, substitutedArgs);
        if (resp.ok !== scenario.expectOk) {
          throw new Error(
            `Expected ok=${scenario.expectOk}, got ok=${resp.ok} (${resp.summary ?? 'no summary'})`,
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
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  console.log('');
  if (failures === 0) {
    console.log('SCENARIOS: OK');
  } else {
    console.log(`SCENARIOS: FAIL (${failures} failures)`);
  }

  return { ok: failures === 0, failures };
}
