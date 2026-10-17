import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Regenerates the flat figures in this folder: anatomy.svg (overview page) and
// memory.svg (memory page).
// Run: node doc/site/diagrams/generate.mjs
const outDir = path.dirname(fileURLToPath(import.meta.url));

const accent = "#d8a657";
const n = (v) => Number(v.toFixed(1));

function rect(x, y, w, h, fill, stroke, rx = 9) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;
}

function text(x, y, cls, body, anchor = "start") {
  return `<text x="${n(x)}" y="${n(y)}" class="${cls}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${body}</text>`;
}

function port([x, y], r = 2.5) {
  return `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="#0b0d0e" stroke="${accent}" stroke-width="1.2"/>`;
}

function seg(a, b, opts = {}) {
  return `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${opts.stroke ?? accent}" stroke-width="${opts.width ?? 1.4}" stroke-linecap="round"${opts.dash ? ` stroke-dasharray="${opts.dash}"` : ""}${opts.flow ? ' class="flow"' : ""} opacity="${opts.opacity ?? 0.8}"${opts.marker ? ` marker-end="url(#${opts.marker})"` : ""}/>`;
}

function elbow(points, opts = {}) {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"} ${n(x)} ${n(y)}`).join(" ");
  return `<path d="${d}" fill="none" stroke="${opts.stroke ?? accent}" stroke-width="${opts.width ?? 1.2}" stroke-linecap="round" stroke-linejoin="round"${opts.dash ? ` stroke-dasharray="${opts.dash}"` : ""}${opts.flow ? ' class="flow"' : ""} opacity="${opts.opacity ?? 0.8}"${opts.marker ? ` marker-end="url(#${opts.marker})"` : ""}/>`;
}

function clock(cx, cy, r) {
  return (
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#0b0d0e" stroke="#3a4147" stroke-width="1.2"/>` +
    `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - r * 0.55)}" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx + r * 0.42)}" y2="${n(cy + r * 0.26)}" stroke="#8e959c" stroke-width="1" stroke-linecap="round"/>` +
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="1.4" fill="${accent}"/>`
  );
}

// Service marks sit in the top-right corner of a card.
function mark(logo, right, top, height) {
  const scale = height / logo.h;
  const w = logo.w * scale;
  return `<g transform="translate(${n(right - w)} ${n(top)}) scale(${scale.toFixed(4)})" opacity=".92">${logo.body}</g>`;
}

function card({ x, y, w, h, name, sub, note, icon, fill = "#12161a", stroke = "#2b3137" }) {
  const lines = [name, sub, note].filter(Boolean);
  const baselines = lines.map((_, i) => y + h / 2 - 6 - (lines.length - 2) * 11 + i * 22);
  return `<g>${rect(x, y, w, h, fill, stroke)}${lines
    .map((line, i) => text(x + 18, baselines[i], i === 0 ? "d-name" : "d-sub", line))
    .join("")}${icon ? mark(icon, x + w - 16, y + 14, 20) : ""}</g>`;
}

// The Workers gradients are prefixed so the ids stay unique in the page.
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
  typesafe: {
    w: 21,
    h: 32,
    body: `<path fill="#b6bdc4" fill-rule="evenodd" clip-rule="evenodd" d="M10.3604 0.0713094C10.5495 -0.0544688 10.7065 -0.0082915 10.7568 0.166036L15.5703 2.79201L15.3301 3.23049L15.748 2.95315V8.80959L20.542 11.4248L20.2236 12.0078L20.7422 11.6631V23.6133C20.7422 23.8894 20.5559 24.2375 20.3262 24.3906L10.3828 31.0205V30.4024L10.1201 30.8848L5.32324 28.2686C5.12353 28.365 4.97169 28.262 4.97168 28.0117V22.1533L0.398438 19.6592C0.176221 19.7971 0 19.6973 0 19.4278V7.47756C0.000183397 7.20148 0.186363 6.85331 0.416016 6.70022L10.3604 0.0713094ZM6.26953 27.6455L10.4902 29.9473L19.4336 23.9854L15.2119 21.6836L6.26953 27.6455ZM10.7754 12.7432V18.2178C10.7753 18.4938 10.589 18.842 10.3594 18.9951L5.80371 22.0322V26.9571L14.915 20.8819V9.98342L10.7754 12.7432ZM15.7471 20.8272C15.7471 20.8297 15.7461 20.8324 15.7461 20.835L19.9102 23.1065V12.2188L15.7471 9.94826V20.8272ZM1.33984 19.0332L5.40137 21.249L9.43457 18.5596L5.37305 16.3447L1.33984 19.0332ZM0.832031 7.42287V18.3731L4.97168 15.6133V10.1387C4.97179 9.86264 5.15806 9.51452 5.3877 9.36135L9.94434 6.32424V1.34865L0.832031 7.42287ZM5.80371 15.4395L9.94336 17.6973V12.9131L5.80371 10.6553V15.4395ZM6.27148 9.7715L10.335 11.9883C10.3433 11.9822 10.3509 11.9754 10.3594 11.9697L14.374 9.29104L10.3135 7.07717L6.27148 9.7715ZM10.7764 6.18947L14.916 8.44729V3.57326L10.7764 1.31643V6.18947Z"/>`,
  },
};

// ---------- the overview figure: one message through the system ----------
function anatomy() {
const row = { y: 122, h: 84, cy: 164 };
const discord = { x: 24, w: 152 };
const gateway = { x: 240, w: 152 };
const worker = { x: 472, w: 152 };
const conv = { x: 688, w: 200 };
const workerCx = worker.x + worker.w / 2;

const branch = { y: 322, h: 72, bus: 272 };
const calls = [
  { x: 296, w: 152, name: "AI Gateway", sub: "chat", icon: logos.vercel },
  { x: 472, w: 152, name: "Jev", sub: "typed decisions", icon: logos.typesafe },
  { x: 648, w: 152, name: "TaskAgent", sub: "tools + sandbox" },
];

const frame = { x: 208, y: 36, w: 708, h: 384 }; // 36..420

const parts = [];

// ---------- the Cloudflare boundary ----------
parts.push(rect(frame.x, frame.y, frame.w, frame.h, "none", "#232a2f", 16));
parts.push(text(frame.x + 20, frame.y + 24, "d-base", "Cloudflare edge"));

// ---------- main path ----------
parts.push(card({ x: discord.x, y: row.y, w: discord.w, h: row.h, name: "Discord", sub: "a member types", icon: logos.discord, fill: "#191510", stroke: "#453926" }));
parts.push(card({ x: gateway.x, y: row.y, w: gateway.w, h: row.h, name: "Gateway DO", sub: "one WebSocket" }));
parts.push(card({ x: worker.x, y: row.y, w: worker.w, h: row.h, name: "Worker", sub: "routes the event", icon: logos.workers, fill: "#171b1f", stroke: "#333a41" }));
parts.push(card({ x: conv.x, y: row.y, w: conv.w, h: row.h, name: "Conversation DO", sub: "SQLite, memories" }));

const steps = [
  // The first hop carries no label: the boundary already says where the message crosses.
  { from: discord.x + discord.w, to: gateway.x },
  { from: gateway.x + gateway.w, to: worker.x, label: "webhook" },
  { from: worker.x + worker.w, to: conv.x, label: "log" },
];
for (const step of steps) {
  parts.push(seg([step.from, row.cy], [step.to, row.cy], { flow: true, marker: "arrow" }));
  parts.push(port([step.from, row.cy]));
  if (step.label) parts.push(text((step.from + step.to) / 2, row.cy - 10, "d-base", step.label, "middle"));
}

// ---------- the calls the Worker makes ----------
parts.push(elbow([[workerCx, row.y + row.h], [workerCx, branch.bus]], { flow: true }));
parts.push(port([workerCx, row.y + row.h]));
parts.push(text(calls[0].x, branch.bus - 14, "d-base", "the same Worker also calls"));
parts.push(seg([calls[0].x + calls[0].w / 2, branch.bus], [calls[calls.length - 1].x + calls[calls.length - 1].w / 2, branch.bus], { width: 1.3, opacity: 0.68, flow: true }));
for (const call of calls) {
  const cx = call.x + call.w / 2;
  parts.push(seg([cx, branch.bus], [cx, branch.y], { width: 1.3, opacity: 0.68, marker: "arrow" }));
  parts.push(card({ x: call.x, y: branch.y, w: call.w, h: branch.h, name: call.name, sub: call.sub, icon: call.icon, fill: "#101315", stroke: "#242a2f" }));
}

// ---------- schedules ----------
// Cron: a Worker trigger, so it feeds the Worker from above.
parts.push(clock(workerCx, 80, 16));
parts.push(text(workerCx + 26, 76, "d-name", "Cron"));
parts.push(text(workerCx + 26, 96, "d-sub", "17:00 UTC"));
parts.push(seg([workerCx, 96], [workerCx, row.y], { stroke: "#5d646b", width: 1, dash: "3 5", opacity: 0.9, marker: "arrow-dim" }));

// Alarm: the Conversation DO schedules its own next run. It is annotated under
// the card rather than drawn as a loop, so the two schedules stay distinguishable.
parts.push(clock(conv.x + 8, row.y + row.h + 24, 6.5));
parts.push(text(conv.x + 22, row.y + row.h + 28, "d-base", "nightly alarm 03:00 JST"));

const svg = `<svg viewBox="0 0 940 440" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="anatomy-title anatomy-desc">
<title id="anatomy-title">A flat view of community-bot</title>
<desc id="anatomy-desc">A Discord message crosses the Cloudflare boundary into the Gateway Durable Object, which holds the WebSocket and posts it to the Worker. The Worker stores the turn in the Conversation Durable Object and calls AI Gateway, Jev, or a per-channel TaskAgent. A daily Cron trigger and a nightly alarm run the scheduled jobs.</desc>
<defs>
  <marker id="arrow" viewBox="0 0 8 8" refX="5.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
    <path d="M 0 0 L 8 4 L 0 8 z" fill="${accent}" opacity=".8"/>
  </marker>
  <marker id="arrow-dim" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 8 4 L 0 8 z" fill="#5d646b"/>
  </marker>
</defs>
${parts.join("\n")}
</svg>`;

return svg;
}

// ---------- the memory figure: how a fact is written, read, and revised ----------
function memory() {
  const parts = [];

  const row1 = { y: 96, h: 104, cy: 148 };
  const prompt = { x: 24, w: 288 };
  const extraction = { x: 344, w: 260 };
  const memories = { x: 636, w: 280 };
  const ledger = { x: 636, y: 208, w: 280, h: 62 };

  const row2 = { y: 320, h: 104, cy: 372 };
  const alarm = { x: 24, w: 288 };
  const day = { x: 344, w: 300 };
  const runs = { x: 676, w: 240 };

  // The read path: the next turn gets the speaker's rows.
  parts.push(elbow([[700, row1.y], [700, 48], [prompt.x + 144, 48], [prompt.x + 144, row1.y]], { flow: true, marker: "arrow" }));
  parts.push(text(472, 40, "d-base", "the next turn reads up to 10 rows", "middle"));

  parts.push(card({ x: prompt.x, y: row1.y, w: prompt.w, h: row1.h, name: "the prompt", sub: "the log + up to 10 rows" }));
  parts.push(card({ x: extraction.x, y: row1.y, w: extraction.w, h: row1.h, name: "extraction", sub: "Jev decides, the model phrases", icon: logos.typesafe }));
  parts.push(card({ x: memories.x, y: row1.y, w: memories.w, h: row1.h, name: "memories", sub: "one row per fact, per user" }));
  parts.push(card({ x: ledger.x, y: ledger.y, w: ledger.w, h: ledger.h, name: "memory_log", sub: "before / after, actor, reason", fill: "#101315", stroke: "#242a2f" }));

  for (const step of [
    { from: prompt.x + prompt.w, to: extraction.x, label: "the exchange, after the reply" },
    { from: extraction.x + extraction.w, to: memories.x, label: "keep / update / delete, or add" },
  ]) {
    parts.push(seg([step.from, row1.cy], [step.to, row1.cy], { flow: true, marker: "arrow" }));
    parts.push(port([step.from, row1.cy]));
    parts.push(text((step.from + step.to) / 2, row1.y - 8, "d-base", step.label, "middle"));
  }

  // The night: the same path with the actor nightly, plus the stale review.
  parts.push(card({ x: alarm.x, y: row2.y, w: alarm.w, h: row2.h, name: "nightly 03:00 JST", sub: "a Durable Object alarm" }));
  parts.push(card({ x: day.x, y: row2.y, w: day.w, h: row2.h, name: "the day, per speaker", sub: "chunks of six, five per speaker", note: "the 30-day review on stale rows" }));
  parts.push(card({ x: runs.x, y: row2.y, w: runs.w, h: row2.h, name: "nightly_runs", sub: "the diary + the summary" }));
  for (const step of [
    { from: alarm.x + alarm.w, to: day.x, label: "the same path, actor nightly" },
    { from: day.x + day.w, to: runs.x, label: "the diary" },
  ]) {
    parts.push(seg([step.from, row2.cy], [step.to, row2.cy], { flow: true, marker: "arrow" }));
    parts.push(text((step.from + step.to) / 2, row2.y + row2.h + 24, "d-base", step.label, "middle"));
  }

  parts.push(elbow([[day.x + 150, row2.y], [day.x + 150, 235], [ledger.x, 235]], { flow: true, marker: "arrow" }));
  parts.push(text(day.x + 156, 227, "d-base", "rewrites the rows"));
  parts.push(seg([850, row2.y], [850, ledger.y + ledger.h], { dash: "3 5", width: 1.2, opacity: 0.75, marker: "arrow" }));
  parts.push(text(838, 298, "d-base", "rollback", "end"));

  return `<svg viewBox="0 0 940 470" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="memory-title memory-desc">
<title id="memory-title">How a memory moves through community-bot</title>
<desc id="memory-desc">Each turn reads the channel log and up to ten memories of the person who spoke. After the reply, the extraction asks Jev to decide and the chat model to phrase, then writes memories and records the change in memory_log. At 03:00 JST a Durable Object alarm consolidates the day per speaker, reviews rows older than thirty days, and writes a diary line into nightly_runs. A rollback replays a run's memory_log rows in reverse.</desc>
<defs>
  <marker id="arrow" viewBox="0 0 8 8" refX="5.5" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
    <path d="M 0 0 L 8 4 L 0 8 z" fill="${accent}" opacity=".8"/>
  </marker>
</defs>
${parts.join("\n")}
</svg>`;
}

const figures = { anatomy: anatomy(), memory: memory() };
for (const [name, svg] of Object.entries(figures)) {
  const target = path.join(outDir, `${name}.svg`);
  writeFileSync(target, svg);
  console.log(`wrote ${target} (${svg.length} bytes)`);
}
