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
    title: 'macro_manager list_macros (CI-safe)',
    tool: 'macro_manager',
    args: { action: 'list_macros' },
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
    title: 'pixel_goal_to_spec builtin (CI-safe)',
    tool: 'pixel_goal_to_spec',
    args: {
      projectPath: '$PROJECT_PATH',
      goal: 'tilemap + world (size 16x16), place trees density 0.2',
      allowExternalTools: false,
    },
    expectOk: true,
  },
  {
    id: 'SCN-005',
    title: 'pixel_manager goal_to_spec forwarding (CI-safe)',
    tool: 'pixel_manager',
    args: {
      action: 'goal_to_spec',
      projectPath: '$PROJECT_PATH',
      goal: 'tilemap + world (size 16x16)',
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
