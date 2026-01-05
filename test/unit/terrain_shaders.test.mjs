import assert from 'node:assert/strict';
import test from 'node:test';

import { generateTerrainShader } from '../../build/tools/builder/terrain_shaders.js';

test('generateTerrainShader(height_blend) produces a spatial shader', () => {
  const out = generateTerrainShader({
    type: 'height_blend',
    textureScale: 0.1,
    blendSharpness: 2.0,
    heightLevels: '0.0,0.3,0.6,1.0',
  });
  assert.ok(typeof out === 'string' && out.length > 100);
  assert.match(out, /^shader_type spatial;/u);
  assert.match(out, /uniform float texture_scale/u);
  assert.match(out, /uniform float blend_sharpness/u);
});

test('generateTerrainShader(full) includes triplanar helper', () => {
  const out = generateTerrainShader({
    type: 'full',
    textureScale: 0.1,
    blendSharpness: 2.0,
    heightLevels: '0.0,0.3,0.6,1.0',
  });
  assert.match(out, /FULL TERRAIN SHADER/u);
  assert.match(out, /triplanar_sample/u);
});

test('generateTerrainShader rejects unknown types', () => {
  assert.throws(() => {
    generateTerrainShader({
      type: 'nope',
      textureScale: 0.1,
      blendSharpness: 2.0,
      heightLevels: '0.0,0.3,0.6,1.0',
    });
  });
});
