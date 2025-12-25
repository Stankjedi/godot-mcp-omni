import type { ChildProcessWithoutNullStreams } from 'child_process';
import type { ToolResponse } from '../tools/types.js';

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: number; result: unknown }
  | { jsonrpc: '2.0'; id: number; error: unknown };

function snippet(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTextContent(
  value: unknown,
): value is { type: 'text'; text: string } {
  return (
    isRecord(value) && value.type === 'text' && typeof value.text === 'string'
  );
}

function isToolResponse(value: unknown): value is ToolResponse {
  return (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    typeof value.summary === 'string'
  );
}

function getTextContent(mcpResult: unknown): string {
  if (!isRecord(mcpResult) || !Array.isArray(mcpResult.content)) {
    throw new Error(`Bad MCP result: ${snippet(mcpResult)}`);
  }
  const entry = mcpResult.content.find(isTextContent);
  if (!entry) {
    throw new Error(`Missing text content: ${snippet(mcpResult)}`);
  }
  return entry.text;
}

export class JsonRpcProcessClient {
  private pending = new Map<
    number,
    {
      resolve: (v: JsonRpcResponse) => void;
      reject: (e: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private nextId = 1;
  private stdoutBuffer = '';
  private closed = false;

  constructor(private child: ChildProcessWithoutNullStreams) {
    this.child.stdout.on('data', (d: Buffer) => this.onStdout(d));
    this.child.on('exit', (code) =>
      this.failAll(new Error(`Server exited (code=${code ?? 'null'})`)),
    );
    this.child.on('error', (err) =>
      this.failAll(new Error(`Server error: ${String(err)}`)),
    );
  }

  private onStdout(d: Buffer): void {
    this.stdoutBuffer += d.toString('utf8');
    while (true) {
      const idx = this.stdoutBuffer.indexOf('\n');
      if (idx === -1) break;
      const line = this.stdoutBuffer.slice(0, idx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
      if (!line) continue;

      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (!isRecord(msg) || typeof msg.id !== 'number') continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timeout);
      p.resolve(msg as JsonRpcResponse);
    }
  }

  private failAll(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }

  async send(
    method: string,
    params: unknown,
    timeoutMs = 30000,
  ): Promise<JsonRpcResponse> {
    if (this.closed) throw new Error('JSON-RPC client is closed');
    const id = this.nextId++;
    const request = { jsonrpc: '2.0', id, method, params };

    if (!this.child.stdin.writable)
      throw new Error('Server stdin not writable');
    this.child.stdin.write(`${JSON.stringify(request)}\n`);

    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Timeout waiting for ${method} (id=${id})`)),
        timeoutMs,
      );
      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<ToolResponse> {
    const resp = await this.send(
      'tools/call',
      { name, arguments: args },
      timeoutMs,
    );
    if ('error' in resp) {
      throw new Error(
        `tools/call error (tool=${name}, id=${resp.id}): ${snippet(resp.error)}`,
      );
    }

    const toolText = getTextContent(resp.result);
    let parsed: unknown;
    try {
      parsed = JSON.parse(toolText);
    } catch {
      throw new Error(
        `Tool ${name} returned non-JSON text (id=${resp.id}): ${toolText}`,
      );
    }

    if (!isToolResponse(parsed)) {
      throw new Error(
        `Tool ${name} returned unexpected JSON (id=${resp.id}): ${snippet(parsed)}`,
      );
    }

    return parsed;
  }

  async callToolOrThrow(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<ToolResponse> {
    const parsed = await this.callTool(name, args, timeoutMs);

    if (!parsed.ok) {
      const details = parsed.details
        ? `\nDetails: ${snippet(parsed.details)}`
        : '';
      const logs = parsed.logs ? `\nLogs: ${snippet(parsed.logs)}` : '';
      const raw = `\nRaw: ${snippet(parsed)}`;
      throw new Error(
        `Tool ${name} failed: ${parsed.summary}${details}${logs}${raw}`,
      );
    }
    return parsed;
  }

  dispose(): void {
    this.failAll(new Error('JSON-RPC client disposed'));
    this.child.stdout.removeAllListeners('data');
    this.child.removeAllListeners('exit');
    this.child.removeAllListeners('error');
  }
}
