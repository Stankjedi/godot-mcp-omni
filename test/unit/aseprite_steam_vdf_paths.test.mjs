import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSteamLibraryPathsFromVdfText } from '../../build/pipeline/aseprite_runner.js';

test('extractSteamLibraryPathsFromVdfText extracts library paths from modern VDF format', () => {
  const vdf = `"libraryfolders"
{
  "contentstatsid" "123"
  "1"
  {
    "path" "D:\\\\SteamLibrary"
    "label" ""
  }
  "2"
  {
    "path" "E:\\\\SteamLibrary\\\\"
  }
}`;

  assert.deepEqual(extractSteamLibraryPathsFromVdfText(vdf), [
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
  ]);
});

test('extractSteamLibraryPathsFromVdfText extracts library paths from legacy VDF format', () => {
  const vdf = `"LibraryFolders"
{
  "TimeNextStatsReport" "123"
  "ContentStatsID" "456"
  "1" "D:\\\\SteamLibrary"
  "2" "E:\\\\SteamLibrary"
}`;

  assert.deepEqual(extractSteamLibraryPathsFromVdfText(vdf), [
    'D:\\SteamLibrary',
    'E:\\SteamLibrary',
  ]);
});
