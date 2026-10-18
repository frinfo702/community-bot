#!/usr/bin/env node
// Turns an illustration into a paletted pixel image for the cafe.
// Sharp's palette + dither pass does the colour reduction; resizing does the
// pixel grid. Output is a PNG the Activity can draw 1:1.
import { parseArgs } from "node:util";
import { extname } from "node:path";
import { statSync } from "node:fs";
import sharp from "sharp";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    width: { type: "string", default: "480" },
    colors: { type: "string", default: "32" },
    dither: { type: "string", default: "0.5" },
    out: { type: "string" },
  },
});

const input = positionals[0];
if (!input) {
  console.error(
    "usage: node tools/pixelize.mjs <image> [--width 480] [--colors 32] [--dither 0.5] [--out file.png]",
  );
  process.exit(1);
}

const width = Number(values.width);
const colors = Number(values.colors);
const dither = Number(values.dither);
if (!Number.isFinite(width) || width < 64) throw new Error("width must be >= 64");
if (!Number.isFinite(colors) || colors < 2 || colors > 256) {
  throw new Error("colors must be 2..256");
}
if (!Number.isFinite(dither) || dither < 0 || dither > 1) {
  throw new Error("dither must be 0..1");
}

const meta = await sharp(input).metadata();
if (!meta.width || !meta.height) throw new Error("could not read image size");
const height = Math.max(1, Math.round((width * meta.height) / meta.width));
const out = values.out ?? input.replace(extname(input), "-pixel.png");

await sharp(input)
  .resize({ width, height, fit: "fill", kernel: "lanczos3" })
  .png({
    palette: true,
    colours: colors,
    dither,
    effort: 8,
    compressionLevel: 9,
  })
  .toFile(out);

const info = await sharp(out).metadata();
console.log(
  `${out}: ${info.width}x${info.height}, ${colors} colours, dither ${dither}, ${statSync(out).size} bytes`,
);
