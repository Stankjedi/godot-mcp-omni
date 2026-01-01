import assert from 'node:assert/strict';
import test from 'node:test';

import { animationStateMachineScript } from '../../build/tools/macro_manager/scripts.js';

test('animationStateMachineScript includes transition notifications (CI-safe)', () => {
  const script = animationStateMachineScript();
  assert.equal(typeof script, 'string');
  assert.ok(script.length > 0);

  assert.ok(
    !script.includes('# TODO:'),
    'Template still contains TODO markers',
  );

  assert.match(script, /\bsignal state_changed\b/u);
  assert.match(script, /@export var animation_tree_path: NodePath/u);

  // Best-effort AnimationTree state machine integration.
  assert.match(script, /parameters\/playback/u);
  assert.match(script, /has_method\("travel"\)/u);
  assert.match(script, /playback\.travel/u);
});
