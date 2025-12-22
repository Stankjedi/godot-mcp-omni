import assert from 'node:assert/strict';
import test from 'node:test';

import { hasTraversalSegment } from '../build/validation.js';

test('hasTraversalSegment allows safe paths', () => {
  assert.equal(hasTraversalSegment('C:\\\\Projects\\\\Game'), false);
  assert.equal(hasTraversalSegment('/usr/local/game'), false);
  assert.equal(hasTraversalSegment('res://scenes/main.tscn'), false);
  assert.equal(hasTraversalSegment('file..txt'), false);
});

test('hasTraversalSegment blocks traversal segments', () => {
  assert.equal(hasTraversalSegment('../x'), true);
  assert.equal(hasTraversalSegment('res://../x'), true);
  assert.equal(hasTraversalSegment('a/../b'), true);
  assert.equal(hasTraversalSegment('a\\\\..\\\\b'), true);
  assert.equal(hasTraversalSegment(''), true);
});
