// -----------------------------------------------------------------------------
// Generates cover.png (800×534, the store size): a dark home-cinema gradient,
// a black HDMI box with its small OLED display and four HDMI ports, and
// coloured signal lines going out to a screen. Plain Node (zlib), no
// dependency. Run: npm run cover
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WIDTH = 800;
const HEIGHT = 534;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
/** Antialiased coverage of a signed distance (negative inside). */
const inside = (distance) => Math.min(1, Math.max(0, 0.5 - distance));

/** Signed distance to a rounded rectangle centred on (cx, cy). */
function roundRect(x, y, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance to the segment (ax, ay)-(bx, by). */
function segment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

const DARK = [9, 10, 16];
const NIGHT = [30, 22, 48];
const BODY = [22, 23, 28];
const BODY_LIGHT = [58, 60, 70];
const PORT = [6, 6, 8];
const PORT_RIM = [120, 122, 132];
const OLED = [10, 30, 40];
const OLED_TEXT = [90, 220, 255];
const SCREEN = [230, 232, 240];
const SCREEN_EDGE = [36, 36, 44];
const LINES = [
  [255, 90, 120],
  [90, 200, 255],
  [140, 255, 150],
];

const BOX = { cx: 260, cy: 330, w: 190, h: 52, r: 12 };
const SCR = { cx: 640, cy: 190, w: 120, h: 72 };

function pixel(x, y) {
  let color = mix(DARK, NIGHT, (x / WIDTH) * 0.5 + (1 - y / HEIGHT) * 0.5);
  // The screen.
  color = mix(color, SCREEN_EDGE, inside(roundRect(x, y, SCR.cx, SCR.cy, SCR.w + 6, SCR.h + 6, 4)));
  const glow = 1 - Math.hypot((x - SCR.cx) / (SCR.w * 1.5), (y - SCR.cy) / (SCR.h * 1.5));
  color = mix(
    color,
    mix(SCREEN, LINES[1], 0.15 + glow * 0.2),
    inside(roundRect(x, y, SCR.cx, SCR.cy, SCR.w, SCR.h, 2)),
  );
  // Three signal lines from the box to the screen, slightly curved.
  for (const [i, line] of LINES.entries()) {
    const ay = BOX.cy - 20 + i * 20;
    const by = SCR.cy + SCR.h + 30 + i * 14;
    const midX = 520;
    const d = Math.min(
      segment(x, y, BOX.cx + BOX.w, ay, midX, ay),
      segment(x, y, midX, ay, SCR.cx - 40 + i * 40, by),
    );
    color = mix(color, line, inside(d - 2.5) * 0.9);
    color = mix(color, line, Math.max(0, 1 - d / 14) * 0.18);
  }
  // Floor shadow under the box.
  const shadow = Math.hypot((x - BOX.cx) / 230, (y - 400) / 14);
  color = mix(color, [0, 0, 0], (1 - shadow) * 0.8);
  // The box, lit from above.
  const body = roundRect(x, y, BOX.cx, BOX.cy, BOX.w, BOX.h, BOX.r);
  color = mix(color, mix(BODY_LIGHT, BODY, (y - BOX.cy + BOX.h) / (2 * BOX.h)), inside(body));
  // The OLED display and its lines of text.
  color = mix(color, OLED, inside(roundRect(x, y, 150, 318, 58, 18, 3)));
  for (let i = 0; i < 2; i += 1) {
    const bar = roundRect(x, y, 140 - i * 12, 310 + i * 16, 40 - i * 12, 3, 1.5);
    color = mix(color, OLED_TEXT, inside(bar) * 0.9);
  }
  // Four HDMI ports: a trapezoid-ish slot with a rim.
  for (let i = 0; i < 4; i += 1) {
    const px = 260 + i * 44;
    color = mix(color, PORT_RIM, inside(roundRect(x, y, px, 336, 17, 8, 2)));
    const taper = (y - 330) / 14;
    color = mix(color, PORT, inside(roundRect(x, y, px, 336, 14 - Math.max(0, taper) * 3, 5, 1)));
  }
  // A status LED.
  color = mix(color, [80, 230, 140], inside(Math.hypot(x - 420, y - 300) - 3.5));
  return color;
}

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../cover.png', import.meta.url), png);
console.log(`cover.png: ${WIDTH}×${HEIGHT}, ${png.length} bytes`);
