import {
  asOptionalBoolean,
  asOptionalPositiveNumber,
  asOptionalRecord,
} from '../../../validation.js';

import type { ServerContext } from '../../context.js';
import type { ToolResponse } from '../../types.js';

import {
  extractNodePath,
  hasEditorConnection,
  joinNodePath,
  layoutPresetProps,
  maybeGetString,
  normalizeNodePath,
  parseVector2Like,
  type BaseToolHandlers,
} from '../shared.js';

import type { MaybeCaptureViewport } from './capture_viewport.js';
import { handleCreate } from './create.js';

export async function handleCreateUI(
  ctx: ServerContext,
  baseHandlers: BaseToolHandlers,
  uiArgs: Record<string, unknown>,
  timeoutMs: number | undefined,
  maybeCaptureViewport: MaybeCaptureViewport,
): Promise<ToolResponse> {
  const localTimeout =
    asOptionalPositiveNumber(uiArgs.timeoutMs, 'timeoutMs') ?? timeoutMs;
  const editorConnected = hasEditorConnection(ctx);
  const headlessProjectPath = editorConnected
    ? undefined
    : maybeGetString(uiArgs, ['projectPath', 'project_path'], 'projectPath');
  const headlessScenePath = editorConnected
    ? undefined
    : maybeGetString(uiArgs, ['scenePath', 'scene_path'], 'scenePath');
  if (!editorConnected && (!headlessProjectPath || !headlessScenePath)) {
    return {
      ok: false,
      summary:
        'Not connected to editor bridge; create_ui requires projectPath and scenePath for headless mode',
      details: { required: ['projectPath', 'scenePath'] },
    };
  }
  const parentNodePath =
    maybeGetString(
      uiArgs,
      ['parentNodePath', 'parent_node_path', 'parentPath'],
      'parentNodePath',
    ) ?? 'root';
  const rootType =
    maybeGetString(uiArgs, ['uiRootType', 'rootType'], 'uiRootType') ??
    'CanvasLayer';
  const rootName =
    maybeGetString(uiArgs, ['uiRootName', 'rootName'], 'uiRootName') ?? 'UI';
  const controlType =
    maybeGetString(uiArgs, ['uiControlType', 'controlType'], 'uiControlType') ??
    'Control';
  const controlName =
    maybeGetString(uiArgs, ['uiControlName', 'controlName'], 'uiControlName') ??
    'UIRoot';
  const uiRootProps =
    asOptionalRecord(
      (uiArgs as Record<string, unknown>).uiRootProps,
      'uiRootProps',
    ) ??
    asOptionalRecord(
      (uiArgs as Record<string, unknown>).rootProps,
      'rootProps',
    );
  const uiControlProps =
    asOptionalRecord(
      (uiArgs as Record<string, unknown>).uiControlProps,
      'uiControlProps',
    ) ??
    asOptionalRecord(
      (uiArgs as Record<string, unknown>).controlProps,
      'controlProps',
    );
  const ensureUniqueName =
    asOptionalBoolean(
      (uiArgs as Record<string, unknown>).ensureUniqueName ??
        (uiArgs as Record<string, unknown>).ensure_unique_name,
      'ensureUniqueName',
    ) ?? true;
  const elements =
    (uiArgs as Record<string, unknown>).elements ??
    (uiArgs as Record<string, unknown>).nodes ??
    [];
  const normalizedParent = normalizeNodePath(parentNodePath);
  const rootResp = await handleCreate(
    ctx,
    baseHandlers,
    {
      nodeType: rootType,
      nodeName: rootName,
      parentNodePath: normalizedParent,
      autoAttach: false,
      ensureUniqueName,
      ...(headlessProjectPath ? { projectPath: headlessProjectPath } : {}),
      ...(headlessScenePath ? { scenePath: headlessScenePath } : {}),
      ...(uiRootProps ? { props: uiRootProps } : {}),
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    },
    timeoutMs,
    maybeCaptureViewport,
  );
  if (!rootResp.ok) return rootResp;

  const rootPath =
    extractNodePath(rootResp) ?? joinNodePath(normalizedParent, rootName);

  const controlBaseProps: Record<string, unknown> = {
    anchor_left: 0,
    anchor_top: 0,
    anchor_right: 1,
    anchor_bottom: 1,
    offset_left: 0,
    offset_top: 0,
    offset_right: 0,
    offset_bottom: 0,
    ...(uiControlProps ?? {}),
  };
  const controlResp = await handleCreate(
    ctx,
    baseHandlers,
    {
      nodeType: controlType,
      nodeName: controlName,
      parentNodePath: rootPath,
      autoAttach: false,
      ensureUniqueName,
      props: controlBaseProps,
      ...(headlessProjectPath ? { projectPath: headlessProjectPath } : {}),
      ...(headlessScenePath ? { scenePath: headlessScenePath } : {}),
      ...(localTimeout ? { timeoutMs: localTimeout } : {}),
    },
    timeoutMs,
    maybeCaptureViewport,
  );
  if (!controlResp.ok) return controlResp;

  const controlPath =
    extractNodePath(controlResp) ?? joinNodePath(rootPath, controlName);

  const elementResults: ToolResponse[] = [];
  if (Array.isArray(elements)) {
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      if (!element || typeof element !== 'object' || Array.isArray(element))
        continue;
      const elementObj = element as Record<string, unknown>;
      const elementProps =
        asOptionalRecord(elementObj.props, `elements[${i}].props`) ??
        asOptionalRecord(elementObj.properties, `elements[${i}].properties`) ??
        {};
      const props: Record<string, unknown> = { ...elementProps };
      const layout = maybeGetString(
        elementObj,
        ['layout', 'dock', 'preset'],
        `elements[${i}].layout`,
      );
      const layoutProps = layoutPresetProps(layout);
      if (layoutProps) {
        for (const [key, value] of Object.entries(layoutProps)) {
          if (props[key] === undefined) props[key] = value;
        }
      }
      const position = parseVector2Like(
        elementObj.position ?? elementObj.pos ?? elementObj.offset,
      );
      const size = parseVector2Like(elementObj.size ?? elementObj.dimensions);
      if (position || size) {
        if (props.anchor_left === undefined) props.anchor_left = 0;
        if (props.anchor_top === undefined) props.anchor_top = 0;
        if (props.anchor_right === undefined) props.anchor_right = 0;
        if (props.anchor_bottom === undefined) props.anchor_bottom = 0;
        if (position) {
          if (props.offset_left === undefined) props.offset_left = position.x;
          if (props.offset_top === undefined) props.offset_top = position.y;
        }
        if (size) {
          const left =
            typeof props.offset_left === 'number' ? props.offset_left : 0;
          const top =
            typeof props.offset_top === 'number' ? props.offset_top : 0;
          if (props.offset_right === undefined)
            props.offset_right = left + size.x;
          if (props.offset_bottom === undefined)
            props.offset_bottom = top + size.y;
        }
      }

      const elementParent =
        maybeGetString(
          elementObj,
          ['parentNodePath', 'parent_path', 'parentPath'],
          `elements[${i}].parentNodePath`,
        ) ?? controlPath;
      const elementResp = await handleCreate(
        ctx,
        baseHandlers,
        {
          ...elementObj,
          parentNodePath: elementParent,
          props,
          autoAttach: elementObj.autoAttach ?? false,
          ensureUniqueName:
            asOptionalBoolean(
              elementObj.ensureUniqueName ?? elementObj.ensure_unique_name,
              `elements[${i}].ensureUniqueName`,
            ) ?? ensureUniqueName,
          ...(headlessProjectPath ? { projectPath: headlessProjectPath } : {}),
          ...(headlessScenePath ? { scenePath: headlessScenePath } : {}),
          ...(localTimeout ? { timeoutMs: localTimeout } : {}),
        },
        timeoutMs,
        maybeCaptureViewport,
      );
      elementResults.push(elementResp);
      if (!elementResp.ok) {
        return {
          ok: false,
          summary: 'create_ui failed',
          details: { failedIndex: i, results: elementResults },
        };
      }
    }
  }

  const response = {
    ok: true,
    summary: 'create_ui completed',
    details: {
      root: rootResp,
      control: controlResp,
      elements: elementResults,
    },
  };
  return await maybeCaptureViewport(uiArgs, response);
}
