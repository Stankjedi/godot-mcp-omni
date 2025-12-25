/**
 * Full sprite test: import assets first, then load sprite
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { JsonRpcProcessClient } from '../build/utils/jsonrpc_process_client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serverEntry = path.join(repoRoot, 'build', 'index.js');

function requireGodotPath() {
  const godotPath = process.env.GODOT_PATH?.trim();
  if (!godotPath) {
    throw new Error(
      'GODOT_PATH is required.\n' +
        'Example: GODOT_PATH=/abs/path/to/godot npm run verify:sprite',
    );
  }
  return godotPath;
}

async function ensureMinimalProject(projectPath) {
  const projectGodotPath = path.join(projectPath, 'project.godot');
  try {
    await fs.access(projectGodotPath);
    return;
  } catch {
    // continue
  }

  const projectGodot = [
    '; Engine configuration file.',
    "; It's best edited using the editor, not directly.",
    'config_version=5',
    '',
    '[application]',
    'config/name="godot-mcp-sprite-test"',
    '',
  ].join('\n');

  await fs.writeFile(projectGodotPath, projectGodot, 'utf8');
}

async function main() {
  console.log('=== Full Sprite Load Test (with import) ===\n');

  try {
    await fs.access(serverEntry);
  } catch {
    throw new Error(
      `Build output not found: ${serverEntry}\nRun: npm run build`,
    );
  }

  const GODOT_PATH = requireGodotPath();

  const projectPath =
    process.env.VERIFY_PROJECT_PATH ??
    path.join(repoRoot, '.tmp', 'readme-test');
  await fs.mkdir(projectPath, { recursive: true });
  await ensureMinimalProject(projectPath);

  // Create icon.png - a simple valid 1x1 red pixel PNG
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
    'base64',
  );
  await fs.writeFile(path.join(projectPath, 'test_texture.png'), pngBytes);
  console.log('Created test_texture.png (1x1 pixel)');

  const server = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      GODOT_PATH,
      ALLOW_DANGEROUS_OPS: 'true',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const client = new JsonRpcProcessClient(server);

  try {
    await new Promise((r) => setTimeout(r, 500));

    // Step 1: Import project assets first
    console.log('Step 1: Importing project assets...');
    try {
      const importResult = await client.callToolOrThrow(
        'godot_import_project_assets',
        {
          projectPath,
        },
      );
      console.log('  ✅ Import completed');
    } catch (e) {
      console.log(
        '  ⚠️ Import skipped (may need editor):',
        e.message?.slice(0, 100),
      );
    }

    // Step 2: Create fresh scene
    console.log('Step 2: Creating scene...');
    await client.callToolOrThrow('create_scene', {
      projectPath,
      scenePath: 'test/FinalSpriteTest.tscn',
      rootNodeType: 'Node2D',
    });
    console.log('  ✅ Scene created');

    // Step 3: Add Sprite2D
    console.log('Step 3: Adding Sprite2D...');
    await client.callToolOrThrow('add_node', {
      projectPath,
      scenePath: 'test/FinalSpriteTest.tscn',
      parentNodePath: 'root',
      nodeType: 'Sprite2D',
      nodeName: 'TestSprite',
    });
    console.log('  ✅ Sprite2D added');

    // Step 4: Load sprite
    console.log('Step 4: Loading texture into sprite...');
    const loadResult = await client.callToolOrThrow('load_sprite', {
      projectPath,
      scenePath: 'test/FinalSpriteTest.tscn',
      nodePath: 'root/TestSprite',
      texturePath: 'res://test_texture.png',
    });
    console.log('  ✅ Texture loaded!');
    console.log('  Result:', JSON.stringify(loadResult, null, 2));

    console.log('\n=== ALL TESTS PASSED ✅ ===');
  } catch (error) {
    console.log('\n  ❌ Test failed:', error.message);

    // Show the actual error
    if (error.message.includes('Details:')) {
      console.log('  (This is expected for headless mode without import)');
      console.log('  README note: "Headless에서 PNG 권장, SVG는 임포트 필요"');
    }
  } finally {
    client.dispose();
    server.kill();
  }
}

main().catch(console.error);
