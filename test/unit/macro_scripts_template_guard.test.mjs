import assert from 'node:assert/strict';
import test from 'node:test';

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
} from '../../build/tools/macro_manager/scripts.js';

function collectScripts() {
  const scripts = [];

  scripts.push(inputManagerScript());
  scripts.push(playerControllerScript());
  scripts.push(cameraRigScript());
  scripts.push(animationStateMachineScript());
  scripts.push(saveManagerScript());
  scripts.push(audioManagerScript());
  scripts.push(uiManagerScript());

  for (const value of Object.values(combatScripts())) scripts.push(value);
  for (const value of Object.values(fsmScripts())) scripts.push(value);

  return scripts;
}

test('macro script templates are deterministic and CI-safe (guard)', () => {
  const scripts = collectScripts();
  assert.ok(scripts.length > 0);

  for (const script of scripts) {
    assert.equal(typeof script, 'string');
    assert.ok(script.length > 0);
    assert.ok(script.endsWith('\n'), 'Script must end with a newline');

    assert.ok(!script.includes(',,'), 'Script must not contain stray ",,"');

    // Guard against low-quality templates landing in scaffolds.
    assert.ok(
      !/\bTODO\b/u.test(script),
      'Script must not contain TODO markers',
    );
  }
});
