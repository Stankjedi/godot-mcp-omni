import type { MacroOp } from './types.js';
import { opAddNode, opAttachScript, opCreateScene } from './ops.js';

export type ComposeMainSceneOptions = {
  includeHud?: boolean;
  includePauseMenu?: boolean;
  includeSaveManager?: boolean;
  includeAudioManager?: boolean;
  includeUiManager?: boolean;
};

export function buildComposeMainSceneOps(
  worldScenePath: string,
  mainScenePath: string,
  options: ComposeMainSceneOptions,
): MacroOp[] {
  const ops: MacroOp[] = [];
  ops.push(opCreateScene(mainScenePath, 'Node2D'));

  ops.push({
    operation: 'instance_scene',
    params: {
      scenePath: mainScenePath,
      parentNodePath: 'root',
      sourceScenePath: worldScenePath,
      name: 'World',
      ensureUniqueName: true,
    },
  });

  ops.push({
    operation: 'instance_scene',
    params: {
      scenePath: mainScenePath,
      parentNodePath: 'root',
      sourceScenePath: 'res://scenes/generated/macro/player/Player.tscn',
      name: 'Player',
      ensureUniqueName: true,
    },
  });

  ops.push({
    operation: 'instance_scene',
    params: {
      scenePath: mainScenePath,
      parentNodePath: 'root',
      sourceScenePath: 'res://scenes/generated/macro/camera/CameraRig2D.tscn',
      name: 'CameraRig2D',
      ensureUniqueName: true,
      props: { target_path: '../Player' },
    },
  });

  if (options.includeHud) {
    ops.push({
      operation: 'instance_scene',
      params: {
        scenePath: mainScenePath,
        parentNodePath: 'root',
        sourceScenePath: 'res://scenes/generated/macro/ui/HUD.tscn',
        name: 'HUD',
        ensureUniqueName: true,
      },
    });
  }

  if (options.includePauseMenu) {
    ops.push({
      operation: 'instance_scene',
      params: {
        scenePath: mainScenePath,
        parentNodePath: 'root',
        sourceScenePath: 'res://scenes/generated/macro/ui/PauseMenu.tscn',
        name: 'PauseMenu',
        ensureUniqueName: true,
      },
    });
  }

  // Manager singletons as scene-local nodes (no ProjectSettings autoload changes).
  ops.push(opAddNode(mainScenePath, 'root', 'Node', 'InputManager'));
  ops.push(
    opAttachScript(
      mainScenePath,
      'root/InputManager',
      'res://scripts/macro/input/InputManager.gd',
    ),
  );

  if (options.includeSaveManager) {
    ops.push(opAddNode(mainScenePath, 'root', 'Node', 'SaveManager'));
    ops.push(
      opAttachScript(
        mainScenePath,
        'root/SaveManager',
        'res://scripts/macro/save/SaveManager.gd',
      ),
    );
  }

  if (options.includeAudioManager) {
    ops.push(opAddNode(mainScenePath, 'root', 'Node', 'AudioManager'));
    ops.push(
      opAttachScript(
        mainScenePath,
        'root/AudioManager',
        'res://scripts/macro/audio/AudioManager.gd',
      ),
    );
  }

  if (options.includeUiManager) {
    ops.push(opAddNode(mainScenePath, 'root', 'Node', 'UIManager'));
    ops.push(
      opAttachScript(
        mainScenePath,
        'root/UIManager',
        'res://scripts/macro/ui/UIManager.gd',
      ),
    );
  }

  return ops;
}
