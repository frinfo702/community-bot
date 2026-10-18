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

/** The garden seen through the shoji; the only region safe to parallax. */
const WINDOW = { x: 353, y: 27, w: 37, h: 104 };

const EYES = [
  { x: 301, y: 112 },
  { x: 311, y: 112 },
];

export async function startPixel(stage: HTMLElement): Promise<void> {
  const image = new Image();
  image.src = "./cafe.png";
  try {
    await image.decode();
  } catch {
    const { start3d } = await import("./scene3d");
    start3d(stage);
    return;
  }

  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  const bctx = base.getContext("2d")!;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(image, 0, 0, W, H);

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

  const start = performance.now();

  function frame(): void {
    const t = (performance.now() - start) / 1000;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0);

    // garden parallax: the outside sits one pixel behind the room
    const wx = Math.round(WINDOW.x * S);
    const wy = Math.round(WINDOW.y * S);
    const ww = Math.round(WINDOW.w * S);
    const wh = Math.round(WINDOW.h * S);
    const dx = Math.round(Math.sin(t * 0.33) * S);
    const dy = Math.round(Math.sin(t * 0.21 + 1.2) * S);
    ctx.drawImage(base, wx, wy, ww, wh, wx + dx, wy + dy, ww, wh);

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

    // blink: a skin patch and a lash line over each eye
    const cycle = t % 4.9;
    if (cycle < 0.13) {
      for (const eye of EYES) {
        const x = Math.round(eye.x * S);
        const y = Math.round(eye.y * S);
        ctx.fillStyle = "#e2b99e";
        ctx.fillRect(x, y, Math.round(5 * S), Math.round(4 * S));
        ctx.fillStyle = "#4c3a3a";
        ctx.fillRect(x, y + Math.round(3 * S), Math.round(5 * S), 1);
      }
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
