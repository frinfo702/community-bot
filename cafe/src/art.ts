import * as THREE from "three";

/** Palette sampled from the reference illustration. */
export const C = {
  ink: 0x0d0807,
  woodDeep: 0x20140e,
  woodDark: 0x382215,
  wood: 0x51301d,
  woodLight: 0x774a2b,
  woodHi: 0xa26c40,
  paper: 0xf3d9ab,
  paperWarm: 0xffd39a,
  lamp: 0xffc97e,
  flame: 0xffb066,
  indigo: 0x33456f,
  indigoDeep: 0x212c4a,
  tatami: 0x8f8b54,
  tatamiDark: 0x6f6c3c,
  sakura: 0xf0a6bd,
  sakuraHot: 0xd9799b,
  sakuraPale: 0xf9d2dc,
  leaf: 0x4c6b3d,
  cream: 0xefe3c9,
  red: 0xb03a32,
  teal: 0x3f7d78,
  moss: 0x5d6b46,
};

export interface Bitmap {
  c: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function bitmap(w: number, h: number): Bitmap {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { c, ctx };
}

/** Nearest-filtered texture: every pixel stays a hard square. */
export function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  return t;
}

export function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Five-petal crest used by the lanterns. */
export function crest(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  center = fill,
): void {
  ctx.fillStyle = fill;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52, r * 0.44, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

export function woodTexture(seed: number, planks = false): THREE.CanvasTexture {
  const { c, ctx } = bitmap(128, 128);
  const r = rng(seed);
  rect(ctx, 0, 0, 128, 128, "#5d3822");
  for (let y = 0; y < 128; y++) {
    const v = r();
    if (v < 0.12) rect(ctx, 0, y, 128, 1, "#4b2b18");
    if (v > 0.92) rect(ctx, 0, y, 128, 1, "#70452a");
    for (let x = Math.floor(r() * 80); x < 128; x += 26 + Math.floor(r() * 44)) {
      rect(ctx, x, y, 5 + Math.floor(r() * 14), 1, v > 0.55 ? "#835431" : "#4a2a16");
    }
  }
  if (planks) {
    for (let y = 0; y < 128; y += 32) {
      rect(ctx, 0, y, 128, 2, "#301d10");
      rect(ctx, 0, y + 2, 128, 1, "#8a5a38");
      const seam = Math.floor(r() * 128);
      rect(ctx, seam, y, 2, 32, "#301d10");
    }
  }
  return toTexture(c);
}

export function tatamiTexture(): THREE.CanvasTexture {
  const { c, ctx } = bitmap(128, 128);
  const r = rng(7);
  rect(ctx, 0, 0, 128, 128, "#8f8b54");
  for (let y = 0; y < 128; y += 2) {
    rect(ctx, 0, y, 128, 1, y % 4 === 0 ? "#9c9860" : "#85814c");
    for (let x = 0; x < 128; x += 6) {
      rect(ctx, x + Math.floor(r() * 4), y + 1, 2 + Math.floor(r() * 2), 1, "#7c7848");
    }
  }
  for (let x = 0; x < 128; x += 64) {
    rect(ctx, x, 0, 2, 128, "#5b6b45");
  }
  rect(ctx, 0, 0, 128, 2, "#5b6b45");
  rect(ctx, 0, 126, 128, 2, "#5b6b45");
  return toTexture(c);
}

export function shojiTexture(): THREE.CanvasTexture {
  const { c, ctx } = bitmap(128, 192);
  const grad = ctx.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, "#f6d6a2");
  grad.addColorStop(0.55, "#f9e0b8");
  grad.addColorStop(1, "#e9bc86");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 192);
  const r = rng(3);
  for (let i = 0; i < 260; i++) {
    rect(ctx, r() * 128, r() * 192, 1, 1, r() > 0.5 ? "#f2c894" : "#fde8c6");
  }
  for (let x = 0; x <= 128; x += 32) rect(ctx, x, 0, 2, 192, "#6b4327");
  for (let y = 0; y <= 192; y += 32) rect(ctx, 0, y, 128, 2, "#6b4327");
  rect(ctx, 0, 0, 128, 4, "#4e3019");
  return toTexture(c);
}

export function norenTexture(seed: number): THREE.CanvasTexture {
  const { c, ctx } = bitmap(192, 96);
  const r = rng(seed);
  rect(ctx, 0, 0, 192, 96, "#41548a");
  for (let x = 0; x < 192; x += 4) {
    rect(ctx, x, 0, 1, 96, r() > 0.5 ? "#3a4b7c" : "#4a5f96");
  }
  const shade = ctx.createLinearGradient(0, 0, 0, 96);
  shade.addColorStop(0, "rgba(20,24,44,0.3)");
  shade.addColorStop(0.45, "rgba(20,24,44,0.06)");
  shade.addColorStop(1, "rgba(255,240,210,0.06)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 192, 96);
  rect(ctx, 0, 0, 192, 3, "#eee2ca");
  rect(ctx, 0, 93, 192, 3, "#eee2ca");

  const petals: Array<[number, number]> = [
    [0, -10],
    [9, -6],
    [9, 6],
    [0, 10],
    [-9, 6],
    [-9, -6],
  ];
  for (const [dx, dy] of petals) {
    rect(ctx, 96 + dx - 3, 45 + dy - 3, 6, 6, "#f0e4cc");
  }
  rect(ctx, 93, 42, 6, 6, "#f0e4cc");
  for (const cx of [34, 158]) {
    for (const [dx, dy] of petals) {
      rect(ctx, cx + dx * 0.55 - 2, 34 + dy * 0.55 - 2, 3, 3, "#e3d6bd");
    }
  }
  for (let x = 12; x < 192; x += 24) rect(ctx, x, 4, 1, 88, "#35456f");
  return toTexture(c);
}

export function lanternTexture(seed: number): THREE.CanvasTexture {
  const { c, ctx } = bitmap(128, 128);
  const r = rng(seed);
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#e8ae68");
  grad.addColorStop(0.45, "#f8cc8e");
  grad.addColorStop(1, "#e0a05c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 6; y < 128; y += 9) rect(ctx, 0, y, 128, 1, "#c07f45");
  for (let i = 0; i < 120; i++) rect(ctx, r() * 128, r() * 128, 1, 1, "#ffe9c0");
  ctx.globalAlpha = 0.5;
  crest(ctx, 64, 64, 26, "#fff2d4");
  ctx.globalAlpha = 1;
  return toTexture(c);
}

export function scrollTexture(): THREE.CanvasTexture {
  const { c, ctx } = bitmap(64, 128);
  rect(ctx, 0, 0, 64, 128, "#e9dcc0");
  const r = rng(11);
  for (let i = 0; i < 50; i++) rect(ctx, 8 + r() * 48, 14 + r() * 82, 1, 3 + r() * 12, "#8a7a5f");
  ctx.strokeStyle = "#4a3a2c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(19, 104);
  ctx.quadraticCurveTo(35, 74, 29, 45);
  ctx.moveTo(31, 66);
  ctx.lineTo(45, 56);
  ctx.stroke();
  for (let i = 0; i < 9; i++) rect(ctx, 37 + r() * 14, 40 + r() * 24, 2, 2, "#c98a94");
  rect(ctx, 0, 0, 64, 3, "#6b4327");
  rect(ctx, 0, 125, 64, 3, "#6b4327");
  return toTexture(c);
}

/** Soft additive halo built from flat rings, so the glow stays pixel-stepped. */
export function glowTexture(): THREE.CanvasTexture {
  const { c, ctx } = bitmap(64, 64);
  const rings: Array<[number, string]> = [
    [31, "rgba(255,196,120,0.16)"],
    [24, "rgba(255,190,110,0.18)"],
    [17, "rgba(255,184,102,0.22)"],
    [11, "rgba(255,196,120,0.28)"],
    [6, "rgba(255,214,150,0.4)"],
  ];
  for (const [r, color] of rings) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 32, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c);
}

/** Warm streaks used for floor reflections. */
export function streakTexture(): THREE.CanvasTexture {
  const { c, ctx } = bitmap(64, 128);
  const r = rng(5);
  for (let y = 0; y < 128; y++) {
    const a = Math.max(0, 1 - Math.abs(y - 24) / 104);
    ctx.fillStyle = `rgba(255,178,96,${(a * 0.5).toFixed(3)})`;
    ctx.fillRect(0, y, 64, 1);
  }
  for (let i = 0; i < 60; i++) {
    rect(ctx, r() * 64, r() * 128, 1, 1, "rgba(255,220,160,0.5)");
  }
  return toTexture(c);
}

/** Hanging cherry branch, alpha cut-out, drawn branch-first then blossom clusters. */
export function branchTexture(seed: number): THREE.CanvasTexture {
  const { c, ctx } = bitmap(256, 192);
  const r = rng(seed);
  ctx.strokeStyle = "#2e1c12";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, 48);
  ctx.bezierCurveTo(80, 36, 132, 70, 202, 54);
  ctx.moveTo(94, 58);
  ctx.quadraticCurveTo(116, 106, 102, 148);
  ctx.moveTo(166, 60);
  ctx.quadraticCurveTo(192, 100, 180, 142);
  ctx.stroke();

  const petal = (x: number, y: number) => {
    const s = r() > 0.75 ? 5 : 4;
    rect(ctx, x, y, s, s - 1, r() > 0.5 ? "#f2adc2" : "#e795b0");
    rect(ctx, x + 1, y - 1, 3, 1, "#f9cfda");
    if (r() > 0.6) rect(ctx, x + 5, y + 2, 2, 2, "#f7c3d2");
  };
  const cluster = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      petal(x + (r() - 0.5) * 26, y + (r() - 0.5) * 22);
    }
  };
  for (let i = 0; i < 46; i++) {
    cluster(r() * 240 + 8, r() * 60 + 6, 5);
  }
  for (let i = 0; i < 20; i++) {
    cluster(r() * 200 + 30, r() * 96 + 48, 4);
  }
  for (let i = 0; i < 24; i++) petal(r() * 252, 64 + r() * 124);
  return toTexture(c);
}

/**
 * The garden seen through the open shoji. Painted as one pixel layer: sky,
 * shrine, cherry canopies, stone lantern. It sits far behind the room.
 */
export function gardenTexture(): THREE.CanvasTexture {
  const W = 960;
  const H = 540;
  const { c, ctx } = bitmap(W, H);
  const r = rng(21);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#4a3a5e");
  grad.addColorStop(0.38, "#8a5a72");
  grad.addColorStop(0.62, "#d08a83");
  grad.addColorStop(1, "#f0b787");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(255,196,150,${0.06 + i * 0.03})`;
    ctx.beginPath();
    ctx.arc(640, 356, 108 - i * 16, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#5a4058";
  ctx.beginPath();
  ctx.moveTo(0, 340);
  for (let x = 0; x <= W; x += 16) {
    ctx.lineTo(x, 336 - Math.sin(x * 0.0065) * 28 - r() * 6);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.fill();

  // shrine: torii and hall behind the blossoms
  const red = "#a83a34";
  rect(ctx, 636, 236, 10, 180, red);
  rect(ctx, 756, 236, 10, 180, red);
  rect(ctx, 612, 232, 176, 12, "#7d2a26");
  rect(ctx, 624, 256, 152, 8, "#c04a3e");
  rect(ctx, 660, 280, 80, 100, "#7a3a30");
  rect(ctx, 668, 292, 64, 88, "#e0a07a");
  rect(ctx, 644, 372, 140, 8, "#6a2a24");
  ctx.fillStyle = "#4a2a2c";
  ctx.beginPath();
  ctx.moveTo(596, 224);
  ctx.lineTo(704, 184);
  ctx.lineTo(812, 224);
  ctx.closePath();
  ctx.fill();

  rect(ctx, 0, 416, W, 124, "#6a5450");
  for (let i = 0; i < 900; i++) {
    rect(ctx, r() * W, 420 + r() * 116, 2 + r() * 5, 1, r() > 0.5 ? "#76605a" : "#5e4a48");
  }

  rect(ctx, 808, 352, 36, 12, "#8d8a7c");
  rect(ctx, 820, 300, 12, 52, "#8d8a7c");
  rect(ctx, 804, 280, 44, 20, "#a09c8c");
  rect(ctx, 812, 292, 28, 16, "#ffcf8a");
  ctx.fillStyle = "#66645a";
  ctx.beginPath();
  ctx.moveTo(794, 280);
  ctx.lineTo(826, 260);
  ctx.lineTo(858, 280);
  ctx.closePath();
  ctx.fill();

  const blossom = (x: number, y: number, s: number) => {
    const t = r();
    const color = t > 0.78 ? "#f8ccd8" : t > 0.5 ? "#eda2b9" : t > 0.22 ? "#d97f9f" : "#b9688a";
    rect(ctx, x, y, s, s, color);
  };
  const canopy = (cx: number, cy: number, rx: number, ry: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r());
      blossom(cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, r() > 0.7 ? 5 : 3);
    }
  };
  canopy(140, 192, 240, 124, 4200);
  canopy(500, 140, 220, 96, 3200);
  canopy(860, 176, 200, 100, 3000);
  canopy(300, 300, 160, 68, 1500);
  canopy(700, 296, 140, 60, 1200);
  canopy(1000, 260, 140, 120, 1500);

  ctx.strokeStyle = "#3a2418";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-20, 80);
  ctx.bezierCurveTo(240, 60, 380, 140, 600, 88);
  ctx.moveTo(240, 80);
  ctx.quadraticCurveTo(300, 180, 260, 280);
  ctx.stroke();

  for (let x = 0; x < W; x += 68) {
    rect(ctx, x, 380, 8, 60, "#5a3a2a");
  }
  rect(ctx, 0, 388, W, 6, "#5a3a2a");

  for (let i = 0; i < 160; i++) {
    rect(ctx, r() * W, 120 + r() * 280, 2, 2, "#f7c3d2");
  }
  return toTexture(c);
}
