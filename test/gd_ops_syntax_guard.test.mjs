import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('GDScript ops modules do not contain stray ",," tokens', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..');
  const opsDir = path.join(repoRoot, 'src', 'scripts', 'godot_ops');

  const entries = fs.readdirSync(opsDir, { withFileTypes: true });
  const gdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.gd'))
    .map((e) => path.join(opsDir, e.name))
    .sort((a, b) => a.localeCompare(b));

  assert.ok(
    gdFiles.length > 0,
    'No .gd files found under src/scripts/godot_ops/',
  );

  const offenders = [];
  for (const filePath of gdFiles) {
    const text = fs.readFileSync(filePath, 'utf8');
    if (text.includes('),,')) offenders.push(path.relative(repoRoot, filePath));
  }

  assert.deepEqual(
    offenders,
    [],
    `Found invalid GDScript tokens ")," + "," in: ${offenders.join(', ')}`,
  );
});
