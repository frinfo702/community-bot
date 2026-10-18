#!/usr/bin/env node
// Separates the swinging pieces from the 640x360 cafe image.
//
//   public/cafe-bg.png    the cafe with the tag and noren painted out, and the
//                         hostess's cat ears removed
//   public/furin-tag.png  the wind chime's paper tag, anchored at its cord
//   public/noren.png      the two noren panels, hung from their rod at y = 0
//
// Only the paper pixels (plus a two-pixel rim for the shadow) are replaced;
// plants and the beam around the tag are left untouched. The noren is cut by
// hand-traced outlines because its indigo is as dark as the wood behind it.
import sharp from "sharp";

const SRC = new URL("../public/cafe.png", import.meta.url).pathname;
const BG = new URL("../public/cafe-bg.png", import.meta.url).pathname;
const TAG = new URL("../public/furin-tag.png", import.meta.url).pathname;
const NOREN = new URL("../public/noren.png", import.meta.url).pathname;

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

// ---- noren outlines ------------------------------------------------------
const NOREN_BOX = { x: 124, y: 0, w: 172, h: 70 };
const NOREN_PANELS = [
  [[126, 0], [227, 0], [227, 44], [212, 42], [192, 34], [172, 29], [150, 26], [126, 26]],
  [[231, 0], [293, 0], [293, 67], [262, 57], [231, 48]],
];
// the wind chime's hanger sits in front of the left panel
const HANGER = { x: 152, y: 0, w: 20, h: 25 };

const inPoly = (poly, x, y) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const isNoren = (x, y) => {
  const cx = x + 0.5;
  const cy = y + 0.5;
  const hanger =
    x >= HANGER.x && x < HANGER.x + HANGER.w && y >= HANGER.y && y < HANGER.y + HANGER.h;
  return !hanger && NOREN_PANELS.some((p) => inPoly(p, cx, cy));
};
// one pixel wider, so a swing never reveals the old cloth edge
const norenRim = (x, y) =>
  isNoren(x, y) || isNoren(x - 1, y) || isNoren(x + 1, y) || isNoren(x, y - 1);

// ---- cat ears ------------------------------------------------------------
// The hostess is drawn without ears. Her head is redrawn as a dome; the ears
// and a thin band along the dome's edge are re-synthesised from texture
// nearby: hair inside the dome, the wall behind her outside it.
const EARS = [
  [[393, 108], [402, 111], [414, 121], [404, 130], [396, 134], [392, 130]],
  [[444, 119], [437, 122], [426, 127], [430, 138], [436, 140], [442, 132]],
];
const EARS_BOX = { x: 386, y: 104, w: 62, h: 40 };
// a slightly square dome reads as hair volume rather than a bare skull
const HEAD = { cx: 414.5, cy: 145, rx: 20, ry: 23, p: 2.5 };
const headDist = (x, y) =>
  Math.abs((x + 0.5 - HEAD.cx) / HEAD.rx) ** HEAD.p + Math.abs((y + 0.5 - HEAD.cy) / HEAD.ry) ** HEAD.p;
const inHead = (x, y) => headDist(x, y) <= 1;
const nearEar = (x, y, d) =>
  EARS.some((p) => {
    for (let oy = -d; oy <= d; oy++)
      for (let ox = -d; ox <= d; ox++) if (inPoly(p, x + ox + 0.5, y + oy + 0.5)) return true;
    return false;
  });
// the dome's top edge, from one ear to the other, is redrawn too
const onHeadEdge = (x, y) => y < 140 && Math.abs(headDist(x, y) - 1) < 0.22;
const isEarFill = (x, y) => nearEar(x, y, 1) || onHeadEdge(x, y);

// ---- background plate ----------------------------------------------------
const bg = Buffer.from(data);
const clamp = (v) => Math.max(0, Math.min(255, v));
const put = (x, y, r, g, b) => {
  const i = (y * W + x) * 4;
  bg[i] = clamp(r);
  bg[i + 1] = clamp(g);
  bg[i + 2] = clamp(b);
  bg[i + 3] = 255;
};

// Fill each masked run by blending the pixels on either side of it, along
// rows or (`vertical`) columns. A side for which `keep` is false (e.g. the
// hair next to an ear) is not sampled.
const paintOut = (box, masked, { vertical = false, keep = () => true } = {}) => {
  const [dx, dy] = vertical ? [0, 1] : [1, 0];
  const inBox = (x, y) => x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (!masked(x, y)) continue;
      let a = 1;
      while (inBox(x - a * dx, y - a * dy) && masked(x - a * dx, y - a * dy)) a++;
      let b = 1;
      while (inBox(x + b * dx, y + b * dy) && masked(x + b * dx, y + b * dy)) b++;
      // step back inside the box if the run reached its edge
      const ax = inBox(x - a * dx, y - a * dy) ? a : a - 1;
      const bx = inBox(x + b * dx, y + b * dy) ? b : b - 1;
      const [px0, py0] = [x - ax * dx, y - ax * dy];
      const [px1, py1] = [x + bx * dx, y + bx * dy];
      let near = px(px0, py0);
      let far = px(px1, py1);
      if (!keep(px0, py0)) near = far;
      if (!keep(px1, py1)) far = near;
      const t = a / (a + b);
      const jitter = ((x * 7 + y * 13) % 5) - 2;
      put(
        x,
        y,
        Math.round(near[0] + (far[0] - near[0]) * t) + jitter,
        Math.round(near[1] + (far[1] - near[1]) * t) + jitter,
        Math.round(near[2] + (far[2] - near[2]) * t) + jitter,
      );
    }
  }
};

// Pixel-by-pixel texture synthesis (Efros & Leung). Unknown pixels are
// filled from the outside in; each copies the colour of the known pixel whose
// 7x7 neighbourhood best matches its own. `side` splits the picture into two
// regions (hair / wall) and a pixel only borrows from, and is only compared
// against, its own region.
const synthesize = (box, masked, side, seed) => {
  const R = 3;
  const SEARCH = 24;
  let rand = seed;
  const random = () => ((rand = (rand * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const known = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !todo.has(y * W + x);
  const todo = new Set();
  for (let y = box.y; y < box.y + box.h; y++)
    for (let x = box.x; x < box.x + box.w; x++) if (masked(x, y)) todo.add(y * W + x);
  const cur = (x, y) => {
    const i = (y * W + x) * 4;
    return [bg[i], bg[i + 1], bg[i + 2]];
  };
  while (todo.size > 0) {
    // the unknown pixel with the most known neighbours on its side goes next
    let best = -1;
    let bestN = -1;
    for (const k of todo) {
      const x = k % W;
      const y = (k / W) | 0;
      const s = side(x, y);
      let n = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) if (known(x + ox, y + oy) && side(x + ox, y + oy) === s) n++;
      if (n > bestN) [best, bestN] = [k, n];
    }
    const tx = best % W;
    const ty = (best / W) | 0;
    const mine = side(tx, ty);
    const ctxPx = [];
    for (let oy = -R; oy <= R; oy++)
      for (let ox = -R; ox <= R; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if ((ox || oy) && known(x, y) && side(x, y) === mine) {
          ctxPx.push([ox, oy, cur(x, y), Math.exp(-(ox * ox + oy * oy) / (2 * 2.2 * 2.2))]);
        }
      }
    const scores = [];
    for (let cy = ty - SEARCH; cy <= ty + SEARCH; cy++)
      for (let cx = tx - SEARCH; cx <= tx + SEARCH; cx++) {
        if (!known(cx, cy) || side(cx, cy) !== mine || masked(cx, cy)) continue;
        let err = 0;
        let wsum = 0;
        for (const [ox, oy, c, w] of ctxPx) {
          const x = cx + ox;
          const y = cy + oy;
          if (!known(x, y) || side(x, y) !== mine) continue;
          const d = cur(x, y);
          err += w * ((d[0] - c[0]) ** 2 + (d[1] - c[1]) ** 2 + (d[2] - c[2]) ** 2);
          wsum += w;
        }
        // no shared context: any pixel on this side will do
        scores.push([wsum > 0 ? err / wsum : 1e12, cx, cy]);
      }
    scores.sort((p, q) => p[0] - q[0]);
    const limit = scores[0][0] * 1.1 + 1;
    const pool = scores.filter((s) => s[0] <= limit);
    const [, sx, sy] = pool[Math.floor(random() * pool.length)];
    const c = cur(sx, sy);
    put(tx, ty, c[0], c[1], c[2]);
    todo.delete(best);
  }
};

paintOut(BOX, at);
paintOut(NOREN_BOX, norenRim);
synthesize(EARS_BOX, isEarFill, inHead, 0x5eed);

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

// ---- noren sprite --------------------------------------------------------
const cloth = Buffer.alloc(NOREN_BOX.w * NOREN_BOX.h * 4);
for (let y = 0; y < NOREN_BOX.h; y++) {
  for (let x = 0; x < NOREN_BOX.w; x++) {
    const sx = NOREN_BOX.x + x;
    const sy = NOREN_BOX.y + y;
    if (!isNoren(sx, sy)) continue;
    const [r, g, b] = px(sx, sy);
    const i = (y * NOREN_BOX.w + x) * 4;
    cloth[i] = r;
    cloth[i + 1] = g;
    cloth[i + 2] = b;
    cloth[i + 3] = 255;
  }
}

await sharp(cloth, { raw: { width: NOREN_BOX.w, height: NOREN_BOX.h, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(NOREN);

console.log(`bg ${W}x${H}, tag ${TAG_BOX.w}x${TAG_BOX.h} at ${TAG_BOX.x},${TAG_BOX.y}, noren at ${NOREN_BOX.x},${NOREN_BOX.y}`);
