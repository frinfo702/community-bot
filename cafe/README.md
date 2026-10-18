# 八代カフェ

The Activity opened by `/cafe`.

The default view is the reference illustration, converted to a 640×360 paletted
image and animated with a small set of overlays: lamp flicker, garden parallax,
falling petals, steam, dust, and a blink. `?scene=3d` opens the earlier three.js
room, which is still in the repository as an alternative view.

## Asset pipeline

`public/cafe.png` is generated from `assets/cafe-reference.png`:

```bash
node tools/pixelize.mjs assets/cafe-reference.png \
  --width 640 --colors 36 --dither 0.5 --out public/cafe.png
```

The tool resizes with Lanczos, then uses sharp's palette PNG encoder to reduce
the image to a fixed palette with dithering. Width controls the pixel grid;
`--colors` and `--dither` control the palette and grain. Re-run it after
replacing the reference image.

## Animation

| What | How |
| --- | --- |
| Lantern light | additive radial glows at six lamp positions, three-sine flicker and a slow sway |
| Petals / dust / steam | cheap particles drawn over the bitmap |
| Noren | both panels cut out and swung by a slow, heavy pendulum on a fraction of the same wind, bending most at the hem |
| Cherry tree | blossom pixels in the far window borrow colour from a neighbouring blossom pixel, offset by a slow sway and a flutter |
| Wind chime | the cut-out tag as a damped pendulum driven by breeze and gusts, rotated every frame |
| Hostess | a blink every 4.9 s: half, closed, half lids over each eye |
| Room | slow warm exposure pulse |

The character is part of the bitmap. Only the eyes are redrawn; moving her body
would require hand-cut layers with matching masks.

## Swinging sprites

The paper tag under the glass chime and the two noren panels are separate
sprites so they can swing without dragging the wall with them:

```bash
node tools/prepare-sprites.mjs
```

This writes `public/cafe-bg.png` (the tag and noren painted out),
`public/furin-tag.png` (the tag with alpha) and `public/noren.png` (the
noren, cut by hand-traced outlines). The app draws the background
plate, then the tag rotated about the cord by a damped pendulum. The ball
stays in the plate.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # dist/
npm run typecheck
npm run pixelize -- assets/cafe-reference.png --width 640 --out public/cafe.png
npx wrangler deploy  # static-assets Worker, see wrangler.jsonc```

The Discord portal steps (enable Activities, URL mapping, redirect URI) are in
`docs/discord-setup.md` at the repository root.

## Notes

- No OAuth or Discord SDK call is made; the page works in a plain browser.
- Audio is synthesised with Web Audio (pad, koto-like plucks, chime, room tone)
  and starts on the first click.
- Portrait screens letterbox the 16:9 frame.
- The Activity proxy blocks external origins, so the PNG is served from the
  same Worker.
