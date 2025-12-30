import type { MacroDefinition } from './types.js';
import {
  opAddNode,
  opAttachScript,
  opCreateScene,
  opWriteTextFile,
} from './ops.js';
import {
  animationStateMachineScript,
  audioManagerScript,
  cameraRigScript,
  combatScripts,
  fsmScripts,
  inputManagerScript,
  playerControllerScript,
  saveManagerScript,
  uiManagerScript,
} from './scripts.js';

const MACROS: Record<string, MacroDefinition> = {
  input_system_scaffold: {
    id: 'input_system_scaffold',
    title: 'Input system scaffold (Actions + contexts + rebinding)',
    description:
      'Creates an InputManager script that defines action-based input, basic context switching, and rebinding persistence.',
    outputs: ['res://scripts/macro/input/InputManager.gd'],
    buildOps: () => [
      opWriteTextFile(
        'res://scripts/macro/input/InputManager.gd',
        inputManagerScript(),
      ),
    ],
  },

  character_controller_2d_scaffold: {
    id: 'character_controller_2d_scaffold',
    title: '2D Character controller scaffold (movement + jump buffer)',
    description:
      'Creates a minimal Player scene (CharacterBody2D) and a PlayerController script (fixed-step movement/jump buffer/coyote time).',
    outputs: [
      'res://scripts/macro/player/PlayerController.gd',
      'res://scenes/generated/macro/player/Player.tscn',
    ],
    buildOps: () => [
      opWriteTextFile(
        'res://scripts/macro/player/PlayerController.gd',
        playerControllerScript(),
      ),
      opCreateScene(
        'res://scenes/generated/macro/player/Player.tscn',
        'CharacterBody2D',
      ),
      opAddNode(
        'res://scenes/generated/macro/player/Player.tscn',
        'root',
        'CollisionShape2D',
        'CollisionShape2D',
        {
          shape: {
            $resource: 'RectangleShape2D',
            props: {
              size: { $type: 'Vector2', x: 16, y: 24 },
            },
          },
        },
      ),
      opAddNode(
        'res://scenes/generated/macro/player/Player.tscn',
        'root',
        'Sprite2D',
        'Sprite2D',
      ),
      opAttachScript(
        'res://scenes/generated/macro/player/Player.tscn',
        'root',
        'res://scripts/macro/player/PlayerController.gd',
      ),
    ],
  },

  camera_2d_scaffold: {
    id: 'camera_2d_scaffold',
    title: '2D camera scaffold (follow + look-ahead)',
    description:
      'Creates a CameraRig2D scene with a Camera2D child and a follow/look-ahead script.',
    outputs: [
      'res://scripts/macro/camera/CameraRig2D.gd',
      'res://scenes/generated/macro/camera/CameraRig2D.tscn',
    ],
    buildOps: () => [
      opWriteTextFile(
        'res://scripts/macro/camera/CameraRig2D.gd',
        cameraRigScript(),
      ),
      opCreateScene(
        'res://scenes/generated/macro/camera/CameraRig2D.tscn',
        'Node2D',
      ),
      opAddNode(
        'res://scenes/generated/macro/camera/CameraRig2D.tscn',
        'root',
        'Camera2D',
        'Camera2D',
      ),
      opAttachScript(
        'res://scenes/generated/macro/camera/CameraRig2D.tscn',
        'root',
        'res://scripts/macro/camera/CameraRig2D.gd',
      ),
    ],
  },

  animation_pipeline_scaffold: {
    id: 'animation_pipeline_scaffold',
    title: 'Animation pipeline scaffold (state machine + events)',
    description:
      'Creates a minimal AnimationStateMachine script template to drive an animation system.',
    outputs: ['res://scripts/macro/animation/AnimationStateMachine.gd'],
    buildOps: () => [
      opWriteTextFile(
        'res://scripts/macro/animation/AnimationStateMachine.gd',
        animationStateMachineScript(),
      ),
    ],
  },

  combat_hitbox_scaffold: {
    id: 'combat_hitbox_scaffold',
    title: 'Combat scaffold (Hitbox/Hurtbox + Health + payload)',
    description:
      'Creates scripts for Hitbox/Hurtbox/Health/DamagePayload to bootstrap combat and hit reactions.',
    outputs: Object.keys(combatScripts()),
    buildOps: () =>
      Object.entries(combatScripts()).map(([p, c]) => opWriteTextFile(p, c)),
  },

  enemy_ai_fsm_scaffold: {
    id: 'enemy_ai_fsm_scaffold',
    title: 'Enemy AI scaffold (FSM + perception stub)',
    description:
      'Creates FSM scripts and a minimal Enemy scene to extend into patrol/chase/attack behaviors.',
    outputs: [
      ...Object.keys(fsmScripts()),
      'res://scenes/generated/macro/enemy/Enemy.tscn',
    ],
    buildOps: () => [
      ...Object.entries(fsmScripts()).map(([p, c]) => opWriteTextFile(p, c)),
      opCreateScene(
        'res://scenes/generated/macro/enemy/Enemy.tscn',
        'CharacterBody2D',
      ),
      opAddNode(
        'res://scenes/generated/macro/enemy/Enemy.tscn',
        'root',
        'CollisionShape2D',
        'CollisionShape2D',
        {
          shape: {
            $resource: 'RectangleShape2D',
            props: {
              size: { $type: 'Vector2', x: 16, y: 24 },
            },
          },
        },
      ),
      opAttachScript(
        'res://scenes/generated/macro/enemy/Enemy.tscn',
        'root',
        'res://scripts/macro/ai/Enemy.gd',
      ),
    ],
  },

  level_pipeline_scaffold: {
    id: 'level_pipeline_scaffold',
    title: 'Level pipeline scaffold (layers + triggers + parallax)',
    description:
      'Creates a minimal World scene structure with TileLayers and placeholders for triggers/parallax.',
    outputs: ['res://scenes/generated/macro/world/World.tscn'],
    buildOps: () => [
      opCreateScene('res://scenes/generated/macro/world/World.tscn', 'Node2D'),
      opAddNode(
        'res://scenes/generated/macro/world/World.tscn',
        'root',
        'Node2D',
        'TileLayers',
      ),
      opAddNode(
        'res://scenes/generated/macro/world/World.tscn',
        'root/TileLayers',
        'TileMapLayer',
        'Terrain',
      ),
      opAddNode(
        'res://scenes/generated/macro/world/World.tscn',
        'root',
        'Area2D',
        'Triggers',
      ),
      opAddNode(
        'res://scenes/generated/macro/world/World.tscn',
        'root',
        'Parallax2D',
        'Parallax2D',
      ),
    ],
  },

  ui_system_scaffold: {
    id: 'ui_system_scaffold',
    title: 'UI scaffold (HUD + Pause menu)',
    description:
      'Creates minimal HUD and PauseMenu scenes and a UIManager script stub.',
    outputs: [
      'res://scripts/macro/ui/UIManager.gd',
      'res://scenes/generated/macro/ui/HUD.tscn',
      'res://scenes/generated/macro/ui/PauseMenu.tscn',
    ],
    buildOps: () => [
      opWriteTextFile('res://scripts/macro/ui/UIManager.gd', uiManagerScript()),
      opCreateScene('res://scenes/generated/macro/ui/HUD.tscn', 'CanvasLayer'),
      opAddNode(
        'res://scenes/generated/macro/ui/HUD.tscn',
        'root',
        'Label',
        'Label',
        { text: 'HUD (macro scaffold)' },
      ),
      opCreateScene(
        'res://scenes/generated/macro/ui/PauseMenu.tscn',
        'CanvasLayer',
      ),
      opAddNode(
        'res://scenes/generated/macro/ui/PauseMenu.tscn',
        'root',
        'Label',
        'Label',
        { text: 'Pause Menu (macro scaffold)' },
      ),
    ],
  },

  save_load_scaffold: {
    id: 'save_load_scaffold',
    title: 'Save/Load scaffold (slots + versioning)',
    description:
      'Creates a SaveManager script with a version field and JSON-based slot IO.',
    outputs: ['res://scripts/macro/save/SaveManager.gd'],
    buildOps: () => [
      opWriteTextFile(
        'res://scripts/macro/save/SaveManager.gd',
        saveManagerScript(),
      ),
    ],
  },

  audio_system_scaffold: {
    id: 'audio_system_scaffold',
    title: 'Audio scaffold (AudioManager facade)',
    description:
      'Creates an AudioManager script stub for BGM/SFX routing and playback.',
    outputs: ['res://scripts/macro/audio/AudioManager.gd'],
    buildOps: () => [
      opWriteTextFile(
        'res://scripts/macro/audio/AudioManager.gd',
        audioManagerScript(),
      ),
    ],
  },
};

export function getMacroList(): Array<{
  id: string;
  title: string;
  description: string;
}> {
  return Object.values(MACROS).map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
  }));
}

export function getMacro(id: string): MacroDefinition | null {
  return MACROS[id] ?? null;
}
