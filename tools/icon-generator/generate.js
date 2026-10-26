/**
 * Launcher icon generator.
 *
 * Draws the DukanDost logo (teal rounded square + white shopping basket) into
 * RGBA buffers and writes real PNG files for every Android density, using only
 * Node built-ins (zlib) so the build never depends on ImageMagick, Inkscape or
 * a design suite. Run it with `node tools/icon-generator/generate.js`.
 *
 * The editable vector source of the same mark lives in
 * assets/branding/logo.svg and android/.../drawable/ic_launcher_foreground.xml.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ---- brand ------------------------------------------------------------------
const TEAL = [0x0f, 0x76, 0x6e]; // #0F766E (colors.primary)
const WHITE = [0xff, 0xff, 0xff];
const SS = 4; // supersampling factor for antialiased edges

// ---- signed distance functions ---------------------------------------------
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdRingArc(px, py, radius, thickness, fromDeg, toDeg) {
  const len = Math.hypot(px, py);
  const ang = (Math.atan2(py, px) * 180) / Math.PI;
  const lo = Math.min(fromDeg, toDeg);
  const hi = Math.max(fromDeg, toDeg);
  if (ang >= lo && ang <= hi) {
    return Math.abs(len - radius) - thickness;
  }
  // distance to the two arc endpoints
  const e1x = radius * Math.cos((lo * Math.PI) / 180);
  const e1y = radius * Math.sin((lo * Math.PI) / 180);
  const e2x = radius * Math.cos((hi * Math.PI) / 180);
  const e2y = radius * Math.sin((hi * Math.PI) / 180);
  return Math.min(Math.hypot(px - e1x, py - e1y), Math.hypot(px - e2x, py - e2y)) - thickness;
}

// ---- the mark ---------------------------------------------------------------
/** True when the point (x, y) in a normalised [-1, 1] icon space is inside the basket. */
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Basket body: a trapezoid, wider at the rim than at the base.
const BODY = [
  [-0.52, -0.16],
  [0.52, -0.16],
  [0.34, 0.52],
  [-0.34, 0.52],
];

function inBasket(x, y) {
  // handle: upper arc that springs from the rim of the body
  const handle = sdRingArc(x, y + 0.16, 0.24, 0.05, -168, -12);
  if (handle > 0 && !inPolygon(x, y, BODY)) {return false;}
  // two woven slots, removed from the body
  const inSlot =
    Math.abs(y - 0.06) < 0.035 && Math.abs(x) < 0.34 - (y - 0.06) * 0.18
      ? true
      : Math.abs(y - 0.26) < 0.035 && Math.abs(x) < 0.30 - (y - 0.26) * 0.18;
  return !inSlot;
}

function coverSize(size) {
  // Rounded-square background fills the whole canvas (the launcher applies its
  // own mask on adaptive icons; legacy icons keep the rounded look).
  return {
    bg: { cx: 0, cy: 0, halfW: 0.94, halfH: 0.94, r: 0.22 },
  };
}

function drawIcon(size) {
  const s = size * SS;
  const buf = Buffer.alloc(s * s * 4);
  const shapes = coverSize(size);
  for (let py = 0; py < s; py += 1) {
    for (let px = 0; px < s; px += 1) {
      const x = (px / s) * 2 - 1;
      const y = (py / s) * 2 - 1;
      const bgDist = sdRoundRect(x, y, shapes.bg.cx, shapes.bg.cy, shapes.bg.halfW, shapes.bg.halfH, shapes.bg.r);
      // coverage of the rounded square (1 inside, 0 outside)
      const bgCover = bgDist <= -0.5 / s ? 1 : bgDist >= 0.5 / s ? 0 : 0.5 - bgDist * s;
      const inside = inBasket(x, y);
      const i = (py * s + px) * 4;
      const fg = inside ? WHITE : TEAL;
      buf[i] = Math.round(fg[0] * bgCover);
      buf[i + 1] = Math.round(fg[1] * bgCover);
      buf[i + 2] = Math.round(fg[2] * bgCover);
      buf[i + 3] = Math.round(255 * bgCover);
    }
  }
  return downscale(buf, s, size);
}

function downscale(src, srcSize, dstSize) {
  const factor = srcSize / dstSize;
  const dst = Buffer.alloc(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y += 1) {
    for (let x = 0; x < dstSize; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = (((y * factor + sy) * srcSize) + (x * factor + sx)) * 4;
          const alpha = src[i + 3] / 255;
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += src[i + 3];
        }
      }
      const n = factor * factor;
      const dstI = (y * dstSize + x) * 4;
      dst[dstI] = Math.round(r / n);
      dst[dstI + 1] = Math.round(g / n);
      dst[dstI + 2] = Math.round(b / n);
      dst[dstI + 3] = Math.round(a / n);
    }
  }
  return dst;
}

// ---- minimal PNG encoder ----------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- output -----------------------------------------------------------------
const DENSITIES = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const resDir = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'res');
const assetsDir = path.join(__dirname, '..', '..', 'assets', 'branding');
fs.mkdirSync(assetsDir, { recursive: true });

for (const [density, size] of Object.entries(DENSITIES)) {
  const png = encodePng(size, drawIcon(size));
  const dir = path.join(resDir, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), png);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), png);
  console.log(`mipmap-${density}: ${size}x${size} (${png.length} bytes)`);
}

const preview = encodePng(256, drawIcon(256));
fs.writeFileSync(path.join(assetsDir, 'logo-preview.png'), preview);
console.log(`assets/branding/logo-preview.png: 256x256 (${preview.length} bytes)`);
