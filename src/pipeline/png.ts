import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export async function readPngSize(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(filePath);
  } catch {
    return null;
  }

  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunkType = buf.subarray(12, 16).toString('ascii');
  if (chunkType !== 'IHDR') return null;

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC32_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length >>> 0, 0);

  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function encodePngRgba(
  width: number,
  height: number,
  rgba: Uint8Array,
): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('encodePngRgba: width/height must be integers');
  }
  if (width <= 0 || height <= 0) {
    throw new Error('encodePngRgba: width/height must be > 0');
  }
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `encodePngRgba: rgba length mismatch (got ${rgba.length}, expected ${width * height * 4})`,
    );
  }

  // Unfiltered scanlines: each row starts with filter byte 0, followed by RGBA.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.subarray(y * stride, y * stride + stride)).copy(
      raw,
      rowStart + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width >>> 0, 0);
  ihdr.writeUInt32BE(height >>> 0, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const signature = PNG_SIGNATURE;
  const out = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return out;
}

export async function writePngRgba(
  filePath: string,
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<void> {
  const buf = encodePngRgba(width, height, rgba);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buf);
}
