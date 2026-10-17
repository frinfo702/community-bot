(() => {
  const dialog = document.getElementById("search-dialog");
  const input = document.getElementById("search-input");
  const results = document.getElementById("search-results");
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.querySelector("[data-menu]");
  if (!dialog || !input || !results || !sidebar || !menuButton) return;

  const copyStatus = document.getElementById("copy-status");
  const menuBackdrop = document.querySelector("[data-menu-close]");
  const openers = document.querySelectorAll("[data-search-open]");
  const mobileQuery = window.matchMedia("(max-width: 960px)");

  let entries = null;
  let loading = false;
  let selected = 0;
  let activeResults = [];
  let lastFocus = null;

  sidebar.inert = mobileQuery.matches;

  // The sidebar is its own scroll container. Keep its position across the
  // full-page navigations so the navigation does not jump to the top.
  const sidebarScrollKey = "docs:sidebar-scroll";
  const savedSidebarScroll = Number(sessionStorage.getItem(sidebarScrollKey));
  if (savedSidebarScroll > 0) sidebar.scrollTop = savedSidebarScroll;
  sidebar.addEventListener(
    "scroll",
    () => sessionStorage.setItem(sidebarScrollKey, String(sidebar.scrollTop)),
    { passive: true },
  );

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  for (const kbd of document.querySelectorAll(".search-trigger kbd")) {
    kbd.textContent = isMac ? "⌘K" : "Ctrl K";
  }

  // ---------- search ----------

  const escapeHtml = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const queryTokens = (query) => [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];

  function highlight(text, query) {
    const tokens = queryTokens(query);
    if (!tokens.length) return escapeHtml(text);
    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
    return escapeHtml(text).replace(pattern, "<mark>$1</mark>");
  }

  function snippet(text, query) {
    const first = queryTokens(query)[0] ?? "";
    const at = first ? text.toLowerCase().indexOf(first) : -1;
    if (at < 0 || text.length <= 150) return text;
    const start = Math.max(0, at - 45);
    const end = Math.min(text.length, start + 155);
    return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
  }

  function scoreEntry(entry, query, tokens) {
    const page = entry.page.toLowerCase();
    const title = entry.title.toLowerCase();
    const text = entry.text.toLowerCase();
    if (!tokens.every((token) => `${page} ${title} ${text}`.includes(token))) return null;

    let score = 0;
    if (title === query) score += 60;
    if (title.includes(query)) score += 24;
    if (page.includes(query)) score += 10;
    for (const token of tokens) {
      if (title.startsWith(token)) score += 14;
      else if (title.includes(token)) score += 9;
      if (page.includes(token)) score += 4;
      score += Math.min(text.split(token).length - 1, 5);
    }
    return score;
  }

  function loadIndex() {
    if (entries || loading) return;
    loading = true;
    fetch("/search-index.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        entries = data;
        if (!dialog.hidden) search(input.value, true);
      })
      .catch(() => {
        entries = [];
        if (!dialog.hidden) {
          results.innerHTML = '<p class="search-empty">Search is unavailable right now.</p>';
        }
      })
      .finally(() => {
        loading = false;
      });
  }

  function search(rawQuery, force = false) {
    if (!entries) return;
    const query = rawQuery.trim();
    const tokens = queryTokens(query);
    if (!query || (!force && query.length < 2)) {
      activeResults = [];
      selected = 0;
      results.innerHTML = "";
      input.removeAttribute("aria-activedescendant");
      return;
    }

    activeResults = entries
      .map((entry) => ({ entry, score: scoreEntry(entry, query.toLowerCase(), tokens) }))
      .filter((scored) => scored.score !== null)
      .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
      .slice(0, 12)
      .map(({ entry }) => entry);
    selected = 0;
    renderResults(query);
  }

  function renderResults(query) {
    if (!activeResults.length) {
      results.innerHTML = `<p class="search-empty">No matches for “${escapeHtml(query)}”.</p>`;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    results.innerHTML = activeResults
      .map(
        (entry, index) => `<a class="search-result" id="search-result-${index}" role="option" aria-selected="${index === selected}" href="${escapeHtml(entry.href)}">
          <span class="result-meta"><span>${escapeHtml(entry.page)}</span>${entry.title !== entry.page ? `<span aria-hidden="true">/</span><span>${escapeHtml(entry.title)}</span>` : ""}</span>
          <span class="result-title">${highlight(entry.title, query)}</span>
          <span class="result-text">${highlight(snippet(entry.text, query), query)}</span>
        </a>`,
      )
      .join("");
    input.setAttribute("aria-activedescendant", "search-result-0");
  }

  function moveSelection(delta) {
    if (!activeResults.length) return;
    selected = (selected + delta + activeResults.length) % activeResults.length;
    for (const [index, node] of [...results.querySelectorAll(".search-result")].entries()) {
      node.setAttribute("aria-selected", String(index === selected));
    }
    input.setAttribute("aria-activedescendant", `search-result-${selected}`);
    results.querySelector(`#search-result-${selected}`)?.scrollIntoView({ block: "nearest" });
  }

  function openSearch() {
    if (!dialog.hidden) return;
    const opener = document.activeElement;
    // The sidebar goes inert when its menu closes, so focus returns to the menu button.
    lastFocus = sidebar.contains(opener) ? menuButton : opener;
    if (sidebar.classList.contains("is-open")) setMenu(false, { focus: false });
    dialog.hidden = false;
    document.body.classList.add("search-open");
    loadIndex();
    input.value = "";
    results.innerHTML = "";
    activeResults = [];
    selected = 0;
    input.focus();
  }

  function closeSearch() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    document.body.classList.remove("search-open");
    if (lastFocus?.focus) lastFocus.focus();
  }

  openers.forEach((opener) => opener.addEventListener("click", openSearch));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeSearch();
  });
  input.addEventListener("input", () => search(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Enter" && activeResults[selected]) {
      event.preventDefault();
      window.location.href = activeResults[selected].href;
    }
  });
  results.addEventListener("click", (event) => {
    if (event.target.closest(".search-result")) closeSearch();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = [
      ...dialog.querySelectorAll("input, a[href], button:not([disabled])"),
    ].filter((element) => element.getClientRects().length > 0);
    if (!focusables.length) return;
    const [first] = focusables;
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.matches("input, textarea, select") || event.target.isContentEditable);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog.hidden) openSearch();
      else closeSearch();
      return;
    }
    if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape") {
      if (!dialog.hidden) {
        event.preventDefault();
        closeSearch();
      } else if (sidebar.classList.contains("is-open")) {
        setMenu(false);
      }
    }
  });

  // ---------- copy ----------

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy");
    if (!button) return;
    const code = button.closest(".code-block")?.querySelector("pre code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const area = document.createElement("textarea");
      area.value = code;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "Copied");
    if (copyStatus) copyStatus.textContent = "Code copied to clipboard";
    window.setTimeout(() => {
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", "Copy code");
      if (copyStatus) copyStatus.textContent = "";
    }, 1600);
  });

  // ---------- mobile menu ----------

  function setMenu(open, { focus = true } = {}) {
    sidebar.classList.toggle("is-open", open);
    sidebar.inert = mobileQuery.matches ? !open : false;
    document.body.classList.toggle("menu-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    if (open) {
      (sidebar.querySelector(".nav-link.is-active") ?? menuButton).focus();
    } else if (focus) {
      menuButton.focus();
    }
  }

  menuButton.addEventListener("click", () => setMenu(!sidebar.classList.contains("is-open")));
  menuBackdrop?.addEventListener("click", () => setMenu(false));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a") && sidebar.classList.contains("is-open")) {
      setMenu(false, { focus: false });
    }
  });
  window.addEventListener("resize", () => {
    if (!mobileQuery.matches) {
      sidebar.inert = false;
      if (sidebar.classList.contains("is-open")) setMenu(false, { focus: false });
    } else if (!sidebar.classList.contains("is-open")) {
      sidebar.inert = true;
    }
  });

  // ---------- scrollspy ----------

  const subs = [...document.querySelectorAll(".nav-sub[data-heading]")];
  const headings = subs.map((link) => document.getElementById(link.dataset.heading)).filter(Boolean);
  if (headings.length) {
    let ticking = false;
    const update = () => {
      ticking = false;
      let current = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 128) current = heading.id;
        else break;
      }
      for (const link of subs) {
        const active = link.dataset.heading === current;
        link.classList.toggle("is-current", active);
        if (active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    };
    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }
})();
