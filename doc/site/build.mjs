import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, marked } from "marked";

const here = path.dirname(fileURLToPath(import.meta.url));
const docRoot = path.resolve(here, "..");
const siteRoot = path.join(docRoot, "site");
const outRoot = path.join(docRoot, "dist");

const SITE_NAME = "community-bot";
const GROUP_ORDER = ["Start", "How it works", "Reference", "Operations"];
const REPO_URL = "https://github.com/frinfo702/community-bot";

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const stripTags = (html) =>
  html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const plain = (html) => stripTags(html).replace(/\s+/g, " ").trim();

const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "section";

/** Dedupe repeated heading slugs (intro, setup, setup) within one page. */
function createSlugger() {
  const seen = new Set();
  return (text) => {
    let id = slugify(text);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    return id;
  };
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const data = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([a-z]+):\s*(.*)$/);
    if (pair) data[pair[1]] = pair[2].replace(/^["']|["']$/g, "");
  }
  for (const field of ["title", "group", "order", "description"]) {
    if (!data[field]) throw new Error(`${file}: frontmatter is missing "${field}"`);
  }
  if (Number.isNaN(Number(data.order))) {
    throw new Error(`${file}: order must be a number`);
  }
  if (!GROUP_ORDER.includes(data.group)) {
    throw new Error(`${file}: unknown group "${data.group}" (expected one of ${GROUP_ORDER.join(", ")})`);
  }
  return { data, body: source.slice(match[0].length) };
}

/** Internal .md links become site routes; everything else is left alone. */
function rewriteHref(href) {
  if (/^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("#")) {
    return href;
  }
  const [file, hash] = href.split("#");
  if (!file.endsWith(".md")) return href;
  const target = path.basename(file, ".md");
  const route = target === "index" ? "/" : `/${target}/`;
  return hash ? `${route}#${hash}` : route;
}

const CODE_LABELS = {
  bash: "Shell",
  sh: "Shell",
  json: "JSON",
  sql: "SQL",
  ts: "TypeScript",
  js: "JavaScript",
  yaml: "YAML",
  hcl: "HCL",
  http: "HTTP",
  md: "Markdown",
  markdown: "Markdown",
  text: "Text",
};

function codeBlock({ text, lang }) {
  const language = (lang ?? "").split(/\s+/)[0];
  const label = CODE_LABELS[language] ?? (language || "Text");
  return `<figure class="code-block" data-language="${escapeHtml(language)}">
  <figcaption class="code-head">
    <span>${escapeHtml(label)}</span>
    <button class="copy" type="button" aria-label="Copy code"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M11 5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg></button>
  </figcaption>
  <pre><code>${escapeHtml(text)}</code></pre>
</figure>`;
}

/**
 * Produces the rendered HTML, the sidebar heading list, and the search sections
 * from one Markdown source. Two sluggers walk the same heading sequence, so the
 * search anchors always match the heading ids, and an assert below proves it.
 */
function renderMarkdown(page) {
  // Two sluggers see the same heading sequence, so the section anchors the
  // search index uses are exactly the ids the renderer emits.
  const sectionSlug = createSlugger();
  const sections = [{ title: "", anchor: "", tokens: [] }];
  for (const token of marked.lexer(page.body)) {
    if (token.type !== "heading") {
      sections.at(-1).tokens.push(token);
      continue;
    }
    const label = plain(marked.Parser.parseInline(token.tokens));
    const anchor = sectionSlug(label);
    if (token.depth === 2 || token.depth === 3) sections.push({ title: label, anchor, tokens: [] });
  }

  const headingSlug = createSlugger();
  const toc = [];
  const parser = new Marked({ gfm: true });
  parser.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = plain(this.parser.parseInline(tokens));
        const id = headingSlug(text);
        toc.push({ depth, text, id });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}<a class="heading-link" href="#${id}" aria-label="Link to ${escapeHtml(text)}"></a></h${depth}>`;
      },
      code: codeBlock,
      link({ href, title, tokens }) {
        const target = rewriteHref(href);
        const external = /^(?:https?:)?\/\//i.test(target);
        const attrs = external ? ' target="_blank" rel="noreferrer"' : "";
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(target)}"${titleAttr}${attrs}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });

  const html = parser
    .parse(page.body)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");

  const tocIds = new Set(toc.map((heading) => heading.id));
  for (const section of sections) {
    if (section.anchor && !tocIds.has(section.anchor)) {
      throw new Error(`${page.file}: search anchor "${section.anchor}" has no heading`);
    }
  }

  return {
    html,
    toc,
    sections: sections
      .map((section) => ({
        title: section.title,
        anchor: section.anchor,
        text: plain(marked.parser(section.tokens)).slice(0, 900),
      }))
      .filter((section) => section.title || section.text),
  };
}

function brandMark() {
  return `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true" class="brand-mark">
    <path d="M16 3 28 9.5 16 16 4 9.5Z" fill="#d8a657" opacity=".92"/>
    <path d="M4 9.5 16 16v12L4 21.5Z" fill="#6f5b37"/>
    <path d="M28 9.5 16 16v12l12-6.5Z" fill="#453a26"/>
    <path d="m16 9 6.5 3.2L16 15.5l-6.5-3.3Z" fill="#0d0f10" opacity=".55"/>
  </svg>`;
}

function head({ title, description }) {
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0a0b0c">
  <title>${escapeHtml(title)} · ${SITE_NAME}</title>${
    description ? `\n  <meta name="description" content="${escapeHtml(description)}">` : ""
  }
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/assets/fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/style.css">
  <script src="/assets/main.js" defer></script>`;
}

function navHtml(activePage) {
  const groups = new Map();
  for (const page of pages) {
    if (!groups.has(page.group)) groups.set(page.group, []);
    groups.get(page.group).push(page);
  }
  return [...groups.entries()]
    .map(([group, items]) => {
      const links = items
        .map((page) => {
          const active = page === activePage;
          let html = `<li><a class="nav-link${active ? " is-active" : ""}" href="${page.href}"${active ? ' aria-current="page"' : ""}>${escapeHtml(page.nav)}</a>`;
          if (active) {
            const sub = page.toc
              .filter((heading) => heading.depth === 2)
              .slice(0, 9)
              .map(
                (heading) =>
                  `<li><a class="nav-sub" href="#${heading.id}" data-heading="${heading.id}">${escapeHtml(heading.text)}</a></li>`,
              )
              .join("");
            if (sub) html += `<ul class="nav-sub-list">${sub}</ul>`;
          }
          return `${html}</li>`;
        })
        .join("");
      return `<div class="nav-group"><p class="nav-group-title">${escapeHtml(group)}</p><ul class="nav-list">${links}</ul></div>`;
    })
    .join("");
}

function pageTemplate(page, content) {
  const prev = pages[page.index - 1];
  const next = pages[page.index + 1];
  const pager = (prev || next)
    ? `<nav class="pager" aria-label="Pages">${prev ? `<a class="pager-link" href="${prev.href}"><span>Previous</span><strong>${escapeHtml(prev.nav)}</strong></a>` : "<span></span>"}${next ? `<a class="pager-link pager-next" href="${next.href}"><span>Next</span><strong>${escapeHtml(next.nav)}</strong></a>` : ""}</nav>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  ${head(page)}
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="/">
        ${brandMark()}
        <span class="brand-name">community-bot</span>
        <span class="brand-tag">docs</span>
      </a>
      <button class="search-trigger" type="button" data-search-open>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
      <nav class="sidebar-nav" aria-label="Documentation">
        ${navHtml(page)}
      </nav>
      <div class="sidebar-foot">
        <a href="${REPO_URL}" target="_blank" rel="noreferrer">GitHub</a>
        <span class="foot-divider" aria-hidden="true"></span>
        <span>${pages.length} pages</span>
      </div>
    </aside>
    <div class="page">
      <header class="mobile-bar">
        <a class="brand brand-mobile" href="/">${brandMark()}<span class="brand-name">community-bot</span></a>
        <button class="icon-button" type="button" data-menu aria-label="Open navigation" aria-expanded="false">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
        </button>
        <button class="icon-button" type="button" data-search-open aria-label="Search">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
        </button>
      </header>
      <main id="content">
        <article class="prose${page.slug ? "" : " prose-home"}">
          ${content}
        </article>
        ${pager}
        <footer class="page-foot">
          <a href="${REPO_URL}/edit/main/doc/${page.file}" target="_blank" rel="noreferrer">Edit this page</a>
        </footer>
      </main>
    </div>
  </div>
  <div class="menu-backdrop" data-menu-close></div>
  <p id="copy-status" class="visually-hidden" role="status"></p>
  <div class="search-dialog" id="search-dialog" hidden>
    <div class="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-title">
      <h2 class="visually-hidden" id="search-title">Search documentation</h2>
      <div class="search-field">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
        <input id="search-input" type="search" placeholder="Search the docs" autocomplete="off" spellcheck="false" aria-controls="search-results">
        <kbd>Esc</kbd>
      </div>
      <div class="search-results" id="search-results" role="listbox" aria-label="Search results"></div>
      <p class="search-hint">Type to search titles and body text. <span>↑↓</span> to move, <span>Enter</span> to open.</p>
    </div>
  </div>
</body>
</html>`;
}

function notFoundTemplate() {
  return `<!doctype html>
<html lang="en">
<head>
  ${head({ title: "Not found" })}
</head>
<body class="not-found">
  <main>
    <a class="brand" href="/">${brandMark()}<span class="brand-name">community-bot</span></a>
    <p class="eyebrow">404</p>
    <h1>This page never made it to memory.</h1>
    <p>The address may have changed, or the page was removed. The docs start at the overview.</p>
    <p><a class="text-link" href="/">Back to the overview</a></p>
  </main>
</body>
</html>`;
}

// ---------- discover pages ----------

const pages = [];
for (const file of (await readdir(docRoot)).filter((name) => name.endsWith(".md")).sort()) {
  const source = await readFile(path.join(docRoot, file), "utf8");
  const { data, body } = parseFrontmatter(source, file);
  const slug = file === "index.md" ? "" : file.replace(/\.md$/, "");
  pages.push({
    file,
    slug,
    href: slug ? `/${slug}/` : "/",
    title: data.title,
    nav: data.nav ?? data.title,
    group: data.group,
    order: Number(data.order),
    description: data.description,
    body,
    toc: [],
    index: 0,
  });
}
pages.sort(
  (a, b) =>
    GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
    a.order - b.order ||
    a.nav.localeCompare(b.nav),
);
pages.forEach((page, index) => (page.index = index));

// ---------- render ----------

const diagrams = new Map();
for (const name of await readdir(path.join(siteRoot, "diagrams"))) {
  if (!name.endsWith(".svg")) continue;
  const svg = (await readFile(path.join(siteRoot, "diagrams", name), "utf8")).replace(/<\?xml[^>]*\?>/g, "");
  diagrams.set(name.slice(0, -4), svg);
}
function diagram(name, file) {
  const svg = diagrams.get(name);
  if (!svg) throw new Error(`${file}: unknown diagram "${name}"`);
  return svg;
}

await rm(outRoot, { recursive: true, force: true });
await mkdir(outRoot, { recursive: true });

const searchIndex = [];
const built = new Map();
for (const page of pages) {
  const { html, toc, sections } = renderMarkdown(page);
  page.toc = toc;
  const content = html.replace(/<div data-diagram="([a-z0-9-]+)"><\/div>/g, (_, name) =>
    diagram(name, page.file),
  );
  const full = pageTemplate(page, content);
  const dir = page.slug ? path.join(outRoot, page.slug) : outRoot;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.html"), full);
  built.set(page.href, {
    file: page.file,
    html: full,
    ids: new Set([...full.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])),
  });
  for (const section of sections) {
    searchIndex.push({
      page: page.nav,
      title: section.title || page.nav,
      href: section.anchor ? `${page.href}#${section.anchor}` : page.href,
      text: section.text,
    });
  }
}

await writeFile(path.join(outRoot, "404.html"), notFoundTemplate());
await writeFile(path.join(outRoot, "search-index.json"), JSON.stringify(searchIndex));
await writeFile(path.join(outRoot, "robots.txt"), "User-agent: *\nAllow: /\n");

await cp(path.join(siteRoot, "assets"), path.join(outRoot, "assets"), { recursive: true });
const styleFiles = (await readdir(path.join(siteRoot, "styles"))).filter((name) => name.endsWith(".css")).sort();
const styles = await Promise.all(styleFiles.map((name) => readFile(path.join(siteRoot, "styles", name), "utf8")));
await writeFile(path.join(outRoot, "assets", "style.css"), styles.join("\n"));

// ---------- link check ----------

const routes = new Set(pages.map((page) => page.href));
const problems = [];
for (const entry of built.values()) {
  for (const match of entry.html.matchAll(/\shref="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith("#")) {
      if (href.length > 1 && !entry.ids.has(href.slice(1))) {
        problems.push(`${entry.file}: ${href} (no anchor)`);
      }
      continue;
    }
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    if (href.startsWith("/assets/") || href === "/search-index.json" || href === "/robots.txt") continue;
    const [pathname, hash] = href.split("#");
    const target = pathname === "/" ? "/" : pathname.endsWith("/") ? pathname : `${pathname}/`;
    if (!routes.has(target)) {
      problems.push(`${entry.file}: ${href} (no page)`);
      continue;
    }
    if (hash && !built.get(target)?.ids.has(hash)) {
      problems.push(`${entry.file}: ${href} (no anchor)`);
    }
  }
}

if (problems.length) {
  console.error(`Broken links:\n${problems.map((line) => `  ${line}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Built ${pages.length} pages, ${searchIndex.length} search sections, ${JSON.stringify(searchIndex).length} bytes of index.`);
}
