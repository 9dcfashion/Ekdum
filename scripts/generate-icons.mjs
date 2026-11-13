// One-off generator for the PWA manifest icons (public/icons/*.png).
// Draws the EkDum tile (indigo, white "E") with Node built-ins only.
// Run: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const BRAND = [0x43, 0x38, 0xca];
const SS = 4; // supersampling per axis for smooth edges

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Is the unit-square point inside the tile (rounded square, or full bleed for maskable)? */
function inTile(x, y, radius) {
  if (radius === 0) return true;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** Is the unit-square point inside the "E" glyph? `scale` shrinks it around the centre. */
function inGlyph(x, y, scale) {
  const u = (x - 0.5) / scale + 0.5;
  const v = (y - 0.5) / scale + 0.5;
  const left = 0.325;
  const right = 0.675;
  const top = 0.25;
  const bottom = 0.75;
  const stroke = 0.11;
  if (u < left || u > right || v < top || v > bottom) return false;
  if (u <= left + stroke) return true; // stem
  if (v <= top + stroke || v >= bottom - stroke) return true; // top and bottom bars
  return Math.abs(v - 0.5) <= stroke / 2 && u <= right - 0.05; // middle bar
}

function draw(size, { maskable }) {
  const radius = maskable ? 0 : 0.22;
  const glyphScale = maskable ? 0.8 : 1; // keep the glyph inside the maskable safe zone
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      let glyph = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!inTile(x, y, radius)) continue;
          tile++;
          if (inGlyph(x, y, glyphScale)) glyph++;
        }
      }
      const i = (py * size + px) * 4;
      if (tile === 0) continue;
      const white = glyph / tile;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(BRAND[c] * (1 - white) + 255 * white);
      rgba[i + 3] = Math.round((tile / (SS * SS)) * 255);
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["icon-maskable-192.png", 192, { maskable: true }],
  ["icon-maskable-512.png", 512, { maskable: true }],
];
for (const [name, size, options] of targets) {
  writeFileSync(join(OUT, name), draw(size, options));
  console.log(`wrote public/icons/${name}`);
}
