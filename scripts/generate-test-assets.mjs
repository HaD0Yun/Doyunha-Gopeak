import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcData = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function createPNG(width, height, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0);
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b);
    }
  }
  const raw = Buffer.from(rawData);
  const compressed = deflateSync(raw);

  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]);
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

// Target the fixture used by the test runner (test-fixtures/, not scripts/test-fixtures/)
const fixturePath = join(__dirname, '..', 'test-fixtures', 'sample_project');
const assetsPath = join(fixturePath, 'assets');
ensureDir(assetsPath);

console.log('Generating PNG test assets...');

writeFileSync(join(assetsPath, 'golden_identical.png'), createPNG(1, 1, 0, 0, 0));
console.log('  Created golden_identical.png (1x1 black)');

writeFileSync(join(assetsPath, 'golden_shifted.png'), createPNG(1, 1, 255, 255, 255));
console.log('  Created golden_shifted.png (1x1 white)');

writeFileSync(join(assetsPath, 'player_sprite.png'), createPNG(64, 64, 128, 128, 128));
console.log('  Created player_sprite.png (64x64 gray)');

writeFileSync(join(assetsPath, 'parallax_layer_1.png'), createPNG(320, 240, 64, 128, 192));
console.log('  Created parallax_layer_1.png (320x240 blue-ish)');

writeFileSync(join(assetsPath, 'parallax_layer_2.png'), createPNG(320, 240, 192, 128, 64));
console.log('  Created parallax_layer_2.png (320x240 red-ish)');

console.log('\nPNG assets generated successfully!');
