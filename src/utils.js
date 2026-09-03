const ICON_PATHS = {
  back: '<path d="m15 18-6-6 6-6"/><path d="M9 12h11"/>',
  bookmark: '<path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z"/>',
  bookOpen: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/>',
  check: '<path d="m5 12.5 4.2 4.2L19.5 6.5"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  columns: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  heart: '<path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".5"/><circle cx="3.5" cy="12" r=".5"/><circle cx="3.5" cy="18" r=".5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  note: '<path d="M5 3h14v14l-4 4H5V3Z"/><path d="M15 21v-4h4M8 8h8M8 12h6"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M18.6 15.5A8 8 0 1 1 19.8 9"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  upload: '<path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 14v5h14v-5"/>'
};

export function icon(name, label = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.bookOpen;
  return svg;
}

export function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") {
      for (const [property, propertyValue] of Object.entries(value)) {
        if (property.startsWith("--")) node.style.setProperty(property, propertyValue);
        else node.style[property] = propertyValue;
      }
    }
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  const normalized = Array.isArray(children) ? children : [children];
  for (const child of normalized) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function debounce(callback, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export function formatAuthors(authors) {
  const list = Array.isArray(authors) ? authors : authors ? [authors] : [];
  return list.filter(Boolean).join(", ") || "Unknown author";
}

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function formatPercent(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

export function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "An unexpected error occurred.");
}

export function initials(title) {
  return String(title || "Book")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function isTextEntry(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable
    || target?.matches?.("input, textarea, select, [contenteditable='true']");
}

export function safeRemoteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function uniqueStrings(values, limit = Infinity) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = String(value || "").trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

export function uuid() {
  return globalThis.crypto?.randomUUID?.()
    || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
