import net from 'net';

export interface EditorBridgeConnectOptions {
  host?: string;
  port: number;
  token: string;
  timeoutMs?: number;
}

export interface BridgeHelloOk {
  type: 'hello_ok';
  capabilities?: Record<string, unknown>;
}

export interface BridgeHelloError {
  type: 'hello_error';
  error: string;
}

export interface BridgeResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class EditorBridgeClient {
  private socket: net.Socket | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: BridgeResponse) => void;
      reject: (reason: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private helloWaiter:
    | {
        resolve: (value: BridgeHelloOk) => void;
        reject: (reason: Error) => void;
        timeout: NodeJS.Timeout;
      }
    | undefined;

  get isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  async connect(options: EditorBridgeConnectOptions): Promise<BridgeHelloOk> {
    if (this.socket && !this.socket.destroyed) {
      throw new Error('Editor bridge already connected');
    }

    const host = options.host ?? '127.0.0.1';
    const timeoutMs = options.timeoutMs ?? 5000;

    const socket = new net.Socket();
    this.socket = socket;

    socket.setNoDelay(true);
    socket.setEncoding('utf8');

    socket.on('data', (chunk: string) => this.onData(chunk));
    socket.on('error', (err) => this.onSocketError(err));
    socket.on('close', () => this.onSocketClose());

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(`Editor bridge connect timeout after ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
      socket.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      socket.connect(options.port, host, () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const hello = { type: 'hello', token: options.token };
    this.sendLine(hello);

    const helloOk = await new Promise<BridgeHelloOk>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error(`Editor bridge hello timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
      this.helloWaiter = { resolve, reject, timeout };
    });

    return helloOk;
  }

  close(): void {
    if (!this.socket) return;
    try {
      this.socket.destroy();
    } finally {
      this.socket = null;
    }
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 10000,
  ): Promise<BridgeResponse> {
    if (!this.socket || this.socket.destroyed)
      throw new Error('Editor bridge not connected');

    const id = this.nextId++;
    const message = { id, method, params };
    this.sendLine(message);

    return await new Promise<BridgeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Editor bridge request timeout after ${timeoutMs}ms (method=${method})`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  private sendLine(obj: unknown): void {
    if (!this.socket || this.socket.destroyed)
      throw new Error('Editor bridge socket not available');
    this.socket.write(`${JSON.stringify(obj)}\n`);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const newlineIndex = this.buffer.indexOf('\n');
      if (newlineIndex === -1) return;

      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const line = rawLine.trim();
      if (!line) continue;

      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      if (isRecord(msg) && msg.type === 'hello_ok') {
        const waiter = this.helloWaiter;
        if (waiter) {
          clearTimeout(waiter.timeout);
          this.helloWaiter = undefined;
          const capabilities = isRecord(msg.capabilities)
            ? msg.capabilities
            : undefined;
          waiter.resolve({ type: 'hello_ok', capabilities });
        }
        continue;
      }

      if (isRecord(msg) && msg.type === 'hello_error') {
        const waiter = this.helloWaiter;
        if (waiter) {
          clearTimeout(waiter.timeout);
          this.helloWaiter = undefined;
          waiter.reject(new Error(String(msg.error ?? 'hello_error')));
        }
        continue;
      }

      if (isRecord(msg) && typeof msg.id === 'number') {
        const pending = this.pending.get(msg.id);
        if (!pending) continue;
        clearTimeout(pending.timeout);
        this.pending.delete(msg.id);

        const response: BridgeResponse = {
          id: msg.id,
          ok: Boolean(msg.ok),
          result: msg.result,
          error: msg.error,
        };

        pending.resolve(response);
      }
    }
  }

  private onSocketError(err: Error): void {
    const waiter = this.helloWaiter;
    if (waiter) {
      clearTimeout(waiter.timeout);
      this.helloWaiter = undefined;
      waiter.reject(err);
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error(`Editor bridge socket error: ${err.message} (id=${id})`),
      );
    }
    this.pending.clear();
  }

  private onSocketClose(): void {
    const waiter = this.helloWaiter;
    if (waiter) {
      clearTimeout(waiter.timeout);
      this.helloWaiter = undefined;
      waiter.reject(new Error('Editor bridge socket closed during hello'));
    }

    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Editor bridge socket closed (id=${id})`));
    }
    this.pending.clear();
  }
}
