import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GODOT_MCP_OMNI_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS_DIR = path.join(GODOT_MCP_OMNI_ROOT, 'scripts');

function isWorkflowJsonFilename(name) {
  return name.startsWith('workflow_') && name.endsWith('.json');
}

test('workflow examples reference existing projectPath directories', () => {
  const workflowFiles = fs
    .readdirSync(SCRIPTS_DIR)
    .filter(isWorkflowJsonFilename)
    .sort((a, b) => a.localeCompare(b));

  assert.ok(
    workflowFiles.length > 0,
    'Expected at least one workflow_*.json file under scripts/',
  );

  for (const filename of workflowFiles) {
    const absPath = path.join(SCRIPTS_DIR, filename);
    const parsed = JSON.parse(fs.readFileSync(absPath, 'utf8'));
    const projectPath =
      parsed && typeof parsed.projectPath === 'string'
        ? parsed.projectPath.trim()
        : '';

    if (!projectPath) continue;

    const resolved = path.resolve(GODOT_MCP_OMNI_ROOT, projectPath);
    assert.ok(
      fs.existsSync(resolved) && fs.statSync(resolved).isDirectory(),
      `Workflow "${filename}" references missing projectPath directory: ${projectPath} -> ${resolved}`,
    );
  }
});
