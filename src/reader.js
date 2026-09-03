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
  spread: "auto"
};

const THEMES = {
  light: {
    body: {
      color: "#2c2925 !important",
      background: "#fffdf7 !important"
    },
    "a:link": { color: "#7a3b26 !important" },
    p: { "margin-bottom": "var(--paper-paragraph-spacing, 0.8em) !important" }
  },
  sepia: {
    body: {
      color: "#3b3024 !important",
      background: "#f4e8cf !important",
      "background-image": "radial-gradient(circle at 20% 10%, rgba(122, 90, 43, 0.035) 0 1px, transparent 1.5px) !important",
      "background-size": "7px 7px !important"
    },
    "a:link": { color: "#7c4025 !important" },
    p: { "margin-bottom": "var(--paper-paragraph-spacing, 0.8em) !important" }
  },
  dark: {
    body: {
      color: "#e9e5df !important",
      background: "#1e1f20 !important"
    },
    "a:link": { color: "#e5a77f !important" },
    p: { "margin-bottom": "var(--paper-paragraph-spacing, 0.8em) !important" }
  },
  contrast: {
    body: {
      color: "#ffffff !important",
      background: "#000000 !important"
    },
    "a:link": {
      color: "#ffff00 !important",
      "text-decoration": "underline !important"
    },
    p: { "margin-bottom": "var(--paper-paragraph-spacing, 0.8em) !important" }
  }
};

const CHROME_THEMES = {
  light: {
    chrome: "#e8e1d6",
    paper: "#fffdf7",
    ink: "#28241f",
    toolbar: "rgb(250 247 240 / 96%)"
  },
  sepia: {
    chrome: "#cdbb9e",
    paper: "#f4e8cf",
    ink: "#3b3024",
    toolbar: "rgb(239 226 202 / 96%)"
  },
  dark: {
    chrome: "#141516",
    paper: "#1e1f20",
    ink: "#f1eee8",
    toolbar: "rgb(37 38 39 / 96%)"
  },
  contrast: {
    chrome: "#000000",
    paper: "#000000",
    ink: "#ffffff",
    toolbar: "#000000"
  }
};

export class ReaderController {
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
    this.pendingSelection = null;
    this.persistTimer = null;
    this.pointerStart = null;
  }

  async init() {
    if (!this.record?.fileBlob) throw new Error("This book has no locally stored EPUB file.");
    if (!globalThis.ePub) throw new Error("The EPUB reader engine is unavailable.");

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await getSetting("readerPreferences", DEFAULT_SETTINGS))
    };
    this.renderChrome();
    this.bindChrome();
    this.applyChromeTheme();

    const arrayBuffer = await this.record.fileBlob.arrayBuffer();
    this.book = globalThis.ePub(arrayBuffer, {
      replacements: "blobUrl"
    });

    try {
      const [metadata, navigation] = await Promise.all([
        this.book.loaded.metadata,
        this.book.loaded.navigation,
        this.book.ready,
        this.book.opened
      ]);
      this.navigation = navigation;
      this.book.spine.hooks.serialize.register((output, section) => {
        this.injectContentPolicy(output, section);
      });
      this.titleElement.textContent = metadata.title || this.record.title || "Untitled";
      this.authorElement.textContent = formatAuthors(
        this.record.authors?.length ? this.record.authors : metadata.creator
      );

      await this.book.locations.generate(1200);
      this.annotations = await listAnnotations(this.record.id);
      await this.createRendition(this.record.lastLocation || undefined);
      this.loader.hidden = true;
    } catch (error) {
      this.destroy();
      throw new Error(`This EPUB could not be opened: ${getErrorMessage(error)}`, { cause: error });
    }
  }

  renderChrome() {
    this.mount.replaceChildren();
    this.shell = element("section", { className: "reader-shell", "aria-label": "EPUB reader" });

    const backButton = this.iconButton("back", "Back to Own Books", "back");
    this.titleElement = element("strong", { text: this.record.title || "Opening book" });
    this.authorElement = element("span", { text: formatAuthors(this.record.authors) });
    const identity = element(
      "div",
      { className: "reader-book-identity" },
      [this.titleElement, this.authorElement]
    );

    const actions = element("div", { className: "reader-actions", "aria-label": "Reader tools" });
    [
      ["toc", "Table of contents", "menu"],
      ["search", "Search in book", "search"],
      ["refresh", "Refresh page", "refresh"],
      ["bookmarks", "Bookmarks", "bookmark"],
      ["notes", "Highlights and notes", "note"],
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
    const closePanelButton = this.iconButton("close-panel", "Close panel", "close");
    const panelHeader = element("div", { className: "panel-header" }, [
      this.panelTitle,
      closePanelButton
    ]);
    this.panelContent = element("div", { className: "panel-content" });
    this.panel = element(
      "aside",
      {
        id: "readerPanel",
        className: "reader-panel",
        "aria-label": "Reader tools",
        hidden: true
      },
      [panelHeader, this.panelContent]
    );

    const previousPage = this.pageButton("prev", "Previous page", "chevronLeft");
    this.viewer = element("div", {
      id: "viewer",
      tabindex: "0",
      "aria-label": "Book content"
    });
    this.loader = element("div", { className: "reader-loader", role: "status" }, [
      element("div", {}, [
        element("div", { className: "spinner", "aria-hidden": "true" }),
        element("span", { text: "Opening your book..." })
      ])
    ]);
    this.viewerShell = element("div", { className: "viewer-shell" }, [this.viewer, this.loader]);
    const nextPage = this.pageButton("next", "Next page", "chevronRight");
    const stage = element("div", { className: "paper-stage" }, [
      previousPage,
      this.viewerShell,
      nextPage
    ]);
    const readerMain = element("div", { className: "reader-main" }, [this.panel, stage]);

    this.bookmarkButton = this.iconButton("toggle-bookmark", "Bookmark this location", "bookmark");
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
    const locationControl = element("div", { className: "location-control" }, [
      this.locationSlider,
      this.percentElement
    ]);
    const footer = element("footer", { className: "reader-footer" }, [
      this.bookmarkButton,
      locationControl
    ]);

    this.noteText = element("textarea", {
      id: "noteText",
      className: "textarea-input",
      maxlength: "4000",
      placeholder: "Add an optional note to this highlight..."
    });
    const noteLabel = element("label", { for: "noteText", text: "Note" });
    const cancelNote = element("button", {
      className: "button button-secondary",
      type: "button",
      dataset: { noteAction: "cancel" },
      text: "Cancel"
    });
    const saveNote = element("button", {
      className: "button button-primary",
      type: "button",
      dataset: { noteAction: "save" },
      text: "Save highlight"
    });
    const dialogActions = element("div", { className: "dialog-actions" }, [
      cancelNote,
      saveNote
    ]);
    this.noteDialog = element(
      "dialog",
      { className: "note-dialog", "aria-labelledby": "noteDialogTitle" },
      [
        element("div", { className: "dialog-body" }, [
          element("h2", { id: "noteDialogTitle", text: "Highlight selection" }),
          element("p", {
            text: "The selected text will be highlighted. A note is optional."
          }),
          noteLabel,
          this.noteText,
          dialogActions
        ])
      ]
    );

    this.shell.append(titlebar, readerMain, footer, this.noteDialog);
    this.mount.append(this.shell);
  }

  iconButton(action, label, iconName) {
    const button = element(
      "button",
      {
        className: "icon-button",
        type: "button",
        dataset: { readerAction: action },
        "aria-label": label,
        title: label
      },
      [icon(iconName)]
    );
    if (["toc", "search", "bookmarks", "notes", "settings"].includes(action)) {
      button.setAttribute("aria-controls", "readerPanel");
      button.setAttribute("aria-expanded", "false");
    }
    return button;
  }

  pageButton(direction, label, iconName) {
    return element(
      "button",
      {
        className: "page-turn",
        type: "button",
        dataset: { direction },
        "aria-label": label,
        title: label
      },
      [icon(iconName)]
    );
  }

  bindChrome() {
    const signal = this.abortController.signal;
    this.shell.addEventListener("click", (event) => {
      this.handleClick(event).catch((error) => this.onToast(getErrorMessage(error), "error"));
    }, { signal });
    this.locationSlider.addEventListener("change", () => this.seekToSlider(), { signal });
    this.noteDialog.addEventListener("close", () => {
      this.pendingSelection = null;
    }, { signal });
    document.addEventListener("keydown", (event) => this.handleKeydown(event), { signal });
    this.viewerShell.addEventListener("pointerdown", (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, { signal });
    this.viewerShell.addEventListener("pointerup", (event) => this.handlePointerUp(event), {
      signal
    });
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
      if (action === "back") {
        location.hash = "#/own-books";
      } else if (action === "close-panel") {
        this.closePanel();
      } else if (action === "toc" || action === "search" || action === "bookmarks"
        || action === "notes" || action === "settings") {
        this.openPanel(action);
      } else if (action === "refresh") {
        await this.refresh();
      } else if (action === "fullscreen") {
        await this.toggleFullscreen();
      } else if (action === "toggle-bookmark") {
        await this.toggleBookmark();
      }
      return;
    }

    const pageButton = event.target.closest("[data-direction]");
    if (pageButton) {
      await this.turnPage(pageButton.dataset.direction);
      return;
    }

    const noteAction = event.target.closest("[data-note-action]")?.dataset.noteAction;
    if (noteAction === "cancel") this.closeNoteDialog();
    else if (noteAction === "save") await this.saveSelectionNote();
  }

  async createRendition(location) {
    if (this.rendition) {
      this.rendition.destroy();
      this.viewer.replaceChildren();
    }

    const isScrolled = this.settings.flow === "scrolled";
    this.rendition = this.book.renderTo(this.viewer, {
      width: "100%",
      height: "100%",
      manager: isScrolled ? "continuous" : "default",
      flow: isScrolled ? "scrolled-doc" : "paginated",
      spread: this.settings.spread === "two" ? "always" : "none",
      allowScriptedContent: false
    });

    this.rendition.hooks.content.register((contents) => this.sanitizeContent(contents));
    Object.entries(THEMES).forEach(([name, rules]) => {
      this.rendition.themes.register(name, rules);
    });
    this.rendition.on("relocated", (position) => this.handleRelocated(position));
    this.rendition.on("selected", (cfiRange, contents) => {
      this.handleSelection(cfiRange, contents);
    });

    this.applyReaderSettings();
    await this.rendition.display(location);
    this.applyHighlights();
  }

  sanitizeContent(contents) {
    const documentNode = contents?.document;
    if (!documentNode) return;
    documentNode
      .querySelectorAll("script, object, embed, iframe, form, meta[http-equiv='refresh']")
      .forEach((node) => node.remove());
    documentNode.querySelectorAll("*").forEach((node) => {
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
    documentNode.querySelectorAll("a[href]").forEach((link) => {
      link.setAttribute("rel", "noopener noreferrer");
    });
    documentNode.querySelectorAll("link[rel='stylesheet']").forEach((link) => {
      const href = String(link.getAttribute("href") || "");
      if (/^https?:/i.test(href)) link.remove();
    });
    documentNode.addEventListener("keydown", (event) => this.handleKeydown(event), {
      signal: this.abortController.signal
    });
    documentNode.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (touch) this.pointerStart = { x: touch.clientX, y: touch.clientY, id: "touch" };
    }, { passive: true, signal: this.abortController.signal });
    documentNode.addEventListener("touchend", (event) => {
      const touch = event.changedTouches[0];
      if (!touch || this.pointerStart?.id !== "touch") return;
      const deltaX = touch.clientX - this.pointerStart.x;
      const deltaY = touch.clientY - this.pointerStart.y;
      this.pointerStart = null;
      const selectedText = contents.window.getSelection?.().toString().trim();
      if (selectedText || Math.abs(deltaX) < 60 || Math.abs(deltaY) > 55) return;
      this.turnPage(deltaX > 0 ? "prev" : "next")
        .catch((error) => this.onToast(getErrorMessage(error), "error"));
    }, { passive: true, signal: this.abortController.signal });
  }

  injectContentPolicy(output, section) {
    const source = String(section.output || output || "");
    if (!source || source.includes('data-paper-library-policy="true"')) return;
    const policy = [
      "default-src 'none'",
      "script-src 'none'",
      "style-src 'unsafe-inline' blob:",
      "img-src data: blob:",
      "font-src data: blob:",
      "media-src data: blob:",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'self' blob:"
    ].join("; ");
    const meta = `<meta data-paper-library-policy="true" http-equiv="Content-Security-Policy" content="${policy}" />`;
    section.output = source.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${meta}`);
  }

  applyReaderSettings() {
    if (!this.rendition) return;
    this.rendition.themes.select(this.settings.theme);
    this.rendition.themes.fontSize(`${clamp(this.settings.fontSize, 70, 180)}%`);
    this.rendition.themes.override("font-family", this.settings.fontFamily, true);
    this.rendition.themes.override("font-weight", String(this.settings.fontWeight), true);
    this.rendition.themes.override("line-height", String(this.settings.lineHeight), true);
    this.rendition.themes.override(
      "padding-left",
      `${clamp(this.settings.margin, 0, 16)}%`,
      true
    );
    this.rendition.themes.override(
      "padding-right",
      `${clamp(this.settings.margin, 0, 16)}%`,
      true
    );
    this.rendition.themes.override(
      "--paper-paragraph-spacing",
      `${clamp(this.settings.paragraphSpacing, 0, 3)}em`
    );
    this.rendition.spread(
      this.settings.spread === "two" ? "always"
        : this.settings.spread === "auto" ? "auto" : "none"
    );
    this.applyChromeTheme();
  }

  applyChromeTheme() {
    if (!this.shell) return;
    const theme = CHROME_THEMES[this.settings.theme] || CHROME_THEMES.light;
    this.shell.dataset.theme = this.settings.theme;
    this.shell.dataset.flow = this.settings.flow;
    this.shell.dataset.spread = this.settings.spread;
    this.shell.style.setProperty("--reader-chrome", theme.chrome);
    this.shell.style.setProperty("--paper", theme.paper);
    this.shell.style.setProperty("--reader-chrome-ink", theme.ink);
    this.shell.style.setProperty("--reader-toolbar", theme.toolbar);
  }

  handleRelocated(position) {
    const cfi = position?.start?.cfi || "";
    if (!cfi) return;
    let progress = this.currentProgress;
    try {
      progress = this.book.locations.percentageFromCfi(cfi);
    } catch {
      progress = position?.start?.percentage ?? progress;
    }
    progress = clamp(progress, 0, 1);
    this.currentCfi = cfi;
    this.currentProgress = progress;
    this.locationSlider.value = String(Math.round(progress * 1000));
    this.percentElement.textContent = formatPercent(progress);
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
          lastLocation: this.currentCfi,
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
    if (!this.rendition) return;
    if (direction === "prev") await this.rendition.prev();
    else await this.rendition.next();
  }

  async seekToSlider() {
    if (!this.book?.locations?.length()) return;
    const percentage = clamp(Number(this.locationSlider.value) / 1000, 0, 1);
    const cfi = this.book.locations.cfiFromPercentage(percentage);
    if (cfi) await this.rendition.display(cfi);
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

  handlePointerUp(event) {
    if (!this.pointerStart || event.pointerId !== this.pointerStart.id) return;
    const deltaX = event.clientX - this.pointerStart.x;
    const deltaY = event.clientY - this.pointerStart.y;
    this.pointerStart = null;
    const selectedText = globalThis.getSelection?.().toString().trim();
    if (selectedText || Math.abs(deltaX) < 60 || Math.abs(deltaY) > 55) return;
    this.turnPage(deltaX > 0 ? "prev" : "next")
      .catch((error) => this.onToast(getErrorMessage(error), "error"));
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
      bookmarks: () => this.renderAnnotations("bookmark"),
      notes: () => this.renderAnnotations("note"),
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
    const list = this.buildTocList(this.navigation?.toc || []);
    if (!list.children.length) {
      this.panelContent.append(element("p", { text: "This book has no table of contents." }));
    } else {
      this.panelContent.append(list);
    }
  }

  buildTocList(items) {
    const list = element("ul", { className: "panel-list" });
    for (const item of items) {
      const button = element("button", {
        type: "button",
        text: item.label?.trim() || "Untitled section",
        onclick: async () => {
          await this.rendition.display(item.href);
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
      text: "Search the full text of this EPUB."
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
        const matches = await this.searchBook(query);
        status.textContent = matches.length
          ? `${matches.length} result${matches.length === 1 ? "" : "s"}`
          : "No matches found.";
        for (const match of matches) {
          const button = element("button", {
            type: "button",
            text: match.excerpt || "Open match",
            onclick: async () => {
              await this.rendition.display(match.cfi);
              this.closePanel();
            }
          });
          results.append(element("div", { className: "search-result" }, [button]));
        }
      } catch (error) {
        status.textContent = getErrorMessage(error);
      } finally {
        submit.disabled = false;
      }
    });
    this.panelContent.append(form, status, results);
    input.focus();
  }

  async searchBook(query) {
    const results = [];
    const sections = this.book.spine?.spineItems || [];
    for (const section of sections) {
      await section.load(this.book.load.bind(this.book));
      try {
        const matches = section.find(query) || [];
        for (const match of matches) {
          results.push({ cfi: match.cfi, excerpt: match.excerpt });
          if (results.length >= 100) return results;
        }
      } finally {
        section.unload();
      }
    }
    return results;
  }

  async toggleBookmark() {
    if (!this.currentCfi) {
      this.onToast("Wait for the current location to finish loading.", "error");
      return;
    }
    const existing = this.annotations.find(
      (annotation) => annotation.type === "bookmark" && annotation.cfi === this.currentCfi
    );
    if (existing) {
      await deleteAnnotation(existing.id);
      this.annotations = this.annotations.filter((annotation) => annotation.id !== existing.id);
      this.onToast("Bookmark removed.");
    } else {
      const href = this.rendition.currentLocation()?.start?.href || "";
      const chapter = this.navigation?.get?.(href)?.label || "Saved location";
      const annotation = await saveAnnotation({
        bookId: this.record.id,
        type: "bookmark",
        cfi: this.currentCfi,
        label: chapter,
        progress: this.currentProgress
      });
      this.annotations.unshift(annotation);
      this.onToast("Bookmark saved.", "success");
    }
    this.updateBookmarkState();
    if (this.activePanel === "bookmarks") this.renderAnnotations("bookmark");
  }

  updateBookmarkState() {
    if (!this.bookmarkButton) return;
    const bookmarked = this.annotations.some(
      (annotation) => annotation.type === "bookmark" && annotation.cfi === this.currentCfi
    );
    this.bookmarkButton.setAttribute("aria-pressed", String(bookmarked));
    this.bookmarkButton.title = bookmarked ? "Remove bookmark" : "Bookmark this location";
  }

  handleSelection(cfiRange, contents) {
    const excerpt = String(contents?.window?.getSelection?.().toString() || "").trim();
    if (!excerpt || !cfiRange) return;
    this.pendingSelection = { cfi: cfiRange, excerpt: excerpt.slice(0, 1000) };
    this.noteText.value = "";
    if (typeof this.noteDialog.showModal === "function") this.noteDialog.showModal();
    else this.noteDialog.setAttribute("open", "");
    this.noteText.focus();
  }

  closeNoteDialog() {
    this.pendingSelection = null;
    if (typeof this.noteDialog.close === "function") this.noteDialog.close();
    else this.noteDialog.removeAttribute("open");
  }

  async saveSelectionNote() {
    if (!this.pendingSelection) return;
    const annotation = await saveAnnotation({
      bookId: this.record.id,
      type: "note",
      cfi: this.pendingSelection.cfi,
      excerpt: this.pendingSelection.excerpt,
      note: this.noteText.value.trim()
    });
    this.annotations.unshift(annotation);
    this.addHighlight(annotation);
    this.closeNoteDialog();
    this.onToast("Highlight saved.", "success");
    if (this.activePanel === "notes") this.renderAnnotations("note");
  }

  applyHighlights() {
    this.annotations
      .filter((annotation) => annotation.type === "note")
      .forEach((annotation) => this.addHighlight(annotation));
  }

  addHighlight(annotation) {
    try {
      this.rendition.annotations.highlight(
        annotation.cfi,
        {},
        () => {
          this.openPanel("notes");
        },
        "note-highlight",
        { fill: "#d9a441", "fill-opacity": "0.38", "mix-blend-mode": "multiply" }
      );
    } catch (error) {
      console.warn("A saved highlight could not be restored.", error);
    }
  }

  renderAnnotations(type) {
    this.panelTitle.textContent = type === "bookmark" ? "Bookmarks" : "Highlights and notes";
    this.panelContent.replaceChildren();
    const records = this.annotations.filter((annotation) => annotation.type === type);
    if (!records.length) {
      const message = type === "bookmark"
        ? "No bookmarks yet. Press B or use the bookmark button to save this location."
        : "Select text in the book to create a highlight and optional note.";
      this.panelContent.append(element("p", { text: message }));
      return;
    }

    const list = element("div", { className: "panel-list" });
    records.forEach((annotation) => {
      const title = type === "bookmark"
        ? annotation.label || `Location ${formatPercent(annotation.progress)}`
        : annotation.excerpt || "Highlighted text";
      const details = type === "bookmark"
        ? `Saved ${formatDate(annotation.createdAt)}`
        : annotation.note || `Highlighted ${formatDate(annotation.createdAt)}`;
      const openButton = element("button", {
        className: "mini-button",
        type: "button",
        text: "Open",
        onclick: async () => {
          await this.rendition.display(annotation.cfi);
          this.closePanel();
        }
      });
      const deleteButton = element("button", {
        className: "mini-button",
        type: "button",
        text: "Delete",
        onclick: async () => {
          await deleteAnnotation(annotation.id);
          if (annotation.type === "note") {
            this.rendition.annotations.remove(annotation.cfi, "highlight");
          }
          this.annotations = this.annotations.filter((item) => item.id !== annotation.id);
          this.renderAnnotations(type);
          this.updateBookmarkState();
        }
      });
      const actions = element("div", { className: "annotation-actions" }, [
        openButton,
        deleteButton
      ]);
      list.append(element("article", { className: "annotation-item" }, [
        element("strong", { text: title }),
        element("p", { text: details }),
        actions
      ]));
    });
    this.panelContent.append(list);
  }

  renderSettings() {
    this.panelTitle.textContent = "Reading settings";
    this.panelContent.replaceChildren();
    const grid = element("div", { className: "settings-grid" });

    grid.append(
      this.selectSetting("Theme", "theme", [
        ["light", "Light"],
        ["sepia", "Warm paper"],
        ["dark", "Dark"],
        ["contrast", "High contrast"]
      ]),
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
        const previousFlow = this.settings.flow;
        this.settings[key] = numericKeys.has(key) ? Number(control.value) : control.value;
        await setSetting("readerPreferences", this.settings);
        if (key === "flow" || (key === "spread" && previousFlow !== "scrolled")) {
          const location = this.currentCfi;
          this.loader.hidden = false;
          await this.createRendition(location);
          this.loader.hidden = true;
        } else {
          this.applyReaderSettings();
        }
        const output = control.closest(".field")?.querySelector("output");
        if (output) output.textContent = `${control.value}${control.dataset.suffix || ""}`;
      } catch (error) {
        this.loader.hidden = true;
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
    const input = element("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(this.settings[key]),
      dataset: { setting: key, suffix },
      "aria-label": label
    });
    return element("label", { className: "field" }, [
      element("span", { text: label }),
      input,
      element("output", {
        className: "range-output",
        text: `${this.settings[key]}${suffix}`
      })
    ]);
  }

  async toggleFullscreen() {
    if (!document.fullscreenEnabled || typeof this.shell.requestFullscreen !== "function") {
      throw new Error("Full screen is not available in this browser.");
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    else await this.shell.requestFullscreen();
  }

  async refresh() {
    if (!this.rendition) return;
    const location = this.currentCfi;
    this.loader.hidden = false;
    try {
      await this.createRendition(location);
      this.onToast("Reader refreshed.", "success");
    } finally {
      this.loader.hidden = true;
    }
  }

  openSearch() {
    this.openPanel("search");
  }

  async destroy() {
    clearTimeout(this.persistTimer);
    this.abortController.abort();
    if (this.rendition) {
      this.rendition.destroy();
      this.rendition = undefined;
    }
    if (this.book) {
      this.book.destroy();
      this.book = undefined;
    }
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // The browser can exit fullscreen itself while the route changes.
      }
    }
  }
}
