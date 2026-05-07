import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Uint8Array; // RGBA, length = width * height * 4
}

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompareResult {
  width: number;
  height: number;
  hashDistance: number;
  hashSimilarity: number;
  tileMeanDiff: number;
  maxTileDiff: number;
  pixelMatchRatio: number;
  pass: boolean;
  region: RegionRect | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(input: Buffer | Uint8Array): DecodedImage {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a PNG (signature mismatch).');
  }

  let offset = 8;
  let ihdr: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    if (offset + 8 > buf.length) {
      break;
    }
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      throw new Error(`Truncated PNG chunk: ${type}`);
    }

    if (type === 'IHDR') {
      ihdr = {
        width: buf.readUInt32BE(dataStart),
        height: buf.readUInt32BE(dataStart + 4),
        bitDepth: buf[dataStart + 8],
        colorType: buf[dataStart + 9],
        interlace: buf[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // skip CRC
  }

  if (!ihdr) {
    throw new Error('PNG missing IHDR.');
  }
  if (ihdr.bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${ihdr.bitDepth}; only 8 supported.`);
  }
  if (ihdr.interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported.');
  }

  let channels: 3 | 4;
  if (ihdr.colorType === 2) {
    channels = 3;
  } else if (ihdr.colorType === 6) {
    channels = 4;
  } else {
    throw new Error(`Unsupported PNG color type ${ihdr.colorType}; only RGB(6) and RGBA(2) supported.`);
  }

  const compressed = Buffer.concat(idatChunks);
  const inflated = inflateSync(compressed);

  const stride = ihdr.width * channels;
  const expected = (stride + 1) * ihdr.height;
  if (inflated.length < expected) {
    throw new Error(`PNG inflate produced too few bytes (got ${inflated.length}, expected ${expected}).`);
  }

  const raw = new Uint8Array(stride * ihdr.height);
  let prevRow: Uint8Array | null = null;
  for (let y = 0; y < ihdr.height; y++) {
    const filterType = inflated[y * (stride + 1)];
    const rowSrc = inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const rowDst = raw.subarray(y * stride, y * stride + stride);
    applyPngFilter(filterType, rowSrc, prevRow, rowDst, channels);
    prevRow = rowDst;
  }

  const data = new Uint8Array(ihdr.width * ihdr.height * 4);
  if (channels === 4) {
    data.set(raw);
  } else {
    for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
      data[j] = raw[i];
      data[j + 1] = raw[i + 1];
      data[j + 2] = raw[i + 2];
      data[j + 3] = 255;
    }
  }

  return { width: ihdr.width, height: ihdr.height, channels, data };
}

function applyPngFilter(
  type: number,
  src: Uint8Array,
  prev: Uint8Array | null,
  dst: Uint8Array,
  channels: number,
): void {
  const stride = src.length;
  for (let i = 0; i < stride; i++) {
    const a = i >= channels ? dst[i - channels] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= channels ? prev[i - channels] : 0;

    let recon: number;
    switch (type) {
      case 0: recon = src[i]; break;
      case 1: recon = src[i] + a; break;
      case 2: recon = src[i] + b; break;
      case 3: recon = src[i] + Math.floor((a + b) / 2); break;
      case 4: recon = src[i] + paethPredictor(a, b, c); break;
      default: throw new Error(`Unknown PNG filter type ${type}`);
    }
    dst[i] = recon & 0xff;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodeBase64Png(base64: string): DecodedImage {
  return decodePng(Buffer.from(base64, 'base64'));
}

function clipRegion(img: DecodedImage, region: RegionRect | null | undefined): RegionRect {
  if (!region) {
    return { x: 0, y: 0, width: img.width, height: img.height };
  }
  const x = Math.max(0, Math.min(img.width, Math.floor(region.x)));
  const y = Math.max(0, Math.min(img.height, Math.floor(region.y)));
  const width = Math.max(0, Math.min(img.width - x, Math.floor(region.width)));
  const height = Math.max(0, Math.min(img.height - y, Math.floor(region.height)));
  return { x, y, width, height };
}

function toLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function downsampleLuma(
  img: DecodedImage,
  region: RegionRect,
  outW: number,
  outH: number,
): Float32Array {
  const out = new Float32Array(outW * outH);
  if (region.width === 0 || region.height === 0) {
    return out;
  }
  const sxStep = region.width / outW;
  const syStep = region.height / outH;

  for (let oy = 0; oy < outH; oy++) {
    const y0 = region.y + Math.floor(oy * syStep);
    const y1 = Math.min(region.y + region.height, region.y + Math.ceil((oy + 1) * syStep));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = region.x + Math.floor(ox * sxStep);
      const x1 = Math.min(region.x + region.width, region.x + Math.ceil((ox + 1) * sxStep));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const rowBase = y * img.width * 4;
        for (let x = x0; x < x1; x++) {
          const i = rowBase + x * 4;
          sum += toLuma(img.data[i], img.data[i + 1], img.data[i + 2]);
          count++;
        }
      }
      out[oy * outW + ox] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

export function averageHash(img: DecodedImage, region: RegionRect, size = 8): bigint {
  const luma = downsampleLuma(img, region, size, size);
  let mean = 0;
  for (let i = 0; i < luma.length; i++) mean += luma[i];
  mean /= luma.length;

  let hash = 0n;
  for (let i = 0; i < luma.length; i++) {
    hash <<= 1n;
    if (luma[i] >= mean) hash |= 1n;
  }
  return hash;
}

export function hammingDistance(a: bigint, b: bigint, bits: number): number {
  let x = a ^ b;
  let dist = 0;
  for (let i = 0; i < bits; i++) {
    if ((x & 1n) === 1n) dist++;
    x >>= 1n;
  }
  return dist;
}

export interface CompareOptions {
  tolerance?: number;       // 0–1, default 0.05 (5% mean diff allowed)
  hashSize?: number;         // default 8 → 64-bit hash
  tileGrid?: number;         // default 16
  region?: RegionRect | null;
}

export function compareImages(
  aPng: Buffer | Uint8Array | string,
  bPng: Buffer | Uint8Array | string,
  options: CompareOptions = {},
): CompareResult {
  const a = typeof aPng === 'string' ? decodeBase64Png(aPng) : decodePng(aPng);
  const b = typeof bPng === 'string' ? decodeBase64Png(bPng) : decodePng(bPng);

  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Image dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}.`);
  }

  const tolerance = options.tolerance ?? 0.05;
  const hashSize = Math.max(2, Math.min(16, options.hashSize ?? 8));
  const tileGrid = Math.max(2, Math.min(64, options.tileGrid ?? 16));

  const regionA = clipRegion(a, options.region ?? null);
  const regionB = clipRegion(b, options.region ?? null);

  const hashA = averageHash(a, regionA, hashSize);
  const hashB = averageHash(b, regionB, hashSize);
  const totalBits = hashSize * hashSize;
  const hashDistance = hammingDistance(hashA, hashB, totalBits);
  const hashSimilarity = 1 - hashDistance / totalBits;

  const tileA = downsampleLuma(a, regionA, tileGrid, tileGrid);
  const tileB = downsampleLuma(b, regionB, tileGrid, tileGrid);
  let totalDiff = 0;
  let maxDiff = 0;
  for (let i = 0; i < tileA.length; i++) {
    const diff = Math.abs(tileA[i] - tileB[i]) / 255;
    totalDiff += diff;
    if (diff > maxDiff) maxDiff = diff;
  }
  const tileMeanDiff = totalDiff / tileA.length;

  // Coarse pixel match ratio over the full region (or full image), counting near-equal pixels.
  let matched = 0;
  let total = 0;
  const w = regionA.width;
  const h = regionA.height;
  const threshold = 16; // per-channel tolerance
  const stepX = Math.max(1, Math.floor(w / 64));
  const stepY = Math.max(1, Math.floor(h / 64));
  for (let y = 0; y < h; y += stepY) {
    const ay = (regionA.y + y) * a.width;
    const by = (regionB.y + y) * b.width;
    for (let x = 0; x < w; x += stepX) {
      const ai = (ay + regionA.x + x) * 4;
      const bi = (by + regionB.x + x) * 4;
      const dr = Math.abs(a.data[ai] - b.data[bi]);
      const dg = Math.abs(a.data[ai + 1] - b.data[bi + 1]);
      const db = Math.abs(a.data[ai + 2] - b.data[bi + 2]);
      if (dr <= threshold && dg <= threshold && db <= threshold) matched++;
      total++;
    }
  }
  const pixelMatchRatio = total > 0 ? matched / total : 1;

  const pass = tileMeanDiff <= tolerance;

  return {
    width: a.width,
    height: a.height,
    hashDistance,
    hashSimilarity,
    tileMeanDiff,
    maxTileDiff: maxDiff,
    pixelMatchRatio,
    pass,
    region: options.region ? regionA : null,
  };
}
