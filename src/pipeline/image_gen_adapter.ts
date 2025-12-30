import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

import {
  generatePlaceholderTileSheetRgba,
  generatePlaceholderSpriteRgba,
} from './pixel_image.js';
import { writePngRgba } from './png.js';

export type ImageGenParams = {
  width: number;
  height: number;
  seed?: number;
};

export type ImageGenResult = {
  pngPath: string;
  seed?: number;
  meta?: Record<string, unknown>;
  adapter: string;
};

export class ManualDropMissingFileError extends Error {
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;

  constructor(outputPath: string, width: number, height: number) {
    super(`ManualDrop required file is missing: ${outputPath}`);
    this.name = 'ManualDropMissingFileError';
    this.outputPath = outputPath;
    this.width = width;
    this.height = height;
  }
}

export interface ImageGenAdapter {
  readonly name: string;
  generateImage(
    prompt: string,
    params: ImageGenParams & { outputPath: string },
  ): Promise<ImageGenResult>;
}

export class BuiltinImageGenAdapter implements ImageGenAdapter {
  readonly name = 'builtin';

  async generateImage(
    prompt: string,
    params: ImageGenParams & { outputPath: string },
  ): Promise<ImageGenResult> {
    void prompt;
    const out = params.outputPath;

    // Heuristic: if it looks like a tilesheet request, generate a grid-y sheet.
    const looksTilesheet =
      out.toLowerCase().includes('tileset') ||
      out.toLowerCase().includes('tiles');

    if (looksTilesheet) {
      const tileSize = 16;
      const columns = Math.max(1, Math.floor(params.width / tileSize));
      const rows = Math.max(1, Math.floor(params.height / tileSize));
      const gen = generatePlaceholderTileSheetRgba({
        tileSize,
        columns,
        rows,
        seed: params.seed,
      });
      await writePngRgba(out, gen.width, gen.height, gen.rgba);
      return {
        pngPath: out,
        seed: params.seed,
        meta: gen.meta as Record<string, unknown>,
        adapter: this.name,
      };
    }

    const sprite = generatePlaceholderSpriteRgba({
      width: params.width,
      height: params.height,
      seed: params.seed,
    });
    await writePngRgba(out, sprite.width, sprite.height, sprite.rgba);
    return { pngPath: out, seed: params.seed, adapter: this.name };
  }
}

export class HttpImageGenAdapter implements ImageGenAdapter {
  readonly name = 'http';

  constructor(
    private readonly url: string,
    private readonly extraHeaders?: Record<string, string>,
  ) {}

  async generateImage(
    prompt: string,
    params: ImageGenParams & { outputPath: string },
  ): Promise<ImageGenResult> {
    const resp = await axios.post(
      this.url,
      {
        prompt,
        width: params.width,
        height: params.height,
        seed: params.seed,
      },
      {
        responseType: 'arraybuffer',
        headers: { ...(this.extraHeaders ?? {}) },
        timeout: 300_000,
        validateStatus: () => true,
      },
    );

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(
        `Image generation HTTP ${resp.status}: ${String(resp.data).slice(0, 200)}`,
      );
    }

    const buf = Buffer.from(resp.data as ArrayBuffer);
    await fs.mkdir(path.dirname(params.outputPath), { recursive: true });
    await fs.writeFile(params.outputPath, buf);
    return {
      pngPath: params.outputPath,
      seed: params.seed,
      adapter: this.name,
    };
  }
}

export class ManualDropImageGenAdapter implements ImageGenAdapter {
  readonly name = 'manual_drop';

  async generateImage(
    prompt: string,
    params: ImageGenParams & { outputPath: string },
  ): Promise<ImageGenResult> {
    void prompt;
    const out = params.outputPath;
    try {
      await fs.access(out);
      return { pngPath: out, seed: params.seed, adapter: this.name };
    } catch {
      throw new ManualDropMissingFileError(out, params.width, params.height);
    }
  }
}

export function createImageGenAdapter(opts: {
  allowExternalTools: boolean;
  mode?: 'auto' | 'manual_drop';
}): ImageGenAdapter {
  if (opts.mode === 'manual_drop') {
    return new ManualDropImageGenAdapter();
  }
  if (opts.allowExternalTools && process.env.ALLOW_EXTERNAL_TOOLS === 'true') {
    const url = (process.env.IMAGE_GEN_URL ?? '').trim();
    if (url.length > 0) {
      const headerName = (process.env.IMAGE_GEN_AUTH_HEADER ?? '').trim();
      const headerValue = (process.env.IMAGE_GEN_AUTH_VALUE ?? '').trim();
      const headers =
        headerName && headerValue ? { [headerName]: headerValue } : undefined;
      return new HttpImageGenAdapter(url, headers);
    }
  }
  return new BuiltinImageGenAdapter();
}
