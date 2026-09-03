import { safeRemoteUrl, uniqueStrings } from "./utils.js";

const GUTENDEX_ORIGIN = "https://gutendex.com";

export function buildGutendexUrl({
  query = "",
  topic = "",
  language = "en",
  page = 1
} = {}) {
  const identifierMatch = query.trim().match(/^(?:id|gutenberg)\s*:\s*(\d+)$/i);
  if (identifierMatch) return `${GUTENDEX_ORIGIN}/books/${identifierMatch[1]}`;

  const url = new URL("/books/", GUTENDEX_ORIGIN);
  if (query.trim()) url.searchParams.set("search", query.trim());
  if (topic.trim()) url.searchParams.set("topic", topic.trim());
  if (language) url.searchParams.set("languages", language);
  if (Number(page) > 1) url.searchParams.set("page", String(page));
  if (!query.trim() && !topic.trim()) url.searchParams.set("sort", "popular");
  return url.href;
}

function epubDownloadUrl(formats) {
  const candidates = Object.entries(formats || {})
    .filter(([type, value]) => type.startsWith("application/epub+zip") && value)
    .sort(([left], [right]) => {
      const leftScore = left.includes("noimages") ? 1 : 0;
      const rightScore = right.includes("noimages") ? 1 : 0;
      return leftScore - rightScore;
    });
  return safeRemoteUrl(candidates[0]?.[1]);
}

export function normalizeGutendexBook(raw) {
  if (!raw || raw.copyright !== false) return null;
  const downloadUrl = epubDownloadUrl(raw.formats);
  const authors = (raw.authors || []).map((author) => author.name).filter(Boolean);
  const subjects = uniqueStrings([...(raw.subjects || []), ...(raw.bookshelves || [])], 8);

  return {
    id: `gutenberg-${raw.id}`,
    catalogueId: `gutenberg-${raw.id}`,
    sourceId: String(raw.id),
    title: String(raw.title || "Untitled"),
    authors,
    subjects,
    languages: uniqueStrings(raw.languages || []),
    source: "Project Gutenberg via Gutendex",
    sourceKey: "gutendex",
    licence: "Public domain in the United States; verify status in your jurisdiction.",
    copyright: false,
    coverUrl: safeRemoteUrl(raw.formats?.["image/jpeg"]),
    downloadUrl,
    downloadCount: Number(raw.download_count) || 0,
    identifier: `Project Gutenberg #${raw.id}`,
    kind: "catalogue"
  };
}

function validatedPageUrl(value) {
  if (!value) return "";
  const url = new URL(value);
  if (url.origin !== GUTENDEX_ORIGIN || !url.pathname.startsWith("/books")) {
    throw new Error("The catalogue returned an invalid pagination link.");
  }
  return url.href;
}

export class GutendexCatalogue {
  constructor(fetchImplementation = globalThis.fetch.bind(globalThis)) {
    this.fetch = fetchImplementation;
    this.name = "Project Gutenberg";
  }

  async search(criteria = {}, pageUrl = "") {
    const url = pageUrl ? validatedPageUrl(pageUrl) : buildGutendexUrl(criteria);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await this.fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("The public catalogue timed out. Use Refresh to try again.", {
          cause: error
        });
      }
      throw new Error(
        navigator.onLine
          ? "The public catalogue could not be reached. Try Refresh in a moment."
          : "You are offline. Open a downloaded title from Own Books.",
        { cause: error }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 404 && /\/books\/\d+/.test(new URL(url).pathname)) {
        return { books: [], count: 0, next: "", previous: "", source: this.name };
      }
      throw new Error(`The public catalogue returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const isSingleBook = !Array.isArray(payload.results);
    const records = isSingleBook ? [payload] : payload.results;
    const books = records.map(normalizeGutendexBook).filter(Boolean);

    return {
      books,
      count: isSingleBook ? books.length : Number(payload.count) || books.length,
      next: isSingleBook ? "" : validatedPageUrl(payload.next),
      previous: isSingleBook ? "" : validatedPageUrl(payload.previous),
      source: this.name
    };
  }
}
