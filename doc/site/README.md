# Docs site

The documentation is written in the Markdown files in `doc/` and built into a static site by `build.mjs`. This folder owns the design and the build, not the content.

```bash
npm run docs:build   # doc/*.md -> doc/dist
npm run docs:dev     # build, then serve doc/dist at http://localhost:4321
```

## Files

| Path | Purpose |
| --- | --- |
| `build.mjs` | Reads frontmatter, renders Markdown with `marked`, inlines diagrams, writes the search index, checks internal links, concatenates `styles/`. |
| `serve.mjs` | Local static server for the build output. |
| `styles/` | The design system split into five ordered files (base, layout, content, chrome, responsive). The build concatenates them into one `style.css`, so the page still loads a single stylesheet. All media queries live in `05-responsive.css`. |
| `assets/` | Self-hosted fonts (Instrument Sans, JetBrains Mono, OFL), favicon, `main.js`. |
| `assets/main.js` | Search, copy buttons, mobile navigation, scrollspy. No inline scripts. |
| `diagrams/anatomy.svg` | The isometric figure on the overview page. |
| `diagrams/generate.mjs` | Regenerates `anatomy.svg`. Run `node doc/site/diagrams/generate.mjs` after changing labels or geometry. |

## Design notes

The visual language follows the `frontend-design` skill from `anthropics/skills`: one accent color, a small type system, and one memorable element. The brief was the Rex documentation, so the structure is intentionally close to it: a fixed left sidebar with search and grouped navigation, a single reading column, and framed code blocks.

- **Type:** Instrument Sans for everything, JetBrains Mono for code and technical labels. No third family.
- **Color:** near-black surfaces with one warm amber accent, used for the active navigation item, links on hover, and the signal path in the diagram.
- **Figure:** a hand-built isometric SVG, inspired by `wheresryan22/anatomy`. It is inline so the page CSS can style it. Service marks (Discord, Cloudflare Workers, Vercel, and the sandbox glyph) are printed flat onto the top faces with an affine matrix, so they read as stickers on the plates.
- **Motion:** the diagram's signal path fades in once, and same-origin page navigations use cross-document view transitions with the sidebar pinned by `view-transition-name`. Both are disabled under `prefers-reduced-motion`. Everything else responds to the pointer or the keyboard.
- **Content:** the copy explains the system rather than selling it. Prefer a plain sentence and a table over a card grid.

The site has no client framework and no runtime dependency beyond `marked` at build time. Adding a page is adding a Markdown file.
