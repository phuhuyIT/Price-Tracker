import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function distanceToSegment(x, y, startX, startY, endX, endY) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared));
  const closestX = startX + projection * deltaX;
  const closestY = startY + projection * deltaY;
  return Math.hypot(x - closestX, y - closestY);
}

function insideRoundedSquare(x, y) {
  const inset = 0.05;
  const radius = 0.2;
  const closestX = Math.max(inset + radius, Math.min(1 - inset - radius, x));
  const closestY = Math.max(inset + radius, Math.min(1 - inset - radius, y));
  return Math.hypot(x - closestX, y - closestY) <= radius;
}

function isWhiteMark(x, y) {
  const thickness = 0.055;
  const segments = [
    [0.23, 0.31, 0.43, 0.5],
    [0.43, 0.5, 0.62, 0.4],
    [0.62, 0.4, 0.74, 0.65],
    [0.74, 0.65, 0.61, 0.59],
    [0.74, 0.65, 0.78, 0.51],
  ];
  return segments.some((segment) => distanceToSegment(x, y, ...segment) <= thickness);
}

function createRgbaPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = (column + 0.5) / size;
      const y = (row + 0.5) / size;
      const index = (row * size + column) * 4;
      const inside = insideRoundedSquare(x, y);
      const white = inside && isWhiteMark(x, y);
      pixels[index] = white ? 255 : 238;
      pixels[index + 1] = white ? 255 : 77;
      pixels[index + 2] = white ? 255 : 45;
      pixels[index + 3] = inside ? 255 : 0;
    }
  }

  return pixels;
}

function encodePng(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = createRgbaPixels(size);
  const scanlines = Buffer.alloc((size * 4 + 1) * size);

  for (let row = 0; row < size; row += 1) {
    const outputOffset = row * (size * 4 + 1);
    scanlines[outputOffset] = 0;
    pixels.copy(scanlines, outputOffset + 1, row * size * 4, (row + 1) * size * 4);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Generate local raster icons without downloading or executing remote assets. */
export async function generateExtensionIcons(outputDirectory) {
  const sizes = [16, 32, 48, 128];

  await Promise.all(
    sizes.map((size) => writeFile(join(outputDirectory, `icon${size}.png`), encodePng(size))),
  );

  return sizes.map((size) => `icon${size}.png`);
}
