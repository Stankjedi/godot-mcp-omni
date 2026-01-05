#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';

import {
  createStepRunner,
  resolveGodotPath,
  spawnMcpServer,
  wait,
} from './mcp_test_harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
  return [
    'Create a tiny idle/clicker Godot project using MCP headless tools.',
    '',
    'Usage:',
    '  node scripts/demo_idle_game_mcp.js [--project <path>] [--godot-path <path>] [--skip-run]',
    '',
    'Defaults:',
    '  --project: ../game (relative to godot-mcp-omni)',
    '',
    'Notes:',
    '  - This script intentionally runs with ALLOW_DANGEROUS_OPS=false.',
    '  - It creates/overwrites Main.tscn + Main.gd for repeatability.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { projectPath: null, godotPath: null, skipRun: false };
  const rest = [...argv];

  while (rest.length > 0) {
    const token = rest.shift();
    if (!token) break;

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--project') {
      args.projectPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--godot-path') {
      args.godotPath = rest.shift() ?? null;
      continue;
    }
    if (token === '--skip-run') {
      args.skipRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}\n\n${usage()}`);
  }

  return args;
}

const PROJECT_GODOT = [
  '; Engine configuration file.',
  "; It's best edited using the editor UI and not directly.",
  'config_version=5',
  '',
  '[application]',
  'config/name="Idle Clicker (MCP Demo)"',
  'run/main_scene="res://Main.tscn"',
  '',
].join('\n');

const ICON_PNG_16X16_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHUlEQVR4nGP8z8Dwn4ECwESJ5lEDRg0YNWAwGQAAWG0CHvXMz6IAAAAASUVORK5CYII=';

// Twemoji "money bag" (U+1F4B0), CC-BY 4.0
// Source: https://github.com/twitter/twemoji (assets/72x72/1f4b0.png)
const COIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAaVBMVEVHcEz92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ij92Ii/aVL92IhndX96gYCNjoH00oeyp4Rwe4DhxYbqzIefmoLYv4bOuYWpoIPFs4WDiIGWlIK/aVK7rYQ/6loZAAAAEXRSTlMAgGBQ348QzyDvMECfv3CvgLj/t0oAAAI5SURBVHjaxZjbdoMgEEXVeI0x6YD3a9L//8jWYhYWkCOrD91PvriXHJhhlt4B94woWh+ChL5JLutzRJTdPSfutPLIrw/aeOS5eA6cRCEdErp4YrLwDyK0NBd8OsR3EsXh4QfFnhPXjIxkV08Hm7AH8/Ey8uEseh3wDyK0NGfSzJB16rmTkIHE3RORkcjVc6EDLn8PCMeEA8Ix4YBwTDggEJNrQFXJGG9hTDignn3DYUw4IPZDC2ICAUnR4BxTmmGRHhM+QWMvRMs0usV0oz0zZ5KmrkhyA3e+svG/aUaS3K0d/5dnYRp7k+0eKNQDtFLWdf92NiQpjj0B7ejEq1sw3aalHcG5G79mK5/0ZuDqCQ/RBwlKtTSqupw6OvNJoS4qSQV/UhqRLmItaih4kJnENukm66mME1LpmKDvLKb4TI+u2cZzBGtDA9oka6NvT60tJTPjrmaX2bJv8NKo6kaquEmVgoSkat9JygqERFaGXmbVWmfcmABVzd9JkcJDEUHeYak5FcrSMO3CTMWXaWFjk9qQBEmsbD+mNIooAQey68vZIFpIw7eXCF/farUifoJDqackO/bmEWHPYGC6mkSiXMfVNUxi+zma4XxjE9EZyIT9AExMZyYkMtYYVzR8ICwyMj4b0JCQSDJ8btvXgYEZiPRBC2x/8hdReq7aGnRR+qD9a+MxTkg/kZaB3dJGYEpdB9aFLm3MLXX7H+L6eyMnR3IwsgHQwIZN2CPJw9P55J6doKATFIGa8xe4+dzA9QkE6gAAAABJRU5ErkJggg==';

const ASSET_ATTRIBUTION_MD = `# Asset Attribution

## Twemoji

- **Asset:** \`assets/twemoji/coin.png\` (from \`1f4b0.png\`)
- **Source:** https://github.com/twitter/twemoji
- **License:** CC BY 4.0
- **Copyright:** Twitter, Inc. and other contributors
- **Retrieved:** 2025-12-31
`;

const MAIN_GD = `extends Control

@onready var stats_label: Label = $VBox/StatsLabel
@onready var message_label: Label = $VBox/MessageLabel
@onready var click_button: Button = $VBox/ClickButton
@onready var buy_button: Button = $VBox/BuyButton
@onready var upgrade_click_button: Button = $VBox/UpgradeClickButton
@onready var save_button: Button = $VBox/SaveButton
@onready var reset_button: Button = $VBox/ResetButton
@onready var tick_timer: Timer = $TickTimer

const SAVE_PATH = "user://idle_save.json"
const SNAPSHOT_FLAG_PATH = "user://snapshot.flag"
const SNAPSHOT_QUIT_FLAG_PATH = "user://snapshot_quit.flag"
const SNAPSHOT_DIR_PATH = "user://snapshots"
const SNAPSHOT_FILE_PATH = "user://snapshots/idle_snapshot.png"
const MAX_OFFLINE_SECONDS: int = 60 * 60 * 24

var coins: float = 0.0
var auto_clickers: int = 0
var click_value: float = 1.0
var uptime_seconds: int = 0

var message_ttl_seconds: float = 0.0

func _ready() -> void:
\t_write_user_data_probe()
\tload_game()
\t_apply_icons_best_effort()
\t_update_message("")
\tupdate_ui()

\ttick_timer.wait_time = 1.0
\ttick_timer.one_shot = false
\ttick_timer.autostart = true
\tif tick_timer.is_stopped():
\t\ttick_timer.start()

\tcall_deferred("_maybe_snapshot")

func _process(delta: float) -> void:
\tif message_ttl_seconds <= 0.0:
\t\treturn
\tmessage_ttl_seconds -= delta
\tif message_ttl_seconds <= 0.0:
\t\t_update_message("")

func _write_user_data_probe() -> void:
\tvar probe_path_abs: String = OS.get_user_data_dir().path_join("mcp_user_data_probe.txt")
\tvar file = FileAccess.open(probe_path_abs, FileAccess.WRITE)
\tif file == null:
\t\treturn
\tfile.store_string("os_user_data_dir=" + OS.get_user_data_dir() + "\\n")
\tfile.store_string("globalize_user__=" + ProjectSettings.globalize_path("user://") + "\\n")
\tfile.close()

func get_auto_income_per_second() -> float:
\treturn float(auto_clickers)

func get_buy_cost() -> float:
\treturn 10.0 * pow(1.15, float(auto_clickers))

func get_upgrade_click_cost() -> float:
\tvar level: float = max(0.0, click_value - 1.0)
\treturn 25.0 * pow(1.25, level)

func _on_tick_timeout() -> void:
\tuptime_seconds += 1
\tcoins += get_auto_income_per_second()
\tupdate_ui()
\t# Light autosave so the demo feels "idle".
\tif uptime_seconds % 5 == 0:
\t\tsave_game()

func _on_click_pressed() -> void:
\tcoins += click_value
\tupdate_ui()

func _on_buy_pressed() -> void:
\tvar cost: float = get_buy_cost()
\tif coins < cost:
\t\t_toast("Not enough coins.")
\t\treturn
\tcoins -= cost
\tauto_clickers += 1
\t_toast("+1 auto income per sec.")
\tupdate_ui()

func _on_upgrade_click_pressed() -> void:
\tvar cost: float = get_upgrade_click_cost()
\tif coins < cost:
\t\t_toast("Not enough coins.")
\t\treturn
\tcoins -= cost
\tclick_value += 1.0
\t_toast("Click power upgraded.")
\tupdate_ui()

func _on_save_pressed() -> void:
\tsave_game()
\t_toast("Saved.")

func _on_reset_pressed() -> void:
\tcoins = 0.0
\tauto_clickers = 0
\tclick_value = 1.0
\tuptime_seconds = 0
\tsave_game()
\t_toast("Reset done.")
\tupdate_ui()

func update_ui() -> void:
\tvar income: float = get_auto_income_per_second()
\tvar auto_cost: float = get_buy_cost()
\tvar upgrade_cost: float = get_upgrade_click_cost()

\tstats_label.text = "Coins: %s\\nAuto: %d (+%s/sec)\\nClick: +%s\\nNext Auto Cost: %s\\nNext Click Upgrade: %s\\nUptime: %ss" % [
\t\tformat_number(coins),
\t\tauto_clickers,
\t\tformat_number(income),
\t\tformat_number(click_value),
\t\tformat_number(auto_cost),
\t\tformat_number(upgrade_cost),
\t\tstr(uptime_seconds),
\t]

\tclick_button.text = "Click (+%s)" % [format_number(click_value)]
\tbuy_button.text = "Buy Auto (+1/sec) - Cost %s" % [format_number(auto_cost)]
\tupgrade_click_button.text = "Upgrade Click (+1) - Cost %s" % [format_number(upgrade_cost)]

\tbuy_button.disabled = coins < auto_cost
\tupgrade_click_button.disabled = coins < upgrade_cost

func format_number(v: float) -> String:
\tif v >= 1000000.0:
\t\treturn "%.2fM" % [v / 1000000.0]
\tif v >= 1000.0:
\t\treturn "%.2fK" % [v / 1000.0]
\tif abs(v - round(v)) < 0.0001:
\t\treturn "%d" % [int(round(v))]
\treturn "%.2f" % [v]

func save_game() -> void:
\tvar data = {
\t\t"coins": coins,
\t\t"auto_clickers": auto_clickers,
\t\t"click_value": click_value,
\t\t"uptime_seconds": uptime_seconds,
\t\t"last_save_unix": int(Time.get_unix_time_from_system()),
\t}
\tvar file = FileAccess.open(SAVE_PATH, FileAccess.WRITE)
\tif file == null:
\t\treturn
\tfile.store_string(JSON.stringify(data))
\tfile.close()

func load_game() -> void:
\tif not FileAccess.file_exists(SAVE_PATH):
\t\tsave_game()
\t\treturn
\tvar file = FileAccess.open(SAVE_PATH, FileAccess.READ)
\tif file == null:
\t\treturn
\tvar text := file.get_as_text()
\tfile.close()

\tvar parsed = JSON.parse_string(text)
\tif typeof(parsed) != TYPE_DICTIONARY:
\t\treturn

\tvar now_unix: int = int(Time.get_unix_time_from_system())
\tvar last_save_unix: int = int(parsed.get("last_save_unix", now_unix))
\tvar elapsed: int = min(MAX_OFFLINE_SECONDS, max(0, now_unix - last_save_unix))

\tcoins = float(parsed.get("coins", 0.0))
\tauto_clickers = int(parsed.get("auto_clickers", 0))
\tclick_value = float(parsed.get("click_value", 1.0))
\tuptime_seconds = int(parsed.get("uptime_seconds", 0))

\tif auto_clickers > 0 && elapsed > 0:
\t\tvar earned: float = get_auto_income_per_second() * float(elapsed)
\t\tcoins += earned
\t\t_toast("Offline: +%s coins (%ss)" % [format_number(earned), str(elapsed)])

func _toast(text: String, seconds: float = 2.0) -> void:
\t_update_message(text, seconds)

func _update_message(text: String, seconds: float = 0.0) -> void:
\tif text == "":
\t\tmessage_label.text = ""
\t\tmessage_label.visible = false
\t\tmessage_ttl_seconds = 0.0
\t\treturn
\tmessage_label.text = text
\tmessage_label.visible = true
\tmessage_ttl_seconds = max(0.1, seconds)

func _should_snapshot() -> bool:
\tvar env: String = OS.get_environment("MCP_IDLE_SNAPSHOT")
\tif env != "":
\t\treturn env.to_lower() in ["1", "true", "yes", "on"]
\tif FileAccess.file_exists(SNAPSHOT_FLAG_PATH):
\t\treturn true
\tvar abs_flag: String = OS.get_user_data_dir().path_join("snapshot.flag")
\treturn FileAccess.file_exists(abs_flag)

func _should_snapshot_quit() -> bool:
\tvar env: String = OS.get_environment("MCP_IDLE_SNAPSHOT_QUIT")
\tif env != "":
\t\treturn env.to_lower() in ["1", "true", "yes", "on"]
\tif FileAccess.file_exists(SNAPSHOT_QUIT_FLAG_PATH):
\t\treturn true
\tvar abs_flag: String = OS.get_user_data_dir().path_join("snapshot_quit.flag")
\treturn FileAccess.file_exists(abs_flag)

func _maybe_snapshot() -> void:
\tif not _should_snapshot():
\t\treturn
\tawait get_tree().process_frame
\tawait RenderingServer.frame_post_draw
\tawait get_tree().process_frame
\tawait RenderingServer.frame_post_draw
\t_save_snapshot_best_effort()
\tif _should_snapshot_quit():
\t\tget_tree().quit()

func _snapshot_debug(message: String) -> void:
\tvar snapshot_dir_abs: String = OS.get_user_data_dir().path_join("snapshots")
\tDirAccess.make_dir_recursive_absolute(snapshot_dir_abs)
\tvar file = FileAccess.open(snapshot_dir_abs.path_join("snapshot_debug.txt"), FileAccess.WRITE)
\tif file == null:
\t\treturn
\tfile.store_string(message + "\\n")
\tfile.close()

func _save_snapshot_best_effort() -> void:
\tvar tex: Texture2D = get_viewport().get_texture()
\tif tex == null:
\t\t_snapshot_debug("snapshot: viewport texture was null")
\t\treturn
\tvar img: Image = tex.get_image()
\tif img == null:
\t\t_snapshot_debug("snapshot: viewport image was null")
\t\treturn

\tvar snapshot_dir_abs: String = OS.get_user_data_dir().path_join("snapshots")
\tDirAccess.make_dir_recursive_absolute(snapshot_dir_abs)
\tvar snapshot_path_abs: String = snapshot_dir_abs.path_join("idle_snapshot.png")
\tvar err: int = img.save_png(snapshot_path_abs)
\tif err != OK:
\t\t_snapshot_debug("snapshot: save_png() failed err=" + str(err))
\t\treturn
\t_snapshot_debug("snapshot: saved to " + snapshot_path_abs)
\t_toast("Snapshot saved: %s" % [SNAPSHOT_FILE_PATH], 3.0)

func _try_load_coin_texture() -> Texture2D:
\tvar file = FileAccess.open("res://assets/twemoji/coin.png", FileAccess.READ)
\tif file == null:
\t\treturn null
\tvar bytes: PackedByteArray = file.get_buffer(file.get_length())
\tfile.close()

\tvar img: Image = Image.new()
\tvar err: int = img.load_png_from_buffer(bytes)
\tif err != OK:
\t\treturn null

\tvar tex: ImageTexture = ImageTexture.create_from_image(img)
\treturn tex

func _apply_icons_best_effort() -> void:
\tvar tex: Texture2D = _try_load_coin_texture()
\tif tex == null:
\t\treturn
\tclick_button.icon = tex
\tbuy_button.icon = tex
\tupgrade_click_button.icon = tex
`;

async function ensureProjectSkeleton(projectPath) {
  await fs.mkdir(projectPath, { recursive: true });

  const projectGodotPath = path.join(projectPath, 'project.godot');
  try {
    await fs.access(projectGodotPath);
  } catch {
    await fs.writeFile(projectGodotPath, PROJECT_GODOT, 'utf8');
  }

  const iconPath = path.join(projectPath, 'icon.png');
  try {
    await fs.access(iconPath);
  } catch {
    const bytes = Buffer.from(ICON_PNG_16X16_BASE64, 'base64');
    await fs.writeFile(iconPath, bytes);
  }

  const twemojiDir = path.join(projectPath, 'assets', 'twemoji');
  await fs.mkdir(twemojiDir, { recursive: true });

  const coinPath = path.join(twemojiDir, 'coin.png');
  try {
    await fs.access(coinPath);
  } catch {
    const bytes = Buffer.from(COIN_PNG_BASE64, 'base64');
    await fs.writeFile(coinPath, bytes);
  }

  const attributionPath = path.join(projectPath, 'assets', 'ATTRIBUTION.md');
  try {
    await fs.access(attributionPath);
  } catch {
    await fs.writeFile(attributionPath, ASSET_ATTRIBUTION_MD, 'utf8');
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(usage());
    process.exit(0);
    return;
  }

  const repoRoot = path.resolve(__dirname, '..');
  const serverEntry = path.join(repoRoot, 'build', 'index.js');

  const projectPath = path.resolve(
    repoRoot,
    parsed.projectPath ?? path.join('..', 'game'),
  );

  await ensureProjectSkeleton(projectPath);

  const godotPath = await resolveGodotPath({
    godotPath: parsed.godotPath ?? undefined,
    strictPathValidation: false,
    exampleCommand:
      'GODOT_PATH="C:\\\\Path\\\\To\\\\Godot_v4.x_win64_console.exe" node scripts/demo_idle_game_mcp.js --project ../game',
  });

  const { client, shutdown } = spawnMcpServer({
    serverEntry,
    env: { GODOT_PATH: godotPath, ALLOW_DANGEROUS_OPS: 'false' },
    debugStderr: false,
    allowDangerousOps: false,
  });

  const { runStep, results } = createStepRunner();

  try {
    await wait(200);

    await runStep('tools/list', async () => client.send('tools/list', {}));
    await runStep('get_godot_version', async () =>
      client.callToolOrThrow('get_godot_version', {}),
    );

    await runStep('godot_project_config_manager(project_info.get)', async () =>
      client.callToolOrThrow('godot_project_config_manager', {
        action: 'project_info.get',
        projectPath,
      }),
    );

    await runStep('godot_workspace_manager(status)', async () =>
      client.callToolOrThrow('godot_workspace_manager', { action: 'status' }),
    );

    await runStep('create_scene(Main.tscn)', async () =>
      client.callToolOrThrow('create_scene', {
        projectPath,
        scenePath: 'Main.tscn',
        rootNodeType: 'Control',
      }),
    );

    await runStep('godot_scene_manager(batch_create UI tree)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'batch_create',
        projectPath,
        scenePath: 'Main.tscn',
        stopOnError: true,
        items: [
          {
            action: 'create',
            parentNodePath: 'root',
            nodeType: 'VBoxContainer',
            nodeName: 'VBox',
            props: {
              anchor_right: 1.0,
              anchor_bottom: 1.0,
              offset_left: 24.0,
              offset_top: 24.0,
              offset_right: -24.0,
              offset_bottom: -24.0,
            },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Label',
            nodeName: 'StatsLabel',
            props: { text: 'Loading…' },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Label',
            nodeName: 'MessageLabel',
            props: { text: '' },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Button',
            nodeName: 'ClickButton',
            props: { text: 'Click' },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Button',
            nodeName: 'BuyButton',
            props: { text: 'Buy Auto' },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Button',
            nodeName: 'UpgradeClickButton',
            props: { text: 'Upgrade Click' },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Button',
            nodeName: 'SaveButton',
            props: { text: 'Save' },
          },
          {
            action: 'create',
            parentNodePath: 'root/VBox',
            nodeType: 'Button',
            nodeName: 'ResetButton',
            props: { text: 'Reset' },
          },
          {
            action: 'create',
            parentNodePath: 'root',
            nodeType: 'Timer',
            nodeName: 'TickTimer',
            props: { wait_time: 1.0, one_shot: false, autostart: true },
          },
        ],
      }),
    );

    await runStep(
      'godot_headless_batch(write script + connect signals)',
      async () =>
        client.callToolOrThrow(
          'godot_headless_batch',
          {
            projectPath,
            stopOnError: true,
            steps: [
              {
                operation: 'write_text_file',
                params: { path: 'Main.gd', content: `${MAIN_GD}\n` },
              },
              {
                operation: 'connect_signal',
                params: {
                  scenePath: 'Main.tscn',
                  fromNodePath: 'root/TickTimer',
                  signal: 'timeout',
                  toNodePath: 'root',
                  method: '_on_tick_timeout',
                },
              },
              {
                operation: 'connect_signal',
                params: {
                  scenePath: 'Main.tscn',
                  fromNodePath: 'root/VBox/ClickButton',
                  signal: 'pressed',
                  toNodePath: 'root',
                  method: '_on_click_pressed',
                },
              },
              {
                operation: 'connect_signal',
                params: {
                  scenePath: 'Main.tscn',
                  fromNodePath: 'root/VBox/BuyButton',
                  signal: 'pressed',
                  toNodePath: 'root',
                  method: '_on_buy_pressed',
                },
              },
              {
                operation: 'connect_signal',
                params: {
                  scenePath: 'Main.tscn',
                  fromNodePath: 'root/VBox/UpgradeClickButton',
                  signal: 'pressed',
                  toNodePath: 'root',
                  method: '_on_upgrade_click_pressed',
                },
              },
              {
                operation: 'connect_signal',
                params: {
                  scenePath: 'Main.tscn',
                  fromNodePath: 'root/VBox/SaveButton',
                  signal: 'pressed',
                  toNodePath: 'root',
                  method: '_on_save_pressed',
                },
              },
              {
                operation: 'connect_signal',
                params: {
                  scenePath: 'Main.tscn',
                  fromNodePath: 'root/VBox/ResetButton',
                  signal: 'pressed',
                  toNodePath: 'root',
                  method: '_on_reset_pressed',
                },
              },
            ],
          },
          120000,
        ),
    );

    await runStep('godot_scene_manager(attach_script)', async () =>
      client.callToolOrThrow('godot_scene_manager', {
        action: 'attach_script',
        projectPath,
        scenePath: 'Main.tscn',
        nodePath: 'root',
        scriptPath: 'Main.gd',
      }),
    );

    await runStep('godot_workspace_manager(save_scene Main.tscn)', async () =>
      client.callToolOrThrow('godot_workspace_manager', {
        action: 'save_scene',
        projectPath,
        scenePath: 'Main.tscn',
      }),
    );

    if (!parsed.skipRun) {
      await runStep('godot_workspace_manager(run headless)', async () =>
        client.callToolOrThrow('godot_workspace_manager', {
          action: 'run',
          projectPath,
          mode: 'headless',
          scene: 'res://Main.tscn',
        }),
      );

      await wait(1200);

      await runStep('get_debug_output', async () =>
        client.callToolOrThrow('get_debug_output', {}),
      );

      await runStep('godot_workspace_manager(stop headless)', async () =>
        client.callToolOrThrow('godot_workspace_manager', {
          action: 'stop',
          mode: 'headless',
        }),
      );
    }
  } finally {
    await shutdown();
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) process.exit(1);

  console.log('');
  console.log('DONE');
  console.log(`Project path: ${projectPath}`);
  console.log('Open it in Godot and press Play.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
