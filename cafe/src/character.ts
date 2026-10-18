import * as THREE from "three";

const W = 144;
const H = 216;

const P = {
  hairDeep: "#17121a",
  hair: "#241d28",
  hairMid: "#2e2534",
  hairHi: "#453a4e",
  skin: "#f6dccb",
  skinShade: "#e5bca9",
  skinDeep: "#cf9f8d",
  kimono: "#f2e6d0",
  kimonoShade: "#dfcfb6",
  kimonoDeep: "#cbb99e",
  collar: "#b8b1bc",
  collarDark: "#948e9c",
  obi: "#241f26",
  gold: "#c9a25c",
  goldHi: "#e4c489",
  red: "#b0392f",
  redDark: "#872823",
  iris: "#5d8f98",
  irisDark: "#2f5058",
  white: "#f8f3e9",
  blush: "#e3a09b",
  patternGold: "#dcc08b",
  patternGrey: "#a9a4b2",
};

interface Pose {
  headX: number;
  headY: number;
  blink: boolean;
  ear: number;
  gaze: number;
}

export function createCharacter(): { mesh: THREE.Mesh; update: (t: number) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 1.425),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.35,
      toneMapped: false,
    }),
  );

  let lastFrame = -1;

  function update(t: number): void {
    const frame = Math.floor(t * 8);
    if (frame === lastFrame) return;
    lastFrame = frame;

    const blinkCycle = t % 5.1;
    const blink = blinkCycle < 0.14 || (blinkCycle > 0.28 && blinkCycle < 0.4);
    const lean = Math.sin(t * 0.29);
    const gaze = Math.sin(t * 0.37) > 0.75 ? 1 : Math.sin(t * 0.23) < -0.8 ? -1 : 0;

    draw(ctx, {
      headX: lean > 0.88 ? 1 : 0,
      headY: Math.sin(t * 1.05) > 0 ? 0 : 1,
      blink,
      ear: t % 6.7 < 0.2 ? 2 : 0,
      gaze,
    });
    texture.needsUpdate = true;
  }

  update(0);
  return { mesh, update };
}

function ell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function flower(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  center: string,
): void {
  ctx.fillStyle = fill;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.54, cy + Math.sin(a) * r * 0.54, r * 0.44, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, p: Pose): void {
  const hx = 72 + p.headX;
  const hy = 82 + p.headY;
  ctx.clearRect(0, 0, W, H);

  // ---- hair behind the body -------------------------------------------
  // mass behind the skull
  ctx.fillStyle = P.hairDeep;
  ctx.beginPath();
  ctx.ellipse(72, 78, 31, 37, 0, 0, Math.PI * 2);
  ctx.fill();

  // two long locks falling past the shoulders
  ctx.fillStyle = P.hair;
  ctx.beginPath();
  ctx.moveTo(46, 64);
  ctx.bezierCurveTo(30, 104, 25, 158, 31, H);
  ctx.lineTo(56, H);
  ctx.bezierCurveTo(50, 168, 53, 118, 62, 82);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(98, 64);
  ctx.bezierCurveTo(114, 104, 119, 158, 113, H);
  ctx.lineTo(88, H);
  ctx.bezierCurveTo(94, 168, 91, 118, 82, 82);
  ctx.closePath();
  ctx.fill();

  for (const x of [33, 43, 101, 111]) {
    ctx.fillStyle = x % 20 === 0 ? P.hairHi : P.hairMid;
    for (let y = 128; y < 206; y += 13) {
      ctx.fillRect(x, y, 1, 8);
    }
  }

  // ---- ears ------------------------------------------------------------
  drawEar(ctx, -1, hx, hy, p.ear);
  drawEar(ctx, 1, hx, hy, p.ear);

  // ---- body ------------------------------------------------------------
  // torso
  ctx.fillStyle = P.kimono;
  ctx.beginPath();
  ctx.moveTo(48, H);
  ctx.bezierCurveTo(47, 178, 51, 130, 58, 112);
  ctx.quadraticCurveTo(72, 104, 86, 112);
  ctx.bezierCurveTo(93, 130, 97, 178, 96, H);
  ctx.closePath();
  ctx.fill();

  // wide sleeves
  for (const s of [-1, 1] as const) {
    const ax = 72 + s * 13;
    ctx.fillStyle = P.kimono;
    ctx.beginPath();
    ctx.moveTo(ax, 112);
    ctx.bezierCurveTo(72 + s * 40, 132, 72 + s * 60, 150, 72 + s * 64, 178);
    ctx.bezierCurveTo(72 + s * 66, 196, 72 + s * 62, 208, 72 + s * 54, H);
    ctx.lineTo(72 + s * 36, H);
    ctx.bezierCurveTo(72 + s * 38, 196, 72 + s * 34, 170, 72 + s * 20, 156);
    ctx.closePath();
    ctx.fill();
  }

  // sleeve shadow + folds
  ctx.fillStyle = P.kimonoShade;
  for (const s of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(72 + s * 54, 170);
    ctx.quadraticCurveTo(72 + s * 62, 186, 72 + s * 52, 212);
    ctx.lineTo(72 + s * 44, 210);
    ctx.quadraticCurveTo(72 + s * 52, 188, 72 + s * 46, 172);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = P.kimonoShade;
  ctx.lineWidth = 1;
  for (const [x1, y1, x2, y2] of [
    [40, 160, 34, 196],
    [104, 160, 110, 196],
    [62, 150, 60, 176],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // kimono pattern: gold and grey-blue blossoms
  flower(ctx, 26, 178, 8, P.patternGold, P.kimono);
  flower(ctx, 40, 196, 7, P.patternGrey, P.kimono);
  flower(ctx, 18, 200, 6, P.patternGold, P.kimono);
  flower(ctx, 118, 178, 8, P.patternGrey, P.kimono);
  flower(ctx, 104, 198, 7, P.patternGold, P.kimono);
  flower(ctx, 126, 202, 5, P.patternGrey, P.kimono);
  flower(ctx, 60, 136, 6, P.patternGrey, P.kimono);
  flower(ctx, 86, 140, 5, P.patternGold, P.kimono);

  // obi: black ground, gold blossoms, red cord with a tassel
  ctx.fillStyle = P.obi;
  ctx.beginPath();
  ctx.moveTo(53, 150);
  ctx.quadraticCurveTo(72, 146, 91, 150);
  ctx.lineTo(93, 180);
  ctx.quadraticCurveTo(72, 184, 51, 180);
  ctx.closePath();
  ctx.fill();
  flower(ctx, 61, 160, 4, P.gold, P.goldHi);
  flower(ctx, 83, 158, 4, P.gold, P.goldHi);
  flower(ctx, 72, 168, 4, P.gold, P.goldHi);
  ctx.fillStyle = P.red;
  ctx.fillRect(53, 174, 38, 3);
  ctx.fillStyle = P.goldHi;
  ctx.fillRect(70, 172, 6, 7);
  ctx.fillStyle = P.redDark;
  ctx.fillRect(72, 179, 2, 10);
  ctx.fillRect(70, 186, 6, 3);

  // collar
  ctx.fillStyle = P.collar;
  ctx.beginPath();
  ctx.moveTo(61, 110);
  ctx.lineTo(72, 142);
  ctx.lineTo(83, 110);
  ctx.lineTo(88, 114);
  ctx.lineTo(72, 152);
  ctx.lineTo(56, 114);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = P.collarDark;
  ctx.fillRect(70, 122, 2, 18);
  ctx.fillStyle = P.white;
  ctx.beginPath();
  ctx.moveTo(60, 112);
  ctx.lineTo(72, 140);
  ctx.lineTo(70, 143);
  ctx.lineTo(58, 115);
  ctx.closePath();
  ctx.fill();

  // neck
  ctx.fillStyle = P.skinShade;
  ctx.fillRect(66, 102, 12, 16);
  ctx.fillStyle = P.skinDeep;
  ctx.fillRect(66, 102, 12, 3);

  // ---- face ------------------------------------------------------------
  ell(ctx, hx, hy, 25, 27, P.skin);
  // soft side shadow
  ctx.globalAlpha = 0.25;
  ell(ctx, hx + 19, hy + 4, 7, 22, P.skinShade);
  ctx.globalAlpha = 1;

  // hair cap
  ctx.fillStyle = P.hair;
  ctx.beginPath();
  ctx.ellipse(hx, hy - 4, 27, 31, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // hime-cut fringe with a few blunt tips
  ctx.beginPath();
  ctx.moveTo(hx - 27, hy - 22);
  ctx.quadraticCurveTo(hx, hy - 44, hx + 27, hy - 22);
  ctx.lineTo(hx + 27, hy - 8);
  ctx.lineTo(hx + 21, hy - 2);
  ctx.lineTo(hx + 16, hy - 9);
  ctx.lineTo(hx + 10, hy - 1);
  ctx.lineTo(hx + 4, hy - 8);
  ctx.lineTo(hx - 2, hy - 1);
  ctx.lineTo(hx - 8, hy - 8);
  ctx.lineTo(hx - 14, hy - 2);
  ctx.lineTo(hx - 21, hy - 9);
  ctx.lineTo(hx - 27, hy - 3);
  ctx.closePath();
  ctx.fill();

  // glossy strands
  ctx.fillStyle = P.hairHi;
  for (const [x, y, h] of [
    [hx - 18, hy - 30, 13],
    [hx - 6, hy - 32, 10],
    [hx + 8, hy - 33, 12],
    [hx + 18, hy - 29, 9],
  ] as const) {
    ctx.fillRect(x, y, 1, h);
  }

  // face-framing locks
  for (const s of [-1, 1] as const) {
    ctx.fillStyle = P.hair;
    ctx.beginPath();
    ctx.moveTo(hx + s * 24, hy - 22);
    ctx.bezierCurveTo(hx + s * 32, hy + 6, hx + s * 30, hy + 40, hx + s * 26, hy + 64);
    ctx.lineTo(hx + s * 17, hy + 62);
    ctx.bezierCurveTo(hx + s * 21, hy + 32, hx + s * 20, hy + 6, hx + s * 15, hy - 14);
    ctx.closePath();
    ctx.fill();
  }

  // brows
  ctx.fillStyle = P.hairMid;
  ctx.beginPath();
  ctx.moveTo(hx - 20, hy - 4);
  ctx.quadraticCurveTo(hx - 13, hy - 7, hx - 6, hy - 5);
  ctx.lineTo(hx - 6, hy - 3);
  ctx.quadraticCurveTo(hx - 13, hy - 5, hx - 19, hy - 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx + 6, hy - 5);
  ctx.quadraticCurveTo(hx + 13, hy - 7, hx + 20, hy - 4);
  ctx.lineTo(hx + 19, hy - 2);
  ctx.quadraticCurveTo(hx + 13, hy - 5, hx + 6, hy - 3);
  ctx.closePath();
  ctx.fill();

  // eyes
  for (const s of [-1, 1] as const) {
    const ex = hx + s * 12;
    const ey = hy + 6;
    if (p.blink) {
      ctx.fillStyle = P.hair;
      ctx.fillRect(ex - 5, ey, 10, 1);
      ctx.fillRect(ex - 5, ey + 1, 3, 1);
      continue;
    }
    ell(ctx, ex, ey, 5.5, 6.5, P.white);
    ell(ctx, ex + p.gaze * 0.6, ey + 0.5, 4.4, 5.6, P.iris);
    ell(ctx, ex + p.gaze * 0.6, ey - 1, 4.4, 3.4, P.irisDark);
    ell(ctx, ex + p.gaze * 0.6, ey + 1, 2.0, 3.4, "#1d343a");
    ctx.fillStyle = P.white;
    ctx.fillRect(ex - 3, ey - 3, 2, 2);
    ctx.fillRect(ex + 2, ey + 3, 1, 1);
    // lashes
    ctx.strokeStyle = P.hair;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ex, ey, 6, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.fillStyle = P.hair;
    ctx.fillRect(ex + s * 5 - (s > 0 ? 0 : 2), ey - 5, 3, 2);
    ctx.strokeStyle = P.skinDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ex, ey + 1, 5, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }

  // nose, mouth, blush
  ctx.fillStyle = P.skinDeep;
  ctx.fillRect(hx, hy + 16, 1, 1);
  ctx.strokeStyle = "#c37c78";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 3, hy + 21);
  ctx.quadraticCurveTo(hx, hy + 24, hx + 3, hy + 21);
  ctx.stroke();
  ctx.globalAlpha = 0.4;
  ell(ctx, hx - 17, hy + 15, 5, 2.4, P.blush);
  ell(ctx, hx + 17, hy + 15, 5, 2.4, P.blush);
  ctx.globalAlpha = 1;

  // ---- kanzashi --------------------------------------------------------
  flower(ctx, hx + 29, hy - 20, 7, P.red, P.gold);
  ell(ctx, hx + 33, hy - 14, 2.5, 2.5, P.gold);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 === 0 ? P.gold : P.goldHi;
    ctx.fillRect(hx + 27 + i * 3, hy - 12, 2, 4);
  }
  ctx.fillStyle = P.red;
  ctx.fillRect(hx + 30, hy - 8, 2, 16);
  ctx.fillStyle = P.redDark;
  ctx.fillRect(hx + 28, hy + 8, 6, 3);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = P.red;
    ctx.fillRect(hx + 27 + i * 2, hy + 11, 1, 12);
  }

  // ---- arm resting on the table, hand under the cheek ------------------
  ctx.fillStyle = P.kimono;
  ctx.beginPath();
  ctx.moveTo(hx - 24, hy + 42);
  ctx.bezierCurveTo(hx - 46, hy + 32, hx - 54, hy + 2, hx - 38, hy - 4);
  ctx.lineTo(hx - 24, hy + 10);
  ctx.bezierCurveTo(hx - 32, hy + 22, hx - 28, hy + 34, hx - 14, hy + 40);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = P.kimonoShade;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hx - 40, hy + 26);
  ctx.quadraticCurveTo(hx - 36, hy + 36, hx - 26, hy + 40);
  ctx.stroke();

  // cuff
  ctx.fillStyle = P.kimonoShade;
  ctx.fillRect(hx - 33, hy + 4, 9, 3);

  // hand
  const handX = hx - 21;
  const handY = hy + 10;
  ell(ctx, handX, handY, 6, 7, P.skin);
  ctx.fillStyle = P.skin;
  ctx.beginPath();
  ctx.moveTo(handX - 5, handY - 7);
  ctx.quadraticCurveTo(handX + 1, handY - 10, handX + 4, handY - 4);
  ctx.lineTo(handX + 1, handY + 2);
  ctx.lineTo(handX - 5, handY + 1);
  ctx.closePath();
  ctx.fill();

  // fingers curled against the cheek
  ctx.fillStyle = P.skin;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(handX - 2 + i * 3, handY - 8, 2, 6);
  }
  ctx.fillStyle = P.skinShade;
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(handX - 4 + i * 3, handY - 3, 1, 4);
  }
  ctx.fillRect(handX - 5, handY + 2, 9, 1);
  ctx.fillStyle = P.skinDeep;
  ctx.fillRect(handX - 4, handY + 5, 7, 1);
}

function drawEar(
  ctx: CanvasRenderingContext2D,
  side: -1 | 1,
  hx: number,
  hy: number,
  twitch: number,
): void {
  const ax = hx + side * 30;
  const ay = hy - 24;
  const bx = hx + side * 44;
  const by = hy - 66 - twitch;
  const cx = hx + side * 6;
  const cy = hy - 38;

  // dark outer shell
  ctx.fillStyle = P.hair;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.quadraticCurveTo(bx + side * 2, by + 14, bx, by);
  ctx.quadraticCurveTo(cx - side * 2, cy - 10, cx, cy);
  ctx.quadraticCurveTo(hx + side * 18, hy - 30, ax, ay);
  ctx.closePath();
  ctx.fill();

  // white inner fur, smaller than the shell so the tip stays dark
  const ax2 = hx + side * 27;
  const ay2 = hy - 27;
  const bx2 = hx + side * 38;
  const by2 = hy - 56 - twitch;
  const cx2 = hx + side * 10;
  const cy2 = hy - 39;
  ctx.fillStyle = "#efe4d5";
  ctx.beginPath();
  ctx.moveTo(ax2, ay2);
  ctx.quadraticCurveTo(bx2 + side * 2, by2 + 12, bx2, by2);
  ctx.quadraticCurveTo(cx2, cy2 - 6, cx2, cy2);
  ctx.quadraticCurveTo(hx + side * 17, hy - 31, ax2, ay2);
  ctx.closePath();
  ctx.fill();

  // fluffy tufts breaking the inner edge
  ctx.fillStyle = P.white;
  for (let i = 0; i < 3; i++) {
    const k = 0.25 + i * 0.25;
    const tx = ax2 + (bx2 - ax2) * k;
    const ty = ay2 + (by2 - ay2) * k;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + side * 6, ty - 3);
    ctx.lineTo(tx + side * 3, ty + 5);
    ctx.closePath();
    ctx.fill();
  }

  // pink only at the base
  ctx.fillStyle = "#d9a3a9";
  ctx.beginPath();
  ctx.moveTo(hx + side * 23, hy - 30);
  ctx.quadraticCurveTo(hx + side * 30, hy - 44, hx + side * 30, hy - 46);
  ctx.quadraticCurveTo(hx + side * 16, hy - 42, hx + side * 14, hy - 36);
  ctx.closePath();
  ctx.fill();
}
