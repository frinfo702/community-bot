import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Regenerates anatomy.svg. Run: node doc/site/diagrams/generate.mjs
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "anatomy.svg");

const C = Math.cos(Math.PI / 6);
const S = 0.5;
const ox = 320;
const oy = 330;

const p = (x, y, z = 0) => [ox + (x - y) * C, oy + (x + y) * S - z];
const n = (v) => v.toFixed(1);

function poly(points, fill, stroke = "#343a40", extra = "") {
  return `<polygon points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="1" ${extra}/>`;
}

function box(x, y, z, w, d, h, opts = {}) {
  const H = z + h;
  const top = [p(x, y, H), p(x + w, y, H), p(x + w, y + d, H), p(x, y + d, H)];
  const left = [p(x, y + d, H), p(x + w, y + d, H), p(x + w, y + d, z), p(x, y + d, z)];
  const right = [p(x + w, y, H), p(x + w, y + d, H), p(x + w, y + d, z), p(x + w, y, z)];
  return (
    poly(left, opts.left ?? "#191d20", opts.stroke ?? "#343a40") +
    poly(right, opts.right ?? "#101214", opts.stroke ?? "#343a40") +
    poly(top, opts.top ?? "#262b2f", opts.stroke ?? "#343a40") +
    (opts.detail ?? "")
  );
}

function line(a, b, opts = {}) {
  return `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${opts.stroke ?? "#d8a657"}" stroke-width="${opts.width ?? 1.4}" ${opts.dash ? `stroke-dasharray="${opts.dash}"` : ""} ${opts.flow ? 'class="flow"' : ""} stroke-linecap="round" opacity="${opts.opacity ?? 0.8}" ${opts.marker ? `marker-end="url(#${opts.marker})"` : ""}/>`;
}

function curve(d, opts = {}) {
  return `<path d="${d}" fill="none" stroke="${opts.stroke ?? "#d8a657"}" stroke-width="${opts.width ?? 1.3}" ${opts.dash ? `stroke-dasharray="${opts.dash}"` : ""} ${opts.flow ? 'class="flow"' : ""} stroke-linecap="round" opacity="${opts.opacity ?? 0.7}" ${opts.marker ? `marker-end="url(#${opts.marker})"` : ""}/>`;
}

function port([x, y], color = "#d8a657", r = 2.5) {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="#0b0d0e" stroke="${color}" stroke-width="1.2"/>`;
}

function label(x, y, name, sub, align = "left") {
  const anchor = align === "right" ? "end" : align === "center" ? "middle" : "start";
  return `<g text-anchor="${anchor}"><text x="${x}" y="${y}" class="d-name">${name}</text>${
    sub ? `<text x="${x}" y="${y + 18}" class="d-sub">${sub}</text>` : ""
  }</g>`;
}

function leader([x1, y1], [x2, y2], tone = "#495057") {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${tone}" stroke-width="1" stroke-dasharray="1 3" opacity=".85"/><circle cx="${n(x1)}" cy="${n(y1)}" r="1.7" fill="${tone}"/>`;
}

function cubeAt(cx, cy, size, opts = {}, logo = null) {
  const w = size;
  const d = size * 0.8;
  const h = size * 0.52;
  const local = box(0, 0, 0, w, d, h, opts);
  const topCenter = p(w / 2, d / 2, h);
  const dx = cx - topCenter[0];
  const dy = cy - topCenter[1];
  const quad = [p(0, 0, h), p(w, 0, h), p(w, d, h), p(0, d, h)].map(([x, y]) => [x + dx, y + dy]);
  return `<g transform="translate(${n(dx)} ${n(dy)})">${local}</g>${
    logo ? sticker(logo, quad, { x: 0.3, y: 0.24, w: 0.4, h: 0.52 }) : ""
  }`;
}

const n3 = (v) => v.toFixed(3);
const topFace = (x, y, z, w, d, h) => [
  p(x, y, z + h),
  p(x + w, y, z + h),
  p(x + w, y + d, z + h),
  p(x, y + d, z + h),
];

// Service marks are painted onto the top faces. The Workers gradients are
// prefixed so the ids stay unique in the page.
const logos = {
  workers: {
    w: 256,
    h: 231,
    body: `<defs>
      <linearGradient id="wkw-a" x1="50%" x2="25.7%" y1="100%" y2="8.7%"><stop offset="0%" stop-color="#EB6F07"/><stop offset="100%" stop-color="#FAB743"/></linearGradient>
      <linearGradient id="wkw-b" x1="81%" x2="40.5%" y1="83.7%" y2="29.5%"><stop offset="0%" stop-color="#D96504"/><stop offset="100%" stop-color="#D96504" stop-opacity="0"/></linearGradient>
      <linearGradient id="wkw-c" x1="42%" x2="84%" y1="8.7%" y2="79.9%"><stop offset="0%" stop-color="#EB6F07"/><stop offset="100%" stop-color="#EB720A" stop-opacity="0"/></linearGradient>
      <linearGradient id="wkw-d" x1="50%" x2="25.7%" y1="100%" y2="8.7%"><stop offset="0%" stop-color="#EE6F05"/><stop offset="100%" stop-color="#FAB743"/></linearGradient>
      <linearGradient id="wkw-e" x1="-33.2%" x2="91.7%" y1="100%" y2="0%"><stop offset="0%" stop-color="#D96504" stop-opacity=".8"/><stop offset="49.8%" stop-color="#D96504" stop-opacity=".2"/><stop offset="100%" stop-color="#D96504" stop-opacity="0"/></linearGradient>
      <linearGradient id="wkw-f" x1="50%" x2="25.7%" y1="100%" y2="8.7%"><stop offset="0%" stop-color="#FFA95F"/><stop offset="100%" stop-color="#FFEBC8"/></linearGradient>
      <linearGradient id="wkw-g" x1="8.1%" x2="96.5%" y1="1.1%" y2="48.8%"><stop offset="0%" stop-color="#FFF" stop-opacity=".5"/><stop offset="100%" stop-color="#FFF" stop-opacity=".1"/></linearGradient>
      <linearGradient id="wkw-h" x1="-13.7%" x2="100%" y1="104.2%" y2="46.2%"><stop offset="0%" stop-color="#FFF" stop-opacity=".5"/><stop offset="100%" stop-color="#FFF" stop-opacity=".1"/></linearGradient>
    </defs>
    <path fill="url(#wkw-a)" d="m65.82 3.324 30.161 54.411-27.698 49.857a16.003 16.003 0 0 0 0 15.573l27.698 49.98-30.16 54.411a32.007 32.007 0 0 1-13.542-12.74L4.27 131.412a32.13 32.13 0 0 1 0-32.007l48.01-83.403a32.007 32.007 0 0 1 13.542-12.68Z"/>
    <path fill="url(#wkw-b)" d="M68.283 107.654a16.003 16.003 0 0 0 0 15.51l27.698 49.98-30.16 54.412a32.007 32.007 0 0 1-13.542-12.74L4.27 131.412c-3.816-6.586 17.542-14.465 64.014-23.698v-.061Z" opacity=".7"/>
    <path fill="url(#wkw-c)" d="m68.898 8.802 27.083 48.933-4.493 7.818-23.882-40.44c-6.894-11.264-17.42-5.416-30.591 17.358l1.97-3.386 13.294-23.082a32.007 32.007 0 0 1 13.419-12.68l3.139 5.479h.061Z" opacity=".5"/>
    <path fill="url(#wkw-d)" d="m203.696 16.003 48.01 83.403c5.725 9.848 5.725 22.159 0 32.007l-48.01 83.402a32.007 32.007 0 0 1-27.698 16.004h-48.01l59.705-107.654a16.003 16.003 0 0 0 0-15.511L127.988 0h48.01a32.007 32.007 0 0 1 27.698 16.003Z"/>
    <path fill="url(#wkw-e)" d="m173.536 230.45-47.395.43 57.367-108.208a16.619 16.619 0 0 0 0-15.634L126.14 0h10.834l60.197 106.546a16.619 16.619 0 0 1-.062 16.496 9616.838 9616.838 0 0 0-38.592 67.707c-11.695 20.558-6.648 33.791 15.018 39.7Z"/>
    <path fill="url(#wkw-f)" d="M79.978 230.819c-4.924 0-9.849-1.17-14.157-3.263l59.212-106.792a11.045 11.045 0 0 0 0-10.71L65.821 3.324A32.007 32.007 0 0 1 79.978 0h48.01l59.705 107.654a16.003 16.003 0 0 1 0 15.51L127.988 230.82h-48.01Z"/>
    <path fill="url(#wkw-g)" d="M183.508 110.054 122.448 0h5.54l59.705 107.654a16.003 16.003 0 0 1 0 15.51L127.988 230.82h-5.54l61.06-110.055a11.045 11.045 0 0 0 0-10.71Z" opacity=".6"/>
    <path fill="url(#wkw-h)" d="M125.033 110.054 65.821 3.324c1.846-.985 4.062-1.724 6.155-2.34 13.049 23.452 32.315 59.029 57.859 106.67a16.003 16.003 0 0 1 0 15.51L71.053 229.589c-2.093-.616-3.201-1.047-5.17-1.97l59.089-106.792a11.045 11.045 0 0 0 0-10.71l.061-.062Z" opacity=".6"/>
  `,
  },
  discord: {
    w: 256,
    h: 199,
    body: `<path fill="#5865F2" d="M216.856 16.597A208.502 208.502 0 0 0 164.042 0c-2.275 4.113-4.933 9.645-6.766 14.046-19.692-2.961-39.203-2.961-58.533 0-1.832-4.4-4.55-9.933-6.846-14.046a207.809 207.809 0 0 0-52.855 16.638C5.618 67.147-3.443 116.4 1.087 164.956c22.169 16.555 43.653 26.612 64.775 33.193A161.094 161.094 0 0 0 79.735 175.3a136.413 136.413 0 0 1-21.846-10.632 108.636 108.636 0 0 0 5.356-4.237c42.122 19.702 87.89 19.702 129.51 0a131.66 131.66 0 0 0 5.355 4.237 136.07 136.07 0 0 1-21.886 10.653c4.006 8.02 8.638 15.67 13.873 22.848 21.142-6.58 42.646-16.637 64.815-33.213 5.316-56.288-9.08-105.09-38.056-148.36ZM85.474 135.095c-12.645 0-23.015-11.805-23.015-26.18s10.149-26.2 23.015-26.2c12.867 0 23.236 11.804 23.015 26.2.02 14.375-10.148 26.18-23.015 26.18Zm85.051 0c-12.645 0-23.014-11.805-23.014-26.18s10.148-26.2 23.014-26.2c12.867 0 23.236 11.804 23.015 26.2 0 14.375-10.148 26.18-23.015 26.18Z"/>`,
  },
  vercel: {
    w: 256,
    h: 222,
    body: '<path fill="#e8ebee" d="m128 0 128 221.705H0z"/>',
  },
  boxes: {
    w: 21,
    h: 32,
    body: `<path fill="#b6bdc4" fill-rule="evenodd" clip-rule="evenodd" d="M10.3604 0.0713094C10.5495 -0.0544688 10.7065 -0.0082915 10.7568 0.166036L15.5703 2.79201L15.3301 3.23049L15.748 2.95315V8.80959L20.542 11.4248L20.2236 12.0078L20.7422 11.6631V23.6133C20.7422 23.8894 20.5559 24.2375 20.3262 24.3906L10.3828 31.0205V30.4024L10.1201 30.8848L5.32324 28.2686C5.12353 28.365 4.97169 28.262 4.97168 28.0117V22.1533L0.398438 19.6592C0.176221 19.7971 0 19.6973 0 19.4278V7.47756C0.000183397 7.20148 0.186363 6.85331 0.416016 6.70022L10.3604 0.0713094ZM6.26953 27.6455L10.4902 29.9473L19.4336 23.9854L15.2119 21.6836L6.26953 27.6455ZM10.7754 12.7432V18.2178C10.7753 18.4938 10.589 18.842 10.3594 18.9951L5.80371 22.0322V26.9571L14.915 20.8819V9.98342L10.7754 12.7432ZM15.7471 20.8272C15.7471 20.8297 15.7461 20.8324 15.7461 20.835L19.9102 23.1065V12.2188L15.7471 9.94826V20.8272ZM1.33984 19.0332L5.40137 21.249L9.43457 18.5596L5.37305 16.3447L1.33984 19.0332ZM0.832031 7.42287V18.3731L4.97168 15.6133V10.1387C4.97179 9.86264 5.15806 9.51452 5.3877 9.36135L9.94434 6.32424V1.34865L0.832031 7.42287ZM5.80371 15.4395L9.94336 17.6973V12.9131L5.80371 10.6553V15.4395ZM6.27148 9.7715L10.335 11.9883C10.3433 11.9822 10.3509 11.9754 10.3594 11.9697L14.374 9.29104L10.3135 7.07717L6.27148 9.7715ZM10.7764 6.18947L14.916 8.44729V3.57326L10.7764 1.31643V6.18947Z"/>`,
  },
};

/** Map a logo viewBox onto a parallelogram face so it reads as a printed sticker. */
function sticker(logo, [A, B, , D], rect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, opts = {}) {
  const x = A[0] + (B[0] - A[0]) * rect.x + (D[0] - A[0]) * rect.y;
  const y = A[1] + (B[1] - A[1]) * rect.x + (D[1] - A[1]) * rect.y;
  const ux = ((B[0] - A[0]) * rect.w) / logo.w;
  const uy = ((B[1] - A[1]) * rect.w) / logo.w;
  const vx = ((D[0] - A[0]) * rect.h) / logo.h;
  const vy = ((D[1] - A[1]) * rect.h) / logo.h;
  return `<g transform="matrix(${n3(ux)} ${n3(uy)} ${n3(vx)} ${n3(vy)} ${n3(x)} ${n3(y)})" opacity="${opts.opacity ?? 1}">${logo.body}</g>`;
}


const parts = [];

// ---------- floor ----------
const grid = [];
for (let i = -3; i <= 9; i++) {
  const a = p(i * 55, -200, 0);
  const b = p(i * 55, 500, 0);
  grid.push(`<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}"/>`);
  const c = p(-200, i * 55, 0);
  const d = p(500, i * 55, 0);
  grid.push(`<line x1="${n(c[0])}" y1="${n(c[1])}" x2="${n(d[0])}" y2="${n(d[1])}"/>`);
}
parts.push(`<g class="grid" stroke="#87909a" stroke-width="1" opacity=".045">${grid.join("")}</g>`);
parts.push(`<ellipse cx="390" cy="575" rx="290" ry="46" fill="url(#floor)"/>`);

// ---------- base ----------
parts.push(box(0, 0, 0, 340, 235, 14, {
  top: "#1e2226", left: "#14181b", right: "#101315", stroke: "#2b3035",
  detail: `
    <polygon points="${[p(26, 26, 15), p(314, 26, 15), p(314, 209, 15), p(26, 209, 15)].map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="none" stroke="#2e3439" stroke-dasharray="2 5" opacity=".8"/>
    <line x1="${n(p(30, 210, 15)[0])}" y1="${n(p(30, 210, 15)[1])}" x2="${n(p(300, 210, 15)[0])}" y2="${n(p(300, 210, 15)[1])}" stroke="#2a2f34" opacity=".8"/>
  `,
}));

// ---------- conversation cylinder ----------
const cyl = { cx: 664, top: 468, bottom: 556, r: 40 };
parts.push(`<ellipse cx="${cyl.cx}" cy="${cyl.bottom + 8}" rx="58" ry="15" fill="url(#floor)"/>`);
parts.push(`<path d="M ${cyl.cx - cyl.r} ${cyl.top} L ${cyl.cx - cyl.r} ${cyl.bottom} A ${cyl.r} 13 0 0 0 ${cyl.cx + cyl.r} ${cyl.bottom} L ${cyl.cx + cyl.r} ${cyl.top} Z" fill="#121517" stroke="#2f353a"/>`);
parts.push(`<ellipse cx="${cyl.cx}" cy="${cyl.bottom}" rx="${cyl.r}" ry="13" fill="#0d0f10" stroke="#2f353a"/>`);
parts.push(`<ellipse cx="${cyl.cx}" cy="${cyl.top}" rx="${cyl.r}" ry="13" fill="#242a2e" stroke="#3b4248"/>`);
parts.push(`<ellipse cx="${cyl.cx}" cy="${cyl.top}" rx="${cyl.r - 8}" ry="9" fill="none" stroke="#343b41" stroke-dasharray="2 3"/>`);
for (const yy of [cyl.top + 28, cyl.top + 54]) {
  parts.push(`<path d="M ${cyl.cx - cyl.r + 2} ${yy} A ${cyl.r - 2} 12 0 0 0 ${cyl.cx + cyl.r - 2} ${yy}" fill="none" stroke="#2b3136"/>`);
}
parts.push(`<circle cx="${cyl.cx - 14}" cy="${cyl.top + 40}" r="2" fill="#d8a657" opacity=".65"/>`);
parts.push(`<circle cx="${cyl.cx + 11}" cy="${cyl.top + 40}" r="2" fill="#d8a657" opacity=".35"/>`);

// ---------- worker ----------
parts.push(box(30, 20, 80, 240, 150, 11, {
  top: "#2d3237", left: "#1c2125", right: "#131719",
  detail: `<circle cx="${n(p(252, 36, 92)[0])}" cy="${n(p(252, 36, 92)[1])}" r="2.4" fill="#d8a657" opacity=".9"/>`,
}));
parts.push(sticker(logos.workers, topFace(30, 20, 80, 240, 150, 11), { x: 0.07, y: 0.53, w: 0.32, h: 0.4 }, { opacity: 0.92 }));

// ---------- gateway ----------
parts.push(box(65, 50, 210, 170, 105, 10, {
  top: "#292e33", left: "#1b1f23", right: "#131619",
  detail: `
    <line x1="${n(p(82, 66, 220)[0])}" y1="${n(p(82, 66, 220)[1])}" x2="${n(p(224, 66, 220)[0])}" y2="${n(p(224, 66, 220)[1])}" stroke="#363d43"/>
    <line x1="${n(p(82, 82, 220)[0])}" y1="${n(p(82, 82, 220)[1])}" x2="${n(p(190, 82, 220)[0])}" y2="${n(p(190, 82, 220)[1])}" stroke="#30363c"/>
    <circle cx="${n(p(224, 66, 220)[0])}" cy="${n(p(224, 66, 220)[1])}" r="2.2" fill="#d8a657" opacity=".75"/>
  `,
}));

// ---------- message ----------
const msg = { x: 95, y: 70, z: 360, w: 112, d: 64, h: 7 };
parts.push(box(msg.x, msg.y, msg.z, msg.w, msg.d, msg.h, {
  top: "#3b3123", left: "#251f18", right: "#17130f", stroke: "#6c5739",
  detail: `
    <line x1="${n(p(msg.x + 54, msg.y + 18, msg.z + msg.h)[0])}" y1="${n(p(msg.x + 54, msg.y + 18, msg.z + msg.h)[1])}" x2="${n(p(msg.x + msg.w - 14, msg.y + 18, msg.z + msg.h)[0])}" y2="${n(p(msg.x + msg.w - 14, msg.y + 18, msg.z + msg.h)[1])}" stroke="#826844" stroke-width="2"/>
    <line x1="${n(p(msg.x + 54, msg.y + 32, msg.z + msg.h)[0])}" y1="${n(p(msg.x + 54, msg.y + 32, msg.z + msg.h)[1])}" x2="${n(p(msg.x + msg.w - 26, msg.y + 32, msg.z + msg.h)[0])}" y2="${n(p(msg.x + msg.w - 26, msg.y + 32, msg.z + msg.h)[1])}" stroke="#6e583c" stroke-width="2"/>
    <line x1="${n(p(msg.x + 54, msg.y + 46, msg.z + msg.h)[0])}" y1="${n(p(msg.x + 54, msg.y + 46, msg.z + msg.h)[1])}" x2="${n(p(msg.x + msg.w - 40, msg.y + 46, msg.z + msg.h)[0])}" y2="${n(p(msg.x + msg.w - 40, msg.y + 46, msg.z + msg.h)[1])}" stroke="#6e583c" stroke-width="2"/>
    <circle cx="${n(p(msg.x + msg.w - 12, msg.y + 18, msg.z + msg.h)[0])}" cy="${n(p(msg.x + msg.w - 12, msg.y + 18, msg.z + msg.h)[1])}" r="3.4" fill="#d8a657" opacity=".9"/>
  `,
}));
parts.push(sticker(logos.discord, topFace(msg.x, msg.y, msg.z, msg.w, msg.d, msg.h), { x: 0.07, y: 0.16, w: 0.3, h: 0.6 }));

// ---------- satellites ----------
const cubes = [
  { cx: 806, cy: 180, label: "AI Gateway", sub: "chat", logo: logos.vercel },
  { cx: 806, cy: 292, label: "Jev", sub: "typed decisions" },
  { cx: 806, cy: 404, label: "TaskAgent", sub: "tools + sandbox", logo: logos.boxes },
];
for (const c of cubes) {
  parts.push(cubeAt(c.cx, c.cy, 64, {
    top: "#262b30", left: "#181d20", right: "#111416",
    detail: `<circle cx="${n(c.cx)}" cy="${n(c.cy)}" r="3" fill="none" stroke="#4a5259"/><circle cx="${n(c.cx)}" cy="${n(c.cy)}" r="1" fill="#d8a657" opacity=".7"/>`,
  }, c.logo));
}

// ---------- connectors ----------
const workerRight = [532, 348];
const cylAnchor = [cyl.cx - cyl.r + 3, cyl.top + 26];
parts.push(curve(`M ${workerRight[0]} ${workerRight[1]} C 580 360, 590 410, ${cylAnchor[0]} ${cylAnchor[1]}`, { width: 1.5, flow: true }));
parts.push(port(workerRight));
parts.push(port(cylAnchor));

for (const c of cubes) {
  const from = [520, c.cy < 300 ? 310 : c.cy < 400 ? 338 : 366];
  const to = [c.cx - 44, c.cy + 12];
  parts.push(curve(`M ${from[0]} ${from[1]} C 620 ${from[1]}, 690 ${to[1]}, ${to[0]} ${to[1]}`, { width: 1.1, opacity: 0.5, marker: "arrow" }));
  parts.push(port(to, "#d8a657", 2));
}

// message -> gateway
const msgBottom = p(msg.x + msg.w / 2, msg.y + msg.d / 2, msg.z);
const gatewayTop = p(165, 112, 220);
parts.push(line(msgBottom, gatewayTop, { width: 1.6, flow: true }));
parts.push(port(msgBottom, "#d8a657", 2));
// gateway -> worker
const gatewayBottom = p(165, 150, 210);
const workerTop = p(165, 150, 91);
parts.push(line(gatewayBottom, workerTop, { width: 1.6, flow: true }));

// cron
const clock = { cx: 126, cy: 158, r: 20 };
parts.push(`<circle cx="${clock.cx}" cy="${clock.cy}" r="${clock.r}" fill="#121517" stroke="#3a4147" stroke-width="1.2"/>`);
parts.push(`<line x1="${clock.cx}" y1="${clock.cy}" x2="${clock.cx}" y2="${clock.cy - 10}" stroke="#d8a657" stroke-width="1.5" stroke-linecap="round"/>`);
parts.push(`<line x1="${clock.cx}" y1="${clock.cy}" x2="${clock.cx + 7}" y2="${clock.cy + 4}" stroke="#8e959c" stroke-width="1.1" stroke-linecap="round"/>`);
parts.push(`<circle cx="${clock.cx}" cy="${clock.cy}" r="1.5" fill="#d8a657"/>`);
parts.push(curve(`M ${clock.cx + 17} ${clock.cy + 12} C 195 220, 260 255, ${workerTop[0] - 4} ${workerTop[1] - 2}`, { dash: "3 5", stroke: "#5d646b", opacity: 0.8, marker: "arrow-dim" }));

// ---------- labels ----------
parts.push(label(386, 34, "Discord", null, "center"));
parts.push(leader([386, 50], [386, 86], "#6c5739"));

parts.push(label(236, 214, "Gateway DO", "one WebSocket", "right"));
parts.push(leader([240, 208], [270, 233]));

parts.push(label(192, 332, "Worker", "routes the event", "right"));
parts.push(leader([196, 326], [228, 342]));

parts.push(label(734, 490, "Conversation DO", "SQLite, memories", "left"));
parts.push(label(734, 526, "nightly alarm 03:00 JST", null, "left"));
parts.push(leader([730, 484], [702, 475]));

for (const c of cubes) {
  parts.push(label(868, c.cy - 4, c.label, c.sub, "left"));
  parts.push(leader([864, c.cy - 8], [c.cx + 22, c.cy - 4]));
}

parts.push(label(42, 126, "Cron", "17:00 UTC", "left"));
parts.push(`<text x="386" y="606" class="d-base" text-anchor="middle">Cloudflare edge</text>`);
parts.push(`<line x1="330" y1="592" x2="442" y2="592" stroke="#2c3237"/>`);

const svg = `<svg viewBox="0 0 1080 640" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="anatomy-title anatomy-desc">
<title id="anatomy-title">An exploded isometric view of community-bot</title>
<desc id="anatomy-desc">A Discord message enters a Gateway Durable Object, passes through a Worker, and is stored by a Conversation Durable Object. The Worker also calls AI Gateway, Jev, and a per-channel TaskAgent with its sandbox. A daily Cron trigger and a nightly alarm are drawn as dashed lines.</desc>
<defs>
  <radialGradient id="floor" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#000" stop-opacity=".6"/>
    <stop offset="100%" stop-color="#000" stop-opacity="0"/>
  </radialGradient>
  <marker id="arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 8 4 L 0 8 z" fill="#d8a657" opacity=".8"/>
  </marker>
  <marker id="arrow-dim" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 8 4 L 0 8 z" fill="#5d646b"/>
  </marker>
</defs>
${parts.join("\n")}
</svg>`;

writeFileSync(target, svg);
console.log(`wrote ${target} (${svg.length} bytes)`);
