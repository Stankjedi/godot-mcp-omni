import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDoctorReport } from '../build/doctor/report.js';
import { renderDoctorReportMarkdown } from '../build/doctor/markdown.js';

test('doctor markdown is deterministic and de-duplicates issues', () => {
  const report = buildDoctorReport({
    projectPath: '/tmp/project',
    godotVersion: 'Godot Engine v4.x',
    options: {
      includeAssets: true,
      includeScripts: true,
      includeScenes: true,
      includeUID: true,
      includeExport: false,
      maxIssuesPerCategory: 200,
      timeBudgetMs: 1234,
      deepSceneInstantiate: false,
    },
    meta: { scanDurationMs: 10 },
    issues: [
      {
        issueId: 'MISSING_RES_REFERENCE',
        severity: 'error',
        category: 'scenes',
        title: 'Missing res:// reference target',
        message: 'Referenced file does not exist: res://missing.tres',
        location: { file: 'res://scenes/Main.tscn' },
      },
      // Duplicate (should be removed)
      {
        issueId: 'MISSING_RES_REFERENCE',
        severity: 'error',
        category: 'scenes',
        title: 'Missing res:// reference target',
        message: 'Referenced file does not exist: res://missing.tres',
        location: { file: 'res://scenes/Main.tscn' },
      },
      // Unsorted, lower severity (should appear after errors)
      {
        issueId: 'IMPORT_SOURCE_MISSING',
        severity: 'warning',
        category: 'assets',
        title: 'Import source file is missing',
        message:
          'Import metadata references a missing source file: res://assets/missing.png',
        location: { file: 'res://assets/missing.png.import' },
      },
    ],
  });

  assert.equal(
    report.issues.filter((i) => i.issueId === 'MISSING_RES_REFERENCE').length,
    1,
  );

  const md1 = renderDoctorReportMarkdown(report);
  const md2 = renderDoctorReportMarkdown(report);

  assert.equal(md1, md2);
  assert.match(md1, /^# Doctor Report/mu);
  assert.match(md1, /MISSING_RES_REFERENCE/u);
  assert.match(md1, /IMPORT_SOURCE_MISSING/u);

  // Should include the issue ID at least once in the output.
  assert.ok((md1.match(/MISSING_RES_REFERENCE/gu) ?? []).length >= 1);
});
