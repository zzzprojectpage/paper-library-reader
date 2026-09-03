import {
  deleteAnnotation,
  getSetting,
  listAnnotations,
  patchBook,
  saveAnnotation,
  setSetting
} from "./storage.js";
import {
  clamp,
  element,
  formatAuthors,
  formatDate,
  formatPercent,
  getErrorMessage,
  icon,
  isTextEntry
} from "./utils.js";

const DEFAULT_SETTINGS = {
  theme: "sepia",
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: 105,
  fontWeight: 400,
  lineHeight: 1.72,
  paragraphSpacing: 0.9,
  margin: 8,
  flow: "paginated",
  spread: "auto",
  pdfZoom: "fit-page"
};

const FONT_FAMILIES = new Set([
  "Georgia, 'Times New Roman', serif",
  "ui-sans-serif, system-ui, sans-serif",
  "'Trebuchet MS', ui-sans-serif, sans-serif"
]);

const THEMES = {
  light: {
    ink: "#2c2925",
    paper: "#fffdf7",
    chrome: "#e8e1d6",
    toolbar: "rgb(250 247 240 / 96%)"
  },
  sepia: {
    ink: "#3b3024",
    paper: "#f4e8cf",
    chrome: "#cdbb9e",
    toolbar: "rgb(239 226 202 / 96%)"
  },
  dark: {
    ink: "#e9e5df",
    paper: "#1e1f20",
    chrome: "#141516",
    toolbar: "rgb(37 38 39 / 96%)"
  },
  contrast: {
    ink: "#ffffff",
    paper: "#000000",
    chrome: "#000000",
    toolbar: "#000000"
  }
};

export class FoliateReaderController {
  constructor(mount, bookRecord, callbacks = {}) {
    this.mount = mount;
    this.record = bookRecord;
    this.onToast = callbacks.onToast || (() => {});
    this.onBookUpdated = callbacks.onBookUpdated || (() => {});
    this.abortController = new AbortController();
    this.settings = { ...DEFAULT_SETTINGS };
    this.annotations = [];
    this.currentCfi = "";
    this.currentProgress = Number(bookRecord.progress) || 0;
    this.activePanel = "";
    this.persistTimer = null;
    this.touchStart = null;
    this.pdfRenderCount = 0;
  }

  async init() {
    if (!this.record?.fileBlob) throw new Error("This book has no locally stored file.");
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await getSetting("readerPreferences", DEFAULT_SETTINGS))
    };
    this.renderChrome();
    this.bindChrome();
    this.applyChromeTheme();

    await import("../vendor/foliate-js/view.js?v=14");
    const type = this.record.format === "pdf"
      ? "application/pdf"
      : "application/x-mobipocket-ebook";
    const file = new File([this.record.fileBlob], this.record.fileName, { type });
    this.view = document.createElement("foliate-view");
    this.view.className = "foliate-document-view";
    this.view.dataset.format = this.record.format;
    this.view.addEventListener("load", (event) => this.handleDocumentLoad(event.detail));
    this.view.addEventListener("relocate", (event) => this.handleRelocate(event.detail));
    this.view.addEventListener("external-link", (event) => {
      event.preventDefault();
      this.onToast("External links inside books are blocked for privacy.", "error");
    });
    this.viewer.append(this.view);

    try {
      await this.view.open(file);
      this.book = this.view.book;
      this.titleElement.textContent = this.record.title || "Untitled";
      this.authorElement.textContent = formatAuthors(this.record.authors);
      this.annotations = await listAnnotations(this.record.id);
      this.applyLayoutSettings();
      const lastLocation = this.record.lastLocation
        || (this.currentProgress > 0 ? { fraction: this.currentProgress } : null);
      await this.view.init({ lastLocation, showTextStart: true });
      this.updateBookmarkState();
      this.loader.hidden = true;
    } catch (error) {
      await this.destroy();
      throw new Error(
        `${this.record.format.toUpperCase()} could not be opened: ${getErrorMessage(error)}`,
        { cause: error }
      );
    }
  }

  renderChrome() {
    this.mount.replaceChildren();
    this.shell = element("section", {
      className: "reader-shell",
      "aria-label": `${this.record.format.toUpperCase()} reader`
    });

    const backButton = this.iconButton("back", "Back to Own Books", "back");
    this.titleElement = element("strong", { text: this.record.title || "Opening book" });
    this.authorElement = element("span", { text: formatAuthors(this.record.authors) });
    const identity = element("div", { className: "reader-book-identity" }, [
      this.titleElement,
      this.authorElement
    ]);

    const actions = element("div", { className: "reader-actions", "aria-label": "Reader tools" });
    [
      ["toc", "Table of contents", "menu"],
      ["search", "Search in book", "search"],
      ["refresh", "Refresh page", "refresh"],
      ["bookmarks", "Bookmarks", "bookmark"],
      ["settings", "Reading settings", "settings"],
      ["fullscreen", "Full screen", "expand"]
    ].forEach(([action, label, iconName]) => {
      actions.append(this.iconButton(action, label, iconName));
    });
    const titlebar = element("header", { className: "reader-titlebar" }, [
      backButton,
      identity,
      actions
    ]);

    this.panelTitle = element("h2", { text: "Reader tools" });
    this.panelContent = element("div", { className: "panel-content" });
    this.panel = element("aside", {
      id: "readerPanel",
      className: "reader-panel",
      "aria-label": "Reader tools",
      hidden: true
    }, [
      element("div", { className: "panel-header" }, [
        this.panelTitle,
        this.iconButton("close-panel", "Close panel", "close")
      ]),
      this.panelContent
    ]);

    const previousPage = this.pageButton("prev", "Previous page", "chevronLeft");
    this.viewer = element("div", {
      id: "viewer",
      className: "foliate-view-host",
      tabindex: "0",
      "aria-label": "Book content"
    });
    this.loader = element("div", { className: "reader-loader", role: "status" }, [
      element("div", {}, [
        element("div", { className: "spinner", "aria-hidden": "true" }),
        element("span", { text: `Opening ${this.record.format.toUpperCase()}...` })
      ])
    ]);
    this.viewerShell = element("div", { className: "viewer-shell" }, [
      this.viewer,
      this.loader
    ]);
    const nextPage = this.pageButton("next", "Next page", "chevronRight");
    const stage = element("div", { className: "paper-stage" }, [
      previousPage,
      this.viewerShell,
      nextPage
    ]);

    this.bookmarkButton = this.iconButton(
      "toggle-bookmark",
      "Bookmark this location",
      "bookmark"
    );
    this.bookmarkButton.setAttribute("aria-pressed", "false");
    this.locationSlider = element("input", {
      type: "range",
      min: "0",
      max: "1000",
      step: "1",
      value: String(Math.round(this.currentProgress * 1000)),
      "aria-label": "Reading position"
    });
    this.percentElement = element("span", {
      className: "reader-percent",
      text: formatPercent(this.currentProgress)
    });
    const footer = element("footer", { className: "reader-footer" }, [
      this.bookmarkButton,
      element("div", { className: "location-control" }, [
        this.locationSlider,
        this.percentElement
      ])
    ]);

    this.shell.append(
      titlebar,
      element("div", { className: "reader-main" }, [this.panel, stage]),
      footer
    );
    this.mount.append(this.shell);
  }

  iconButton(action, label, iconName) {
    const button = element("button", {
      className: "icon-button",
      type: "button",
      dataset: { readerAction: action },
      "aria-label": label,
      title: label
    }, [icon(iconName)]);
    if (["toc", "search", "bookmarks", "settings"].includes(action)) {
      button.setAttribute("aria-controls", "readerPanel");
      button.setAttribute("aria-expanded", "false");
    }
    return button;
  }

  pageButton(direction, label, iconName) {
    return element("button", {
      className: "page-turn",
      type: "button",
      dataset: { direction },
      "aria-label": label,
      title: label
    }, [icon(iconName)]);
  }

  bindChrome() {
    const signal = this.abortController.signal;
    this.shell.addEventListener("click", (event) => {
      this.handleClick(event).catch((error) => this.onToast(getErrorMessage(error), "error"));
    }, { signal });
    this.locationSlider.addEventListener("change", () => {
      this.seekToSlider().catch((error) => this.onToast(getErrorMessage(error), "error"));
    }, { signal });
    document.addEventListener("keydown", (event) => this.handleKeydown(event), { signal });
    document.addEventListener("fullscreenchange", () => {
      const button = this.shell.querySelector('[data-reader-action="fullscreen"]');
      button?.setAttribute(
        "aria-label",
        document.fullscreenElement ? "Exit full screen" : "Full screen"
      );
    }, { signal });
  }

  async handleClick(event) {
    const actionButton = event.target.closest("[data-reader-action]");
    if (actionButton) {
      const action = actionButton.dataset.readerAction;
      if (action === "back") location.hash = "#/own-books";
      else if (action === "close-panel") this.closePanel();
      else if (["toc", "search", "bookmarks", "settings"].includes(action)) {
        this.openPanel(action);
      } else if (action === "refresh") await this.refresh();
      else if (action === "fullscreen") await this.toggleFullscreen();
      else if (action === "toggle-bookmark") await this.toggleBookmark();
      return;
    }

    const pageButton = event.target.closest("[data-direction]");
    if (pageButton) await this.turnPage(pageButton.dataset.direction);
  }

  handleDocumentLoad({ doc }) {
    if (!doc) return;
    doc.querySelectorAll("script, object, embed, iframe, form, meta[http-equiv='refresh']")
      .forEach((node) => node.remove());
    doc.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLocaleLowerCase();
        const value = attribute.value.trim().toLocaleLowerCase();
        if (name.startsWith("on") || name === "srcdoc") node.removeAttribute(attribute.name);
        if ((name === "src" || name === "href") && value.startsWith("javascript:")) {
          node.removeAttribute(attribute.name);
        }
        if (name === "src" && /^https?:/.test(value)) node.removeAttribute(attribute.name);
      }
    });
    doc.querySelectorAll("link[rel='stylesheet']").forEach((link) => {
      if (/^https?:/i.test(link.getAttribute("href") || "")) link.remove();
    });
    doc.addEventListener("keydown", (event) => this.handleKeydown(event), {
      signal: this.abortController.signal
    });
    if (this.record.format === "pdf") {
      doc.addEventListener("pdf-rendered", () => {
        this.pdfRenderCount += 1;
        this.view.dataset.rendered = "true";
        this.view.dataset.renderCount = String(this.pdfRenderCount);
      }, { signal: this.abortController.signal });
    }
    doc.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (touch) this.touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true, signal: this.abortController.signal });
    doc.addEventListener("touchend", (event) => {
      const touch = event.changedTouches[0];
      if (!touch || !this.touchStart) return;
      const deltaX = touch.clientX - this.touchStart.x;
      const deltaY = touch.clientY - this.touchStart.y;
      this.touchStart = null;
      const selection = doc.defaultView?.getSelection?.().toString().trim();
      if (selection || Math.abs(deltaX) < 60 || Math.abs(deltaY) > 55) return;
      this.turnPage(deltaX > 0 ? "prev" : "next")
        .catch((error) => this.onToast(getErrorMessage(error), "error"));
    }, { passive: true, signal: this.abortController.signal });
    this.applyDocumentTheme(doc);
  }

  applyDocumentTheme(doc) {
    if (this.record.format === "pdf") return;
    const theme = THEMES[this.settings.theme] || THEMES.sepia;
    const fontFamily = FONT_FAMILIES.has(this.settings.fontFamily)
      ? this.settings.fontFamily
      : DEFAULT_SETTINGS.fontFamily;
    let style = doc.querySelector("#paper-library-document-style");
    if (!style) {
      style = doc.createElement("style");
      style.id = "paper-library-document-style";
      doc.head.append(style);
    }
    style.textContent = `
      :root { color-scheme: ${this.settings.theme === "dark" ? "dark" : "light"}; }
      html, body { background-color: ${theme.paper} !important; color: ${theme.ink} !important; }
      body {
        box-sizing: border-box;
        padding-inline: ${clamp(this.settings.margin, 0, 16)}% !important;
        font-family: ${fontFamily} !important;
        font-size: ${clamp(this.settings.fontSize, 70, 180)}% !important;
        font-weight: ${clamp(this.settings.fontWeight, 300, 700)} !important;
        line-height: ${clamp(this.settings.lineHeight, 1.2, 2.2)} !important;
        background-image: radial-gradient(circle at 20% 10%, rgba(122, 90, 43, 0.035) 0 1px, transparent 1.5px) !important;
        background-size: 7px 7px !important;
      }
      p { margin-block-end: ${clamp(this.settings.paragraphSpacing, 0, 2.5)}em !important; }
      img, svg { max-width: 100% !important; height: auto !important; }
      a { color: ${this.settings.theme === "dark" ? "#e5a77f" : "#7c4025"} !important; }
    `;
  }

  applyLayoutSettings() {
    if (!this.view?.renderer) return;
    this.applyChromeTheme();
    if (this.record.format === "pdf") {
      this.view.dataset.rendered = "false";
      this.view.renderer.setAttribute("zoom", this.settings.pdfZoom || "fit-page");
      this.view.dataset.theme = this.settings.theme;
      return;
    }
    this.view.renderer.setAttribute("flow", this.settings.flow);
    this.view.renderer.setAttribute("gap", "4%");
    this.view.renderer.setAttribute("margin", "0px");
    this.view.renderer.setAttribute("max-inline-size", "720px");
    this.view.renderer.setAttribute(
      "max-column-count",
      this.settings.spread === "single" ? "1" : "2"
    );
    this.view.renderer.getContents?.().forEach(({ doc }) => this.applyDocumentTheme(doc));
  }

  applyChromeTheme() {
    if (!this.shell) return;
    const theme = THEMES[this.settings.theme] || THEMES.sepia;
    this.shell.dataset.theme = this.settings.theme;
    this.shell.dataset.flow = this.record.format === "pdf" ? "paginated" : this.settings.flow;
    this.shell.dataset.spread = this.record.format === "pdf" ? "single" : this.settings.spread;
    this.shell.style.setProperty("--reader-chrome", theme.chrome);
    this.shell.style.setProperty("--paper", theme.paper);
    this.shell.style.setProperty("--reader-chrome-ink", theme.ink);
    this.shell.style.setProperty("--reader-toolbar", theme.toolbar);
    if (this.view) this.view.dataset.theme = this.settings.theme;
  }

  handleRelocate(detail) {
    const fraction = clamp(detail?.fraction ?? this.currentProgress, 0, 1);
    this.currentProgress = fraction;
    this.currentCfi = detail?.cfi || this.currentCfi;
    this.currentChapter = detail?.tocItem?.label || "";
    this.locationSlider.value = String(Math.round(fraction * 1000));
    this.percentElement.textContent = formatPercent(fraction);
    this.updateBookmarkState();
    this.scheduleProgressSave();
  }

  scheduleProgressSave() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(async () => {
      const status = this.currentProgress >= 0.985
        ? "finished"
        : this.record.status === "finished" ? "finished" : "reading";
      try {
        this.record = await patchBook(this.record.id, {
          lastLocation: this.currentCfi || { fraction: this.currentProgress },
          progress: this.currentProgress,
          lastOpenedAt: new Date().toISOString(),
          status
        });
        this.onBookUpdated(this.record);
      } catch (error) {
        this.onToast(getErrorMessage(error), "error");
      }
    }, 500);
  }

  async turnPage(direction) {
    if (!this.view) return;
    if (direction === "prev") await this.view.prev();
    else await this.view.next();
  }

  async seekToSlider() {
    if (!this.view) return;
    const fraction = clamp(Number(this.locationSlider.value) / 1000, 0, 1);
    await this.view.goToFraction(fraction);
  }

  handleKeydown(event) {
    if (isTextEntry(event.target)) return;
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      this.turnPage("next").catch((error) => this.onToast(getErrorMessage(error), "error"));
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      this.turnPage("prev").catch((error) => this.onToast(getErrorMessage(error), "error"));
    } else if (event.key === "/") {
      event.preventDefault();
      this.openPanel("search");
    } else if (event.key.toLocaleLowerCase() === "b") {
      event.preventDefault();
      this.toggleBookmark().catch((error) => this.onToast(getErrorMessage(error), "error"));
    } else if (event.key === "Escape" && !this.panel.hidden) {
      this.closePanel();
    }
  }

  openPanel(kind) {
    if (this.activePanel === kind && !this.panel.hidden) {
      this.closePanel();
      return;
    }
    this.activePanel = kind;
    this.panel.hidden = false;
    this.shell.querySelectorAll("[aria-controls='readerPanel']").forEach((button) => {
      button.setAttribute("aria-expanded", String(button.dataset.readerAction === kind));
    });
    const renderer = {
      toc: () => this.renderToc(),
      search: () => this.renderSearch(),
      bookmarks: () => this.renderBookmarks(),
      settings: () => this.renderSettings()
    }[kind];
    renderer?.();
    this.panel.querySelector("button, input, select")?.focus();
  }

  closePanel() {
    this.panel.hidden = true;
    this.activePanel = "";
    this.shell.querySelectorAll("[aria-controls='readerPanel']").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
    this.viewer.focus();
  }

  renderToc() {
    this.panelTitle.textContent = "Table of contents";
    this.panelContent.replaceChildren();
    const list = this.buildTocList(this.book?.toc || []);
    if (list.children.length) this.panelContent.append(list);
    else this.panelContent.append(element("p", { text: "This document has no table of contents." }));
  }

  buildTocList(items) {
    const list = element("ul", { className: "panel-list" });
    for (const item of items) {
      const button = element("button", {
        type: "button",
        text: String(item.label || "Untitled section").trim(),
        onclick: async () => {
          await this.view.goTo(item.href);
          this.closePanel();
        }
      });
      const listItem = element("li", {}, [button]);
      const children = item.subitems || item.children || [];
      if (children.length) listItem.append(this.buildTocList(children));
      list.append(listItem);
    }
    return list;
  }

  renderSearch() {
    this.panelTitle.textContent = "Search in book";
    this.panelContent.replaceChildren();
    const input = element("input", {
      id: "bookSearchInput",
      className: "text-input",
      type: "search",
      required: true,
      minlength: "2",
      autocomplete: "off",
      placeholder: "Word or phrase"
    });
    const submit = element("button", {
      className: "button button-primary",
      type: "submit",
      text: "Search"
    });
    const form = element("form", { className: "search-row", role: "search" }, [input, submit]);
    const status = element("p", {
      className: "result-count",
      role: "status",
      text: "Search the full text of this MOBI."
    });
    const results = element("div", { className: "panel-list" });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (query.length < 2) return;
      submit.disabled = true;
      status.textContent = "Searching all sections...";
      results.replaceChildren();
      try {
        const matches = this.record.format === "pdf"
          ? await this.searchPdf(query, status)
          : await this.searchMobi(query);
        status.textContent = matches.length
          ? `${matches.length} result${matches.length === 1 ? "" : "s"}`
          : "No matches found.";
        matches.slice(0, 100).forEach((match) => {
          results.append(element("div", { className: "search-result" }, [
            element("button", {
              type: "button",
              text: this.formatSearchExcerpt(match.excerpt),
              onclick: async () => {
                if (typeof match.index === "number") await this.view.goTo(match.index);
                else await this.view.goTo(match.cfi);
                this.closePanel();
              }
            })
          ]));
        });
      } catch (error) {
        status.textContent = getErrorMessage(error);
      } finally {
        submit.disabled = false;
      }
    });
    status.textContent = this.record.format === "pdf"
      ? "Search text extracted from this PDF."
      : "Search the full text of this MOBI.";
    this.panelContent.append(form, status, results);
    input.focus();
  }

  async searchMobi(query) {
    const matches = [];
    for await (const group of this.view.search({ query })) {
      if (!group.subitems) continue;
      matches.push(...group.subitems);
      if (matches.length >= 100) break;
    }
    return matches.slice(0, 100);
  }

  async searchPdf(query, status) {
    if (!this.book?.getPageText) throw new Error("PDF text extraction is unavailable.");
    const needle = query.toLocaleLowerCase();
    const matches = [];
    for (let index = 0; index < this.book.sections.length; index += 1) {
      status.textContent = `Searching page ${index + 1} of ${this.book.sections.length}...`;
      const text = await this.book.getPageText(index);
      const matchIndex = text.toLocaleLowerCase().indexOf(needle);
      if (matchIndex < 0) continue;
      const start = Math.max(0, matchIndex - 50);
      const end = Math.min(text.length, matchIndex + query.length + 50);
      matches.push({
        index,
        excerpt: `${start ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`
      });
      if (matches.length >= 100) break;
    }
    return matches;
  }

  formatSearchExcerpt(excerpt) {
    if (!excerpt) return "Open match";
    if (typeof excerpt === "string") return excerpt;
    return `${excerpt.pre || ""}${excerpt.match || ""}${excerpt.post || ""}`;
  }

  async toggleBookmark() {
    const value = this.currentCfi || `fraction:${this.currentProgress.toFixed(6)}`;
    const existing = this.annotations.find(
      (annotation) => annotation.type === "bookmark" && annotation.cfi === value
    );
    if (existing) {
      await deleteAnnotation(existing.id);
      this.annotations = this.annotations.filter((annotation) => annotation.id !== existing.id);
      this.onToast("Bookmark removed.");
    } else {
      const annotation = await saveAnnotation({
        bookId: this.record.id,
        type: "bookmark",
        cfi: value,
        label: this.currentChapter || `${this.record.format.toUpperCase()} location`,
        progress: this.currentProgress
      });
      this.annotations.unshift(annotation);
      this.onToast("Bookmark saved.", "success");
    }
    this.updateBookmarkState();
    if (this.activePanel === "bookmarks") this.renderBookmarks();
  }

  updateBookmarkState() {
    if (!this.bookmarkButton) return;
    const value = this.currentCfi || `fraction:${this.currentProgress.toFixed(6)}`;
    const bookmarked = this.annotations.some(
      (annotation) => annotation.type === "bookmark" && annotation.cfi === value
    );
    this.bookmarkButton.setAttribute("aria-pressed", String(bookmarked));
  }

  renderBookmarks() {
    this.panelTitle.textContent = "Bookmarks";
    this.panelContent.replaceChildren();
    const records = this.annotations.filter((annotation) => annotation.type === "bookmark");
    if (!records.length) {
      this.panelContent.append(element("p", {
        text: "No bookmarks yet. Press B or use the bookmark button to save this location."
      }));
      return;
    }

    const list = element("div", { className: "panel-list" });
    records.forEach((annotation) => {
      const openButton = element("button", {
        className: "mini-button",
        type: "button",
        text: "Open",
        onclick: async () => {
          if (annotation.cfi.startsWith("fraction:")) {
            await this.view.goToFraction(Number(annotation.cfi.slice(9)));
          } else {
            await this.view.goTo(annotation.cfi);
          }
          this.closePanel();
        }
      });
      const deleteButton = element("button", {
        className: "mini-button",
        type: "button",
        text: "Delete",
        onclick: async () => {
          await deleteAnnotation(annotation.id);
          this.annotations = this.annotations.filter((item) => item.id !== annotation.id);
          this.renderBookmarks();
          this.updateBookmarkState();
        }
      });
      list.append(element("article", { className: "annotation-item" }, [
        element("strong", { text: annotation.label || "Saved location" }),
        element("p", {
          text: `${formatPercent(annotation.progress)} - saved ${formatDate(annotation.createdAt)}`
        }),
        element("div", { className: "annotation-actions" }, [openButton, deleteButton])
      ]));
    });
    this.panelContent.append(list);
  }

  renderSettings() {
    this.panelTitle.textContent = "Reading settings";
    this.panelContent.replaceChildren();
    const grid = element("div", { className: "settings-grid" });
    grid.append(this.selectSetting("Theme", "theme", [
      ["light", "Light"],
      ["sepia", "Warm paper"],
      ["dark", "Dark"],
      ["contrast", "High contrast"]
    ]));

    if (this.record.format === "pdf") {
      grid.append(this.selectSetting("PDF zoom", "pdfZoom", [
        ["fit-page", "Fit page"],
        ["fit-width", "Fit width"],
        ["0.75", "75%"],
        ["1", "100%"],
        ["1.25", "125%"],
        ["1.5", "150%"]
      ]));
    } else {
      grid.append(
        this.selectSetting("Font", "fontFamily", [
          ["Georgia, 'Times New Roman', serif", "Book serif"],
          ["ui-sans-serif, system-ui, sans-serif", "Clean sans serif"],
          ["'Trebuchet MS', ui-sans-serif, sans-serif", "Wide sans serif"]
        ]),
        this.rangeSetting("Text size", "fontSize", 70, 180, 5, "%"),
        this.rangeSetting("Font weight", "fontWeight", 300, 700, 100, ""),
        this.rangeSetting("Line spacing", "lineHeight", 1.2, 2.2, 0.05, ""),
        this.rangeSetting("Paragraph spacing", "paragraphSpacing", 0, 2.5, 0.1, "em"),
        this.rangeSetting("Page margins", "margin", 0, 16, 1, "%"),
        this.selectSetting("Reading mode", "flow", [
          ["paginated", "Paginated"],
          ["scrolled", "Continuous scroll"]
        ]),
        this.selectSetting("Page layout", "spread", [
          ["auto", "Automatic"],
          ["single", "Single page"],
          ["two", "Two pages"]
        ])
      );
    }

    grid.addEventListener("change", async (event) => {
      const control = event.target.closest("[data-setting]");
      if (!control) return;
      try {
        const key = control.dataset.setting;
        const numericKeys = new Set([
          "fontSize",
          "fontWeight",
          "lineHeight",
          "paragraphSpacing",
          "margin"
        ]);
        this.settings[key] = numericKeys.has(key) ? Number(control.value) : control.value;
        await setSetting("readerPreferences", this.settings);
        this.applyLayoutSettings();
        const output = control.closest(".field")?.querySelector("output");
        if (output) output.textContent = `${control.value}${control.dataset.suffix || ""}`;
      } catch (error) {
        this.onToast(getErrorMessage(error), "error");
      }
    });
    this.panelContent.append(grid);
  }

  selectSetting(label, key, options) {
    const select = element("select", {
      className: "select-input",
      dataset: { setting: key },
      "aria-label": label
    });
    options.forEach(([value, text]) => {
      const option = element("option", { value, text });
      option.selected = String(this.settings[key]) === String(value);
      select.append(option);
    });
    return element("label", { className: "field" }, [
      element("span", { text: label }),
      select
    ]);
  }

  rangeSetting(label, key, min, max, step, suffix) {
    return element("label", { className: "field" }, [
      element("span", { text: label }),
      element("input", {
        type: "range",
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(this.settings[key]),
        dataset: { setting: key, suffix },
        "aria-label": label
      }),
      element("output", {
        className: "range-output",
        text: `${this.settings[key]}${suffix}`
      })
    ]);
  }

  async refresh() {
    if (!this.view) return;
    if (this.currentCfi) await this.view.goTo(this.currentCfi);
    else await this.view.goToFraction(this.currentProgress);
    this.applyLayoutSettings();
    this.onToast("Reader refreshed.", "success");
  }

  openSearch() {
    this.openPanel("search");
  }

  async toggleFullscreen() {
    if (!document.fullscreenEnabled || typeof this.shell.requestFullscreen !== "function") {
      throw new Error("Full screen is not available in this browser.");
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.shell.requestFullscreen();
  }

  async destroy() {
    clearTimeout(this.persistTimer);
    this.abortController.abort();
    if (this.view) {
      const book = this.view.book;
      this.view.close?.();
      book?.destroy?.();
      this.view.remove();
      this.view = undefined;
    }
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // The browser can exit fullscreen while the route changes.
      }
    }
  }
}
