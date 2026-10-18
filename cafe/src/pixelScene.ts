interface Glow {
  x: number;
  y: number;
  r: number;
  a: number;
  phase: number;
}

interface Petal {
  x: number;
  y: number;
  vy: number;
  sway: number;
  phase: number;
  size: number;
}

/** Overlay coordinates are authored against the 480x270 crop of the source. */
const W = 640;
const H = 360;
const S = W / 480;

/** Hanging lanterns and standing lamps. */
const GLOWS: Glow[] = [
  { x: 182, y: 77, r: 24, a: 0.3, phase: 0.3 },
  { x: 247, y: 104, r: 16, a: 0.22, phase: 1.7 },
  { x: 430, y: 143, r: 20, a: 0.26, phase: 2.6 },
  { x: 412, y: 18, r: 18, a: 0.2, phase: 4.1 },
  { x: 72, y: 213, r: 26, a: 0.28, phase: 5.2 },
  { x: 25, y: 52, r: 10, a: 0.14, phase: 3.3 },
];

/** Eye boxes in 640x360 pixels, measured on the plate (the head is tilted). */
const EYES = [
  { x: 401, y: 146, w: 6, h: 6 },
  { x: 415, y: 149, w: 7, h: 6 },
];
/** A clean skin pixel between the eyes, used as the lid colour. */
const SKIN_AT = { x: 410, y: 152 };
const LASH = "#3a2a2e";

/** Tag pivot in base pixels; the sprite's own anchor is (10, 4). */
const TAG_ANCHOR = { x: 165, y: 76 };

/**
 * Noren panels inside noren.png (placed at NOREN_AT). Each hangs from y = 0
 * and bends more toward its hem; `lag` delays the wind reaching it.
 */
const NOREN_AT = { x: 124, y: 0 };
const NOREN_PANELS = [
  { sx: 0, sw: 105, h: 44, lag: 0.6 },
  { sx: 105, sw: 67, h: 67, lag: 0.9 },
];
/** Heavy cloth: slower spring, more drag, and only a fraction of the wind. */
const NOREN_STIFFNESS = 4;
const NOREN_DAMPING = 2.2;
const NOREN_WIND = 0.08;

/**
 * Cherry tree through the far window. Blossom pixels borrow colour from a
 * blossom pixel a step away, so the canopy ripples while the torii, the
 * pillar and the window frame stay put.
 */
const SAKURA = { x: 470, y: 60, w: 78, h: 80 };
const SAKURA_SWAY_PX = 40;

/** Torque on the tag in rad/s^2; positive swings it to the right. */
function windForce(t: number): number {
  // a light steady breeze, plus a gust every ~20 s that dies away
  const breeze = Math.sin(t * 0.7) * 0.5 + Math.sin(t * 1.3 + 1.1) * 0.3;
  const gust = Math.max(0, Math.sin(t * 0.31)) ** 4 * Math.sin(t * 0.9) * 1.5;
  return breeze + gust;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

export async function startPixel(stage: HTMLElement): Promise<void> {
  let baseImage: HTMLImageElement;
  let tagSprite: HTMLImageElement | null = null;
  let noren: HTMLImageElement | null = null;
  try {
    baseImage = await loadImage("./cafe-bg.png");
    tagSprite = await loadImage("./furin-tag.png");
    noren = await loadImage("./noren.png");
  } catch {
    try {
      baseImage = await loadImage("./cafe.png");
      tagSprite = null;
      noren = null;
    } catch {
      const { start3d } = await import("./scene3d");
      start3d(stage);
      return;
    }
  }

  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  const bctx = base.getContext("2d")!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(baseImage, 0, 0, W, H);

  // Closed and half-closed lids: skin over the eye, then a lash line that
  // dips in the middle.
  const [sr, sg, sb] = bctx.getImageData(SKIN_AT.x, SKIN_AT.y, 1, 1).data;
  const skin = `rgb(${sr}, ${sg}, ${sb})`;
  const lids = EYES.map((eye) => {
    const make = (cover: number): HTMLCanvasElement => {
      const c = document.createElement("canvas");
      c.width = eye.w;
      c.height = eye.h;
      const g = c.getContext("2d")!;
      g.drawImage(base, eye.x, eye.y, eye.w, eye.h, 0, 0, eye.w, eye.h);
      g.fillStyle = skin;
      g.fillRect(0, 0, eye.w, cover);
      g.fillStyle = LASH;
      g.fillRect(1, cover - 1, eye.w - 2, 1);
      g.fillRect(2, cover, eye.w - 4, 1);
      return c;
    };
    return { eye, half: make(Math.ceil(eye.h / 2)), closed: make(eye.h - 1) };
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  stage.appendChild(canvas);

  function resize(): void {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = `${Math.floor(W * scale)}px`;
    canvas.style.height = `${Math.floor(H * scale)}px`;
  }
  window.addEventListener("resize", resize);
  resize();

  const petals: Petal[] = [];
  for (let i = 0; i < 30; i++) {
    petals.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vy: (6 + Math.random() * 12) * S,
      sway: 0.4 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      size: Math.random() > 0.7 ? 4 : 3,
    });
  }

  // The tag is a damped pendulum pushed by the wind.
  let angle = 0;
  let spin = 0;
  const STIFFNESS = 9;
  const DAMPING = 1.6;
  const norenState = NOREN_PANELS.map(() => ({ angle: 0, spin: 0 }));
  const tree = { angle: 0, spin: 0 };

  const sakuraSrc = bctx.getImageData(SAKURA.x, SAKURA.y, SAKURA.w, SAKURA.h);
  const sakuraOut = new ImageData(SAKURA.w, SAKURA.h);
  const srcPx = new Uint32Array(sakuraSrc.data.buffer);
  const outPx = new Uint32Array(sakuraOut.data.buffer);
  const blossom = new Uint8Array(SAKURA.w * SAKURA.h);
  for (let i = 0; i < blossom.length; i++) {
    const r = sakuraSrc.data[i * 4]!;
    const g = sakuraSrc.data[i * 4 + 1]!;
    const b = sakuraSrc.data[i * 4 + 2]!;
    blossom[i] = r > g + 12 && r >= b && (r + g + b) / 3 > 150 ? 1 : 0;
  }

  const start = performance.now();
  let last = start;

  function frame(): void {
    const now = performance.now();
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);

    // the paper tag swings on its cord; the ball and wall stay painted in the plate
    // the cherry canopy: a slow sway that grows toward the top, plus flutter
    tree.spin += (windForce(t - 1.5) * NOREN_WIND - NOREN_STIFFNESS * tree.angle - NOREN_DAMPING * tree.spin) * dt;
    tree.angle += tree.spin * dt;
    outPx.set(srcPx);
    for (let y = 0; y < SAKURA.h; y++) {
      const sway = tree.angle * SAKURA_SWAY_PX * (1 - y / SAKURA.h);
      for (let x = 0; x < SAKURA.w; x++) {
        const i = y * SAKURA.w + x;
        if (!blossom[i]) continue;
        const sx = x - Math.round(sway + Math.sin(x * 0.35 + y * 0.2 + t * 2.1) * 0.6);
        const sy = y - Math.round(Math.sin(x * 0.3 - y * 0.15 - t * 1.7) * 0.55);
        if (sx < 0 || sy < 0 || sx >= SAKURA.w || sy >= SAKURA.h) continue;
        const j = sy * SAKURA.w + sx;
        if (blossom[j]) outPx[i] = srcPx[j]!;
      }
    }
    ctx.putImageData(sakuraOut, SAKURA.x, SAKURA.y);

    // the noren sways from its rod, drawn a row at a time so the hem moves most
    if (noren) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      NOREN_PANELS.forEach((panel, i) => {
        const st = norenState[i]!;
        const force = windForce(t - panel.lag) * NOREN_WIND;
        st.spin += (force - NOREN_STIFFNESS * st.angle - NOREN_DAMPING * st.spin) * dt;
        st.angle += st.spin * dt;
        for (let y = 0; y < noren!.height; y++) {
          const dx = st.angle * panel.h * Math.min(1, y / panel.h) ** 1.5;
          ctx.drawImage(
            noren!,
            panel.sx, y, panel.sw, 1,
            NOREN_AT.x + panel.sx + dx, NOREN_AT.y + y, panel.sw, 1,
          );
        }
      });
      ctx.restore();
    }

    if (tagSprite) {
      spin += (windForce(t) - STIFFNESS * angle - DAMPING * spin) * dt;
      angle += spin * dt;
      // smoothing on for the tag only, so sub-pixel angles read as motion
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.translate(TAG_ANCHOR.x, TAG_ANCHOR.y);
      ctx.rotate(angle);
      ctx.drawImage(tagSprite, -10, -4);
      ctx.restore();
    }

    // lamp flicker
    ctx.globalCompositeOperation = "lighter";
    for (const light of GLOWS) {
      const sway = Math.sin(t * 0.62 + light.phase) * 1.5 * S;
      const x = light.x * S + sway;
      const y = light.y * S;
      const r = light.r * S;
      const flicker =
        0.86 +
        Math.sin(t * 10.7 + light.phase) * 0.08 +
        Math.sin(t * 23.1 + light.phase * 1.9) * 0.04 +
        Math.sin(t * 4.3 + light.phase * 0.7) * 0.02;
      const alpha = light.a * flicker;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255, 198, 128, ${alpha.toFixed(3)})`);
      g.addColorStop(0.5, `rgba(255, 172, 96, ${(alpha * 0.4).toFixed(3)})`);
      g.addColorStop(1, "rgba(255, 150, 70, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // warm room pulse
    ctx.fillStyle = `rgba(255, 178, 104, ${(0.012 + 0.008 * Math.sin(t * 1.7)).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";

    // steam over the matcha bowl
    for (let i = 0; i < 7; i++) {
      const k = (t * 0.22 + i / 7) % 1;
      const alpha = 0.22 * (1 - k);
      ctx.fillStyle = `rgba(255, 240, 222, ${alpha.toFixed(3)})`;
      ctx.fillRect(
        Math.round(128 * S + Math.sin(k * 5 + i) * 3 * S),
        Math.round((214 - k * 26) * S),
        Math.round(2 * S),
        Math.round(2 * S),
      );
    }

    // petals
    for (const p of petals) {
      p.y += p.vy / 60;
      if (p.y > H + 3) {
        p.y = -3;
        p.x = Math.random() * W;
      }
      const x = p.x + Math.sin(t * p.sway + p.phase) * 5 * S;
      if (Math.sin(t * p.sway * 1.7 + p.phase) > 0) {
        ctx.fillStyle = "#f2b6c8";
        ctx.fillRect(Math.round(x), Math.round(p.y), p.size, 1);
        ctx.fillStyle = "#fbe0e7";
        ctx.fillRect(Math.round(x) + 1, Math.round(p.y) - 1, 1, 1);
      } else {
        ctx.fillStyle = "#e79cb2";
        ctx.fillRect(Math.round(x), Math.round(p.y), p.size, 1);
      }
    }

    // dust in the lamplight
    for (let i = 0; i < 18; i++) {
      const x = 120 * S + ((i * 53 * S + t * 4 * S) % (300 * S));
      const y = 100 * S + ((i * 37 * S + Math.sin(t * 0.4 + i) * 8 * S) % (120 * S));
      ctx.fillStyle = "rgba(255, 214, 160, 0.35)";
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }

    // blink: half, closed, half
    const cycle = t % 4.9;
    if (cycle < 0.18) {
      const closed = cycle >= 0.05 && cycle < 0.13;
      for (const lid of lids) {
        ctx.drawImage(closed ? lid.closed : lid.half, lid.eye.x, lid.eye.y);
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
