import { GutendexCatalogue } from "./catalogue.js?v=10";
import { getExternalSource, listExternalSources } from "./external-sources.js?v=10";
import { importBookFile } from "./importer.js?v=14";
import { ReaderController } from "./reader.js?v=10";
import {
  clearDatabase,
  deleteBook,
  getBook,
  listBooks,
  patchBook,
  putBook
} from "./storage.js";
import {
  element,
  formatAuthors,
  formatPercent,
  getErrorMessage,
  icon,
  initials,
  safeRemoteUrl
} from "./utils.js";

const app = document.querySelector("#app");
const searchButton = document.querySelector("#searchButton");
const refreshButton = document.querySelector("#refreshButton");
const uploadButton = document.querySelector("#uploadButton");
const fileInput = document.querySelector("#bookFileInput");
const clearDataButton = document.querySelector("#clearDataButton");
const offlineBanner = document.querySelector("#offlineBanner");
const toastRegion = document.querySelector("#toastRegion");
const srAnnouncements = document.querySelector("#srAnnouncements");
const catalogue = new GutendexCatalogue();

const state = {
  route: { name: "library" },
  catalogueResult: null,
  catalogueRequestId: 0,
  catalogueCriteria: {
    query: "",
    topic: "",
    language: "en",
    source: "gutendex"
  },
  cataloguePageUrl: "",
  localBooks: [],
  view: localStorage.getItem("paper-library-view") === "list" ? "list" : "grid",
  reader: null,
  coverUrls: new Set(),
  renderToken: 0
};

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("reader/")) {
    return { name: "reader", id: decodeURIComponent(hash.slice("reader/".length)) };
  }
  if (hash === "own-books") return { name: "own-books" };
  return { name: "library" };
}

function updateNavigation() {
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    const current = link.dataset.routeLink === state.route.name;
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function updateNetworkStatus() {
  offlineBanner.hidden = navigator.onLine;
}

function announce(message) {
  srAnnouncements.textContent = "";
  requestAnimationFrame(() => {
    srAnnouncements.textContent = message;
  });
}

function toast(message, type = "info") {
  const item = element("div", {
    className: "toast",
    role: type === "error" ? "alert" : "status",
    dataset: { type },
    text: message
  });
  toastRegion.append(item);
  setTimeout(() => item.remove(), 4500);
}

function setGlobalBusy(busy) {
  refreshButton.disabled = busy;
  uploadButton.disabled = busy;
  app.setAttribute("aria-busy", String(busy));
}

function releaseCoverUrls() {
  state.coverUrls.forEach((url) => URL.revokeObjectURL(url));
  state.coverUrls.clear();
}

function createLocalCoverUrl(blob) {
  if (!(blob instanceof Blob)) return "";
  const url = URL.createObjectURL(blob);
  state.coverUrls.add(url);
  return url;
}

function generatedCover(title) {
  const palette = ["#51473e", "#625041", "#46534f", "#62494b", "#4b5065", "#6b5739"];
  const hash = [...String(title || "")].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return element(
    "div",
    {
      className: "generated-cover",
      style: { "--cover-color": palette[hash % palette.length] }
    },
    [element("span", { text: initials(title) })]
  );
}

function createBookCover(book) {
  const wrapper = element("div", { className: "book-cover-wrap" });
  const localUrl = createLocalCoverUrl(book.coverBlob);
  const remoteUrl = safeRemoteUrl(book.coverUrl);
  const coverUrl = localUrl || remoteUrl;

  if (coverUrl) {
    const image = element("img", {
      className: "book-cover",
      src: coverUrl,
      alt: `Cover of ${book.title}`,
      loading: "lazy",
      referrerpolicy: "no-referrer"
    });
    image.addEventListener("error", () => image.replaceWith(generatedCover(book.title)), {
      once: true
    });
    wrapper.append(image);
  } else {
    wrapper.append(generatedCover(book.title));
  }

  wrapper.append(element("span", {
    className: "cover-badge",
    text: book.kind === "local" ? `Your ${(book.format || "epub").toUpperCase()}`
      : book.kind === "downloaded" ? "Downloaded" : "Public domain"
  }));
  return wrapper;
}

function localCopyFor(book) {
  return state.localBooks.find(
    (candidate) => candidate.id === book.id || candidate.catalogueId === book.catalogueId
  );
}

function createBookCard(book, mode = "local") {
  const card = element("article", { className: "book-card" });
  const cover = createBookCover(book);

  if (mode === "local") {
    const favourite = element(
      "button",
      {
        className: "favourite-button",
        type: "button",
        "aria-label": book.favourite ? `Remove ${book.title} from favourites` : `Add ${book.title} to favourites`,
        "aria-pressed": String(Boolean(book.favourite)),
        title: book.favourite ? "Remove from favourites" : "Add to favourites"
      },
      [icon("heart")]
    );
    favourite.addEventListener("click", async () => {
      try {
        const updated = await patchBook(book.id, { favourite: !book.favourite });
        Object.assign(book, updated);
        favourite.setAttribute("aria-pressed", String(updated.favourite));
        favourite.setAttribute(
          "aria-label",
          updated.favourite ? `Remove ${book.title} from favourites` : `Add ${book.title} to favourites`
        );
        applyOwnBookFilters();
      } catch (error) {
        toast(getErrorMessage(error), "error");
      }
    });
    cover.append(favourite);
  }

  const title = element("h2", { className: "book-title", text: book.title || "Untitled" });
  const author = element("p", { className: "book-author", text: formatAuthors(book.authors) });
  const meta = element("div", { className: "book-meta" });
  meta.append(element("span", { className: "tag", text: book.source || "Unknown source" }));
  if (book.subjects?.[0]) {
    meta.append(element("span", { className: "tag", text: book.subjects[0] }));
  }
  if (book.licence) {
    meta.append(element("span", {
      className: "tag",
      text: book.licence,
      title: book.licence
    }));
  }

  const body = element("div", { className: "book-card-body" }, [title, author, meta]);
  const actions = element("div", { className: "book-card-actions" });

  if (mode === "catalogue") {
    const existing = localCopyFor(book);
    if (existing) {
      const readButton = element("button", {
        className: "button button-primary",
        type: "button",
        text: "Read"
      });
      readButton.addEventListener("click", () => {
        location.hash = `#/reader/${encodeURIComponent(existing.id)}`;
      });
      actions.append(
        readButton,
        element("button", {
          className: "button button-secondary",
          type: "button",
          text: "In Own Books",
          disabled: true
        })
      );
    } else {
      const downloadLink = element("a", {
        className: "button button-primary",
        href: book.downloadUrl || undefined,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "Get EPUB",
        "aria-disabled": String(!book.downloadUrl),
        title: book.downloadUrl
          ? "Download from Project Gutenberg, then upload it to Own Books"
          : "No EPUB download is available"
      });
      if (!book.downloadUrl) {
        downloadLink.removeAttribute("href");
        downloadLink.setAttribute("tabindex", "-1");
      }
      const addButton = element("button", {
        className: "button button-secondary",
        type: "button",
        text: "Upload",
        title: "Upload a downloaded EPUB to Own Books"
      });
      addButton.addEventListener("click", () => fileInput.click());
      actions.append(downloadLink, addButton);
    }

    if (book.downloadCount) {
      body.append(element("span", {
        className: "progress-label",
        text: `${book.downloadCount.toLocaleString()} catalogue downloads`
      }));
    }
  } else {
    const progressTrack = element(
      "div",
      {
        className: "progress-track",
        role: "progressbar",
        "aria-label": `Reading progress for ${book.title}`,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round((book.progress || 0) * 100))
      },
      [element("span", { style: { "--progress": formatPercent(book.progress || 0) } })]
    );
    const progressLabel = element("div", { className: "progress-label" }, [
      element("span", { text: statusLabel(book.status) }),
      element("span", { text: formatPercent(book.progress || 0) })
    ]);
    body.append(progressTrack, progressLabel);

    const readButton = element("button", {
      className: "button button-primary",
      type: "button",
      text: book.progress > 0 ? "Continue" : "Read"
    });
    readButton.addEventListener("click", () => {
      location.hash = `#/reader/${encodeURIComponent(book.id)}`;
    });

    const statusSelect = element("select", {
      className: "select-input",
      "aria-label": `Reading status for ${book.title}`,
      title: "Reading status"
    });
    [
      ["unread", "Unread"],
      ["reading", "Reading"],
      ["finished", "Finished"]
    ].forEach(([value, text]) => {
      const option = element("option", { value, text });
      option.selected = (book.status || "unread") === value;
      statusSelect.append(option);
    });
    statusSelect.addEventListener("change", async () => {
      try {
        const changes = { status: statusSelect.value };
        if (statusSelect.value === "finished") changes.progress = 1;
        const updated = await patchBook(book.id, changes);
        Object.assign(book, updated);
        applyOwnBookFilters();
      } catch (error) {
        toast(getErrorMessage(error), "error");
      }
    });
    const removeButton = element("button", {
      className: "button button-quiet",
      type: "button",
      "aria-label": `Remove ${book.title} from Own Books`,
      title: "Remove from Own Books"
    }, [icon("trash")]);
    removeButton.addEventListener("click", async () => {
      if (!globalThis.confirm(`Remove "${book.title}" and its notes from this browser?`)) return;
      try {
        await deleteBook(book.id);
        state.localBooks = state.localBooks.filter((candidate) => candidate.id !== book.id);
        applyOwnBookFilters();
        toast(`${book.title} was removed from Own Books.`, "success");
      } catch (error) {
        toast(getErrorMessage(error), "error");
      }
    });
    actions.append(readButton, statusSelect, removeButton);
  }

  body.append(actions);
  card.append(cover, body);
  return card;
}

function statusLabel(status) {
  return {
    unread: "Not started",
    reading: "Reading",
    finished: "Finished"
  }[status] || "Not started";
}

function loadingGrid(container) {
  container.replaceChildren();
  container.className = "book-grid";
  for (let index = 0; index < 8; index += 1) {
    container.append(element("div", { className: "skeleton-card", "aria-hidden": "true" }));
  }
}

function statePanel(type, title, message, action) {
  const content = element("div", { className: "state-content" }, [
    icon(type === "error" ? "refresh" : "bookOpen"),
    element("h2", { text: title }),
    element("p", { text: message })
  ]);
  if (action) content.append(action);
  return element("section", {
    className: type === "error" ? "error-state" : "empty-state"
  }, [content]);
}

async function renderRoute() {
  const token = ++state.renderToken;
  const nextRoute = parseRoute();
  if (nextRoute.name !== "library") state.catalogueRequestId += 1;
  if (state.reader) {
    await state.reader.destroy();
    state.reader = null;
  }
  releaseCoverUrls();
  state.route = nextRoute;
  updateNavigation();
  document.body.classList.toggle("reader-open", nextRoute.name === "reader");
  document.title = nextRoute.name === "reader"
    ? "Reader - Paper Library"
    : nextRoute.name === "own-books"
      ? "Own Books - Paper Library"
      : "Discover - Paper Library";

  if (nextRoute.name === "reader") {
    await renderReader(nextRoute.id, token);
  } else if (nextRoute.name === "own-books") {
    await renderOwnBooks(token);
  } else {
    await renderDiscover(token);
  }
}

async function renderDiscover(token) {
  app.replaceChildren();
  const shell = element("div", { className: "view-shell" });
  shell.innerHTML = `
    <section class="hero" aria-labelledby="discoverTitle">
      <div>
        <p class="eyebrow">Open shelves, endless reading</p>
        <h1 id="discoverTitle">Find your next great book.</h1>
        <p class="hero-copy">
          Search verified public-domain titles, save EPUBs to your private shelf,
          and settle into a calm paper-style reader.
        </p>
      </div>
      <div class="hero-stats" aria-label="Library summary">
        <div class="stat"><strong id="catalogueStat">-</strong><span>matching titles</span></div>
        <div class="stat"><strong id="ownStat">-</strong><span>in Own Books</span></div>
        <div class="stat"><strong id="readingStat">-</strong><span>currently reading</span></div>
      </div>
    </section>
    <section class="search-panel" aria-labelledby="catalogueSearchTitle">
      <h2 id="catalogueSearchTitle" class="visually-hidden">Search public-domain catalogue</h2>
      <form id="catalogueSearchForm" role="search">
        <div class="search-row">
          <div class="input-wrap">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="10.8" cy="10.8" r="6.8"></circle>
              <path d="m16 16 4.5 4.5"></path>
            </svg>
            <input
              id="catalogueSearchInput"
              class="text-input"
              data-primary-search
              type="search"
              autocomplete="off"
              placeholder="Title, author, or id: 1342"
              aria-label="Search by title, author, or Project Gutenberg identifier"
            >
          </div>
          <button class="button button-primary" type="submit">Search catalogue</button>
        </div>
        <div class="filter-row">
          <label class="field field-grow">
            <span>Subject</span>
            <input id="subjectFilter" class="text-input" type="text" placeholder="e.g. history">
          </label>
          <label class="field">
            <span>Language</span>
            <select id="languageFilter" class="select-input">
              <option value="">All languages</option>
              <option value="en" selected>English</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="es">Spanish</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
            </select>
          </label>
          <label class="field">
            <span>Source</span>
            <select id="catalogueSourceFilter" class="select-input">
              <option value="gutendex">Project Gutenberg</option>
            </select>
          </label>
          <label class="field">
            <span>Licence</span>
            <select class="select-input" disabled>
              <option>Check rights at source</option>
            </select>
          </label>
        </div>
        <p class="result-count">
          Downloads open at the selected source. Confirm its rights notice, then use
          Upload book to keep a private offline copy in Own Books.
        </p>
      </form>
    </section>
    <div class="toolbar">
      <span id="catalogueResultCount" class="result-count" role="status">Loading catalogue...</span>
      <div class="toolbar-group">
        <div class="segmented" aria-label="Book display">
          <button type="button" data-view="grid">Grid</button>
          <button type="button" data-view="list">List</button>
        </div>
      </div>
    </div>
    <section id="catalogueResults" class="book-grid" aria-label="Catalogue results"></section>
    <nav id="cataloguePagination" class="pagination" aria-label="Catalogue pages"></nav>
  `;
  app.append(shell);
  if (token !== state.renderToken) return;

  const form = document.querySelector("#catalogueSearchForm");
  const queryInput = document.querySelector("#catalogueSearchInput");
  const subjectInput = document.querySelector("#subjectFilter");
  const languageInput = document.querySelector("#languageFilter");
  const sourceInput = document.querySelector("#catalogueSourceFilter");
  listExternalSources().forEach((source) => {
    sourceInput.append(element("option", {
      value: source.key,
      text: `${source.shortName || source.name} (external)`
    }));
  });
  queryInput.value = state.catalogueCriteria.query;
  subjectInput.value = state.catalogueCriteria.topic;
  languageInput.value = state.catalogueCriteria.language;
  sourceInput.value = state.catalogueCriteria.source;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.catalogueCriteria = {
      query: queryInput.value.trim(),
      topic: subjectInput.value.trim(),
      language: languageInput.value,
      source: sourceInput.value
    };
    state.cataloguePageUrl = "";
    await searchCatalogue();
  });
  sourceInput.addEventListener("change", () => form.requestSubmit());

  bindViewControls();
  loadingGrid(document.querySelector("#catalogueResults"));
  try {
    state.localBooks = await listBooks();
    updateDiscoverStats();
  } catch (error) {
    toast(`Own Books could not be loaded: ${getErrorMessage(error)}`, "error");
  }
  await searchCatalogue(state.cataloguePageUrl);
}

function bindViewControls() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      localStorage.setItem("paper-library-view", state.view);
      document.querySelectorAll("[data-view]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate.dataset.view === state.view));
      });
      document.querySelectorAll(".book-grid").forEach((grid) => {
        grid.dataset.view = state.view;
      });
    });
  });
  document.querySelectorAll(".book-grid").forEach((grid) => {
    grid.dataset.view = state.view;
  });
}

function updateDiscoverStats() {
  const ownStat = document.querySelector("#ownStat");
  const readingStat = document.querySelector("#readingStat");
  if (ownStat) ownStat.textContent = state.localBooks.length.toLocaleString();
  if (readingStat) {
    readingStat.textContent = state.localBooks
      .filter((book) => book.status === "reading")
      .length
      .toLocaleString();
  }
}

async function searchCatalogue(pageUrl = "") {
  const requestId = ++state.catalogueRequestId;
  const results = document.querySelector("#catalogueResults");
  const count = document.querySelector("#catalogueResultCount");
  const pagination = document.querySelector("#cataloguePagination");
  if (!results || !count || !pagination) return;

  if (state.catalogueCriteria.source !== "gutendex") {
    state.catalogueResult = null;
    state.cataloguePageUrl = "";
    renderExternalCatalogueSource(state.catalogueCriteria.source);
    setGlobalBusy(false);
    return;
  }

  setGlobalBusy(true);
  count.textContent = "Searching the public-domain catalogue...";
  loadingGrid(results);
  pagination.replaceChildren();
  try {
    const result = await catalogue.search(state.catalogueCriteria, pageUrl);
    if (requestId !== state.catalogueRequestId || state.route.name !== "library") return;
    state.catalogueResult = result;
    state.cataloguePageUrl = pageUrl;
    renderCatalogueResult(result);
  } catch (error) {
    if (requestId !== state.catalogueRequestId || state.route.name !== "library") return;
    const retry = element("button", {
      className: "button button-secondary",
      type: "button",
      text: "Try again",
      onclick: () => searchCatalogue(state.cataloguePageUrl)
    });
    results.className = "";
    results.replaceChildren(statePanel(
      "error",
      "Catalogue unavailable",
      getErrorMessage(error),
      retry
    ));
    count.textContent = "Catalogue unavailable";
  } finally {
    if (requestId === state.catalogueRequestId) setGlobalBusy(false);
  }
}

function renderExternalCatalogueSource(sourceKey) {
  const results = document.querySelector("#catalogueResults");
  const count = document.querySelector("#catalogueResultCount");
  const pagination = document.querySelector("#cataloguePagination");
  const stat = document.querySelector("#catalogueStat");
  if (!results || !count || !pagination || !stat) return;

  const source = getExternalSource(sourceKey);
  if (!source) {
    throw new Error("The selected external source is not configured.");
  }
  const query = state.catalogueCriteria.query;
  const message = query
    ? `Open ${source.name} and use its site search for "${query}". ${source.rightsNotice}`
    : `Open ${source.name} and use its site search. ${source.rightsNotice}`;
  const openSource = element("a", {
    className: "button button-primary",
    href: source.url,
    target: "_blank",
    rel: "noopener noreferrer",
    text: `Open ${source.name}`
  });

  results.className = "";
  results.replaceChildren(statePanel(
    "empty",
    `Search ${source.name} on its website`,
    `${source.description} ${message} This integration does not scrape or copy its catalogue, and availability depends on your network.`,
    openSource
  ));
  pagination.replaceChildren();
  count.textContent = "External catalogue - opens in a new tab";
  stat.textContent = "External";
}

function renderCatalogueResult(result) {
  const results = document.querySelector("#catalogueResults");
  const count = document.querySelector("#catalogueResultCount");
  const pagination = document.querySelector("#cataloguePagination");
  if (!results || !count || !pagination) return;
  results.className = "book-grid";
  results.dataset.view = state.view;
  results.replaceChildren();

  document.querySelector("#catalogueStat").textContent = result.count.toLocaleString();
  count.textContent = `${result.count.toLocaleString()} public-domain title${result.count === 1 ? "" : "s"} found`;

  if (!result.books.length) {
    results.className = "";
    results.append(statePanel(
      "empty",
      "No public-domain EPUBs found",
      "Try a different title, author, subject, or a Project Gutenberg identifier such as id: 1342."
    ));
  } else {
    result.books.forEach((book) => results.append(createBookCard(book, "catalogue")));
  }

  pagination.replaceChildren();
  if (result.previous) {
    pagination.append(element("button", {
      className: "button button-secondary",
      type: "button",
      text: "Previous",
      onclick: () => searchCatalogue(result.previous)
    }));
  }
  if (result.next) {
    pagination.append(element("button", {
      className: "button button-secondary",
      type: "button",
      text: "Next",
      onclick: () => searchCatalogue(result.next)
    }));
  }
}

async function renderOwnBooks(token) {
  app.replaceChildren();
  const shell = element("div", { className: "view-shell" });
  shell.innerHTML = `
    <header class="page-heading">
      <div>
        <p class="eyebrow">Private local collection</p>
        <h1>Own Books</h1>
        <p>Upload DRM-free EPUB or MOBI books, or readable PDF documents.</p>
      </div>
      <button id="ownUploadButton" class="button button-primary" type="button">
        Upload your books
      </button>
    </header>
    <section id="dropZone" class="drop-zone" tabindex="0" aria-label="Upload ebook drop zone">
      <div>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 16V4"></path>
          <path d="m7.5 8.5 4.5-4.5 4.5 4.5"></path>
          <path d="M5 14v5h14v-5"></path>
        </svg>
        <strong>Drop EPUB, MOBI, or PDF files here</strong>
        <span>DRM-free files stay in this browser and open in the paper reader</span>
      </div>
    </section>
    <section class="search-panel" aria-labelledby="ownSearchTitle">
      <h2 id="ownSearchTitle" class="visually-hidden">Search Own Books</h2>
      <div class="search-row">
        <div class="input-wrap">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.8" cy="10.8" r="6.8"></circle>
            <path d="m16 16 4.5 4.5"></path>
          </svg>
          <input
            id="ownSearchInput"
            class="text-input"
            data-primary-search
            type="search"
            autocomplete="off"
            placeholder="Search title, author, subject, or identifier"
          >
        </div>
        <button id="ownSearchButton" class="button button-primary" type="button">Search</button>
      </div>
      <div class="filter-row">
        <label class="field">
          <span>Reading status</span>
          <select id="ownStatusFilter" class="select-input">
            <option value="">All statuses</option>
            <option value="unread">Not started</option>
            <option value="reading">Reading</option>
            <option value="finished">Finished</option>
          </select>
        </label>
        <label class="field">
          <span>Source</span>
          <select id="ownSourceFilter" class="select-input">
            <option value="">All sources</option>
            <option value="local">Your uploads</option>
            <option value="downloaded">Public catalogue</option>
          </select>
        </label>
        <label class="field">
          <span>Favourites</span>
          <select id="ownFavouriteFilter" class="select-input">
            <option value="">All books</option>
            <option value="true">Favourites only</option>
          </select>
        </label>
      </div>
    </section>
    <div class="toolbar">
      <span id="ownResultCount" class="result-count" role="status">Loading Own Books...</span>
      <div class="segmented" aria-label="Book display">
        <button type="button" data-view="grid">Grid</button>
        <button type="button" data-view="list">List</button>
      </div>
    </div>
    <section id="ownBookResults" class="book-grid" aria-label="Own Books results"></section>
  `;
  app.append(shell);
  if (token !== state.renderToken) return;

  document.querySelector("#ownUploadButton").addEventListener("click", () => fileInput.click());
  bindDropZone(document.querySelector("#dropZone"));
  bindViewControls();
  const applyFilters = () => applyOwnBookFilters();
  document.querySelector("#ownSearchButton").addEventListener("click", applyFilters);
  document.querySelector("#ownSearchInput").addEventListener("search", applyFilters);
  document.querySelector("#ownSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyFilters();
  });
  ["#ownStatusFilter", "#ownSourceFilter", "#ownFavouriteFilter"].forEach((selector) => {
    document.querySelector(selector).addEventListener("change", applyFilters);
  });
  loadingGrid(document.querySelector("#ownBookResults"));
  await loadOwnBooks();
}

function bindDropZone(dropZone) {
  const setActive = (active) => {
    dropZone.dataset.active = String(active);
  };
  ["dragenter", "dragover"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setActive(true);
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      setActive(false);
    });
  });
  dropZone.addEventListener("drop", (event) => {
    importFiles(event.dataTransfer?.files || []);
  });
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });
}

async function loadOwnBooks(showConfirmation = false) {
  const results = document.querySelector("#ownBookResults");
  if (!results) return;
  setGlobalBusy(true);
  try {
    state.localBooks = await listBooks();
    applyOwnBookFilters();
    if (showConfirmation) toast("Own Books refreshed.", "success");
  } catch (error) {
    results.className = "";
    results.replaceChildren(statePanel(
      "error",
      "Own Books could not be opened",
      getErrorMessage(error)
    ));
  } finally {
    setGlobalBusy(false);
  }
}

function applyOwnBookFilters() {
  const results = document.querySelector("#ownBookResults");
  const count = document.querySelector("#ownResultCount");
  if (!results || !count) return;

  const query = document.querySelector("#ownSearchInput")?.value.trim().toLocaleLowerCase() || "";
  const status = document.querySelector("#ownStatusFilter")?.value || "";
  const source = document.querySelector("#ownSourceFilter")?.value || "";
  const favourite = document.querySelector("#ownFavouriteFilter")?.value || "";
  const filtered = state.localBooks.filter((book) => {
    const searchText = [
      book.title,
      ...(book.authors || []),
      ...(book.subjects || []),
      book.identifier
    ].join(" ").toLocaleLowerCase();
    return (!query || searchText.includes(query))
      && (!status || book.status === status)
      && (!source || book.kind === source)
      && (!favourite || String(Boolean(book.favourite)) === favourite);
  });

  results.className = "book-grid";
  results.dataset.view = state.view;
  results.replaceChildren();
  count.textContent = `${filtered.length} of ${state.localBooks.length} book${state.localBooks.length === 1 ? "" : "s"}`;
  if (!filtered.length) {
    results.className = "";
    const hasFilters = Boolean(query || status || source || favourite);
    const action = hasFilters
      ? element("button", {
        className: "button button-secondary",
        type: "button",
        text: "Clear filters",
        onclick: () => {
          document.querySelector("#ownSearchInput").value = "";
          document.querySelector("#ownStatusFilter").value = "";
          document.querySelector("#ownSourceFilter").value = "";
          document.querySelector("#ownFavouriteFilter").value = "";
          applyOwnBookFilters();
        }
      })
      : element("button", {
        className: "button button-primary",
        type: "button",
        text: "Upload your first book",
        onclick: () => fileInput.click()
      });
    results.append(statePanel(
      "empty",
      hasFilters ? "No books match these filters" : "Your shelf is ready",
      hasFilters
        ? "Change or clear the search filters to see more books."
        : "Upload a DRM-free EPUB or MOBI, a readable PDF, or save a title from Discover.",
      action
    ));
  } else {
    filtered.forEach((book) => results.append(createBookCard(book, "local")));
  }
}

async function importFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  setGlobalBusy(true);
  let imported = 0;
  const failures = [];
  for (const file of files) {
    try {
      const candidate = await importBookFile(file);
      const existing = await getBook(candidate.id);
      const record = existing
        ? {
          ...candidate,
          addedAt: existing.addedAt,
          favourite: existing.favourite,
          lastLocation: existing.lastLocation,
          lastOpenedAt: existing.lastOpenedAt,
          progress: existing.progress,
          status: existing.status
        }
        : candidate;
      await putBook(record);
      imported += 1;
    } catch (error) {
      failures.push(`${file.name || "File"}: ${getErrorMessage(error)}`);
    }
  }
  setGlobalBusy(false);
  fileInput.value = "";

  if (imported) {
    await requestPersistentStorage();
    toast(`${imported} book${imported === 1 ? "" : "s"} added to Own Books.`, "success");
    if (state.route.name !== "own-books") location.hash = "#/own-books";
    else await loadOwnBooks();
  }
  failures.forEach((message) => toast(message, "error"));
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    const alreadyPersistent = await navigator.storage.persisted?.();
    if (!alreadyPersistent) await navigator.storage.persist();
  } catch (error) {
    console.warn("Persistent browser storage could not be requested.", error);
  }
}

async function renderReader(id, token) {
  app.replaceChildren(element("div", { className: "reader-loader", role: "status" }, [
    element("div", {}, [
      element("div", { className: "spinner", "aria-hidden": "true" }),
      element("span", { text: "Opening reader..." })
    ])
  ]));
  try {
    const book = await getBook(id);
    if (!book) throw new Error("This book is not in Own Books.");
    if (token !== state.renderToken) return;
    const format = book.format
      || (book.fileName?.toLocaleLowerCase().endsWith(".mobi") ? "mobi"
        : book.fileName?.toLocaleLowerCase().endsWith(".pdf") ? "pdf" : "epub");
    const Controller = format === "epub"
      ? ReaderController
      : (await import("./foliate-reader.js?v=14")).FoliateReaderController;
    const reader = new Controller(app, { ...book, format }, {
      onToast: toast,
      onBookUpdated: (updated) => {
        const index = state.localBooks.findIndex((item) => item.id === updated.id);
        if (index >= 0) state.localBooks[index] = updated;
      }
    });
    state.reader = reader;
    await reader.init();
  } catch (error) {
    if (token !== state.renderToken) return;
    state.reader = null;
    const back = element("a", {
      className: "button button-primary",
      href: "#/own-books",
      text: "Back to Own Books"
    });
    app.replaceChildren(element("div", { className: "reader-error" }, [
      statePanel("error", "Book could not be opened", getErrorMessage(error), back)
    ]));
  }
}

async function refreshCurrentView() {
  if (state.route.name === "reader" && state.reader) {
    await state.reader.refresh();
  } else if (state.route.name === "own-books") {
    await loadOwnBooks(true);
  } else {
    await searchCatalogue(state.cataloguePageUrl);
  }
}

function focusCurrentSearch() {
  if (state.route.name === "reader" && state.reader) {
    state.reader.openSearch();
    return;
  }
  const input = document.querySelector("[data-primary-search]");
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function clearLocalData() {
  const confirmed = globalThis.confirm(
    "Remove all uploaded/downloaded books, progress, bookmarks, notes, and preferences from this browser?"
  );
  if (!confirmed) return;
  setGlobalBusy(true);
  try {
    if (state.reader) {
      await state.reader.destroy();
      state.reader = null;
    }
    await clearDatabase();
    if ("caches" in globalThis) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith("paper-library-"))
          .map((name) => caches.delete(name))
      );
    }
    localStorage.removeItem("paper-library-view");
    state.localBooks = [];
    toast("Local books and reading data were cleared.", "success");
    location.hash = "#/own-books";
    await renderRoute();
  } catch (error) {
    toast(getErrorMessage(error), "error");
  } finally {
    setGlobalBusy(false);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("./service-worker.js").catch((error) => {
    console.warn("Offline caching could not be enabled.", error);
  });
}

searchButton.addEventListener("click", focusCurrentSearch);
refreshButton.addEventListener("click", () => {
  refreshCurrentView().catch((error) => toast(getErrorMessage(error), "error"));
});
uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => importFiles(fileInput.files));
clearDataButton.addEventListener("click", clearLocalData);
globalThis.addEventListener("hashchange", renderRoute);
globalThis.addEventListener("online", () => {
  updateNetworkStatus();
  toast("You are back online.", "success");
});
globalThis.addEventListener("offline", () => {
  updateNetworkStatus();
  announce("You are offline. Own Books remain available.");
});
globalThis.addEventListener("beforeunload", releaseCoverUrls);

updateNetworkStatus();
registerServiceWorker();
if (!location.hash) {
  location.replace("#/library");
} else {
  renderRoute();
}
