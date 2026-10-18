#!/usr/bin/env node
// Separates the glass wind chime's paper tag from the 640x360 cafe image.
//
//   public/cafe-bg.png    the cafe with the tag painted out (wood wall)
//   public/furin-tag.png  the tag on transparency, anchored at its cord
//
// Only the paper pixels (plus a two-pixel rim for the shadow) are replaced;
// plants and the beam around the tag are left untouched.
import sharp from "sharp";

const SRC = new URL("../public/cafe.png", import.meta.url).pathname;
const BG = new URL("../public/cafe-bg.png", import.meta.url).pathname;
const TAG = new URL("../public/furin-tag.png", import.meta.url).pathname;

const BOX = { x: 152, y: 68, w: 34, h: 52 };
const TAG_BOX = { x: 155, y: 72, w: 26, h: 43 };

const { data, info } = await sharp(SRC)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;

const px = (x, y) => {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

const inside = (x, y) => {
  if (y < 74 || y > 112) return false;
  const t = (y - 74) / 38;
  const l = 158 - t * 2;
  const r = 170 + t * 7;
  return x >= l && x <= r;
};

const isPaper = (r, g, b) => {
  const lum = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return (lum > 80 && sat < 0.5) || (b > r + 12 && lum > 70);
};

// ---- tag mask, dilated two pixels to swallow the drop shadow -------------
const mask = new Uint8Array(BOX.w * BOX.h);
const at = (x, y) => {
  const bx = x - BOX.x;
  const by = y - BOX.y;
  if (bx < 0 || by < 0 || bx >= BOX.w || by >= BOX.h) return false;
  return mask[by * BOX.w + bx] === 1;
};

for (let y = BOX.y; y < BOX.y + BOX.h; y++) {
  for (let x = BOX.x; x < BOX.x + BOX.w; x++) {
    const [r, g, b] = px(x, y);
    if (inside(x, y) && isPaper(r, g, b)) {
      mask[(y - BOX.y) * BOX.w + (x - BOX.x)] = 1;
    }
  }
}

for (let pass = 0; pass < 2; pass++) {
  const copy = mask.slice();
  for (let y = 0; y < BOX.h; y++) {
    for (let x = 0; x < BOX.w; x++) {
      if (copy[y * BOX.w + x]) continue;
      const near =
        (x > 0 && copy[y * BOX.w + x - 1]) ||
        (x < BOX.w - 1 && copy[y * BOX.w + x + 1]) ||
        (y > 0 && copy[(y - 1) * BOX.w + x]) ||
        (y < BOX.h - 1 && copy[(y + 1) * BOX.w + x]);
      if (near) mask[y * BOX.w + x] = 1;
    }
  }
}

// ---- background plate ----------------------------------------------------
const bg = Buffer.from(data);
const put = (x, y, r, g, b) => {
  const i = (y * W + x) * 4;
  bg[i] = r;
  bg[i + 1] = g;
  bg[i + 2] = b;
  bg[i + 3] = 255;
};

for (let y = BOX.y; y < BOX.y + BOX.h; y++) {
  for (let x = BOX.x; x < BOX.x + BOX.w; x++) {
    if (!at(x, y)) continue;
    let lx = x - 1;
    while (lx >= BOX.x && at(lx, y)) lx--;
    let rx = x + 1;
    while (rx < BOX.x + BOX.w && at(rx, y)) rx++;
    const left = px(lx < BOX.x ? BOX.x : lx, y);
    const right = px(rx >= BOX.x + BOX.w ? BOX.x + BOX.w - 1 : rx, y);
    const t = (x - lx) / (rx - lx);
    const jitter = ((x * 7 + y * 13) % 5) - 2;
    put(
      x,
      y,
      Math.round(left[0] + (right[0] - left[0]) * t) + jitter,
      Math.round(left[1] + (right[1] - left[1]) * t) + jitter,
      Math.round(left[2] + (right[2] - left[2]) * t) + jitter,
    );
  }
}

await sharp(bg, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(BG);

// ---- tag sprite ----------------------------------------------------------
const sprite = Buffer.alloc(TAG_BOX.w * TAG_BOX.h * 4);
for (let y = 0; y < TAG_BOX.h; y++) {
  for (let x = 0; x < TAG_BOX.w; x++) {
    const sx = TAG_BOX.x + x;
    const sy = TAG_BOX.y + y;
    const [r, g, b] = px(sx, sy);
    const lum = (r + g + b) / 3;
    let a = 0;
    if (inside(sx, sy)) {
      a = Math.min(1, Math.max(0, (lum - 78) / 34));
      if (b > r + 12 && lum > 70) a = Math.max(a, 0.85);
    }
    const i = (y * TAG_BOX.w + x) * 4;
    sprite[i] = r;
    sprite[i + 1] = g;
    sprite[i + 2] = b;
    sprite[i + 3] = Math.round(a * 255);
  }
}

await sharp(sprite, { raw: { width: TAG_BOX.w, height: TAG_BOX.h, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(TAG);

console.log(`bg ${W}x${H}, tag ${TAG_BOX.w}x${TAG_BOX.h} at ${TAG_BOX.x},${TAG_BOX.y}`);
