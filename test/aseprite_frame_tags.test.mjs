import assert from 'node:assert/strict';
import test from 'node:test';

import { frameTagsFromAsepriteJson } from '../build/tools/pixel/tiles.js';

test('frameTagsFromAsepriteJson parses meta.frameTags', () => {
  const json = {
    frames: [
      { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 },
      { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 100 },
      { frame: { x: 32, y: 0, w: 16, h: 16 }, duration: 100 },
    ],
    meta: {
      frameTags: [
        { name: 'idle', from: 0, to: 1, direction: 'forward' },
        { name: 'attack', from: 1, to: 2, direction: 'reverse' },
      ],
    },
  };

  assert.deepEqual(frameTagsFromAsepriteJson(json), [
    { name: 'idle', from: 0, to: 1, direction: 'forward' },
    { name: 'attack', from: 1, to: 2, direction: 'reverse' },
  ]);
});

test('frameTagsFromAsepriteJson returns [] when tags are missing', () => {
  assert.deepEqual(frameTagsFromAsepriteJson({ frames: [] }), []);
  assert.deepEqual(frameTagsFromAsepriteJson(null), []);
  assert.deepEqual(frameTagsFromAsepriteJson({}), []);
});

test('frameTagsFromAsepriteJson clamps from/to to the frames length', () => {
  const json = {
    frames: [
      { frame: { x: 0, y: 0, w: 16, h: 16 } },
      { frame: { x: 16, y: 0, w: 16, h: 16 } },
    ],
    meta: {
      frameTags: [{ name: 'run', from: -5, to: 99, direction: 'forward' }],
    },
  };

  assert.deepEqual(frameTagsFromAsepriteJson(json), [
    { name: 'run', from: 0, to: 1, direction: 'forward' },
  ]);
});
