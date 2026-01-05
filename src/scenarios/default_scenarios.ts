export type ScenarioDefinition = {
  id: string;
  title: string;
  tool: string;
  args: Record<string, unknown>;
  expectOk: boolean;
};

export const DEFAULT_CI_SAFE_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'SCN-001',
    title: 'tools/list (CI-safe)',
    tool: 'tools/list',
    args: {},
    expectOk: true,
  },
  {
    id: 'SCN-002',
    title: 'workflow_manager macro.list (CI-safe)',
    tool: 'workflow_manager',
    args: { action: 'macro.list' },
    expectOk: true,
  },
  {
    id: 'SCN-003',
    title: 'godot_preflight minimal project (CI-safe)',
    tool: 'godot_preflight',
    args: { projectPath: '$PROJECT_PATH' },
    expectOk: true,
  },
  {
    id: 'SCN-004',
    title: 'pixel_manager goal_to_spec builtin (CI-safe)',
    tool: 'pixel_manager',
    args: {
      action: 'goal_to_spec',
      projectPath: '$PROJECT_PATH',
      goal: 'tilemap + world (size 16x16), place trees density 0.2',
      allowExternalTools: false,
    },
    expectOk: true,
  },
  {
    id: 'SCN-005',
    title: 'pixel_manager macro_run dryRun (CI-safe)',
    tool: 'pixel_manager',
    args: {
      action: 'macro_run',
      projectPath: '$PROJECT_PATH',
      goal: 'tilemap + world (size 16x16), place trees density 0.2',
      dryRun: true,
      allowExternalTools: false,
    },
    expectOk: true,
  },
  {
    id: 'SCN-006',
    title: 'Editor tools are CI-safe when not connected',
    tool: 'godot_editor_batch',
    args: {},
    expectOk: false,
  },
];
