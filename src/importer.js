import { uniqueStrings } from "./utils.js";

export const MAX_BOOK_BYTES = 100 * 1024 * 1024;
export const MAX_EPUB_BYTES = MAX_BOOK_BYTES;
const MAX_COVER_BYTES = 10 * 1024 * 1024;

function requireLibraries() {
  if (!globalThis.JSZip || !globalThis.ePub) {
    throw new Error("The EPUB reader libraries did not load. Use Refresh and try again.");
  }
}

function normalizedCreators(value) {
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((creator) => {
      if (typeof creator === "string") return creator;
      return creator?.name || creator?.value || "";
    }));
  }
  if (typeof value === "object" && value) {
    return uniqueStrings([value.name || value.value || ""]);
  }
  return uniqueStrings([value]);
}

function normalizedSubjects(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 20);
  return uniqueStrings(String(value || "").split(/[;,]/), 20);
}

function metadataText(value) {
  if (Array.isArray(value)) return metadataText(value[0]);
  if (typeof value === "object" && value) {
    return String(value.name || value.value || Object.values(value)[0] || "");
  }
  return String(value || "");
}

function validateCommonFile(file, format, extensions, mimeTypes) {
  if (!(file instanceof Blob)) throw new Error(`Choose a ${format} file to upload.`);
  if (!file.size) throw new Error("The selected file is empty.");
  if (file.size > MAX_BOOK_BYTES) {
    throw new Error(`This ${format} file is larger than the 100 MB safety limit.`);
  }
  const name = String(file.name || "").toLocaleLowerCase();
  const validExtension = extensions.some((extension) => name.endsWith(extension));
  if (!validExtension || !mimeTypes.includes(file.type)) {
    throw new Error(`Only supported ${extensions.join(" or ")} files are accepted.`);
  }
}

async function withTimeout(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function digestIdentifier(arrayBuffer) {
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", arrayBuffer);
    return Array.from(new Uint8Array(hash))
      .slice(0, 16)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  const bytes = new Uint8Array(arrayBuffer);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const byte of bytes) {
    left = Math.imul(left ^ byte, 0x01000193) >>> 0;
    right = Math.imul(right ^ byte, 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}${bytes.length.toString(16)}`;
}

export async function validateEpubFile(file) {
  requireLibraries();
  validateCommonFile(
    file,
    "EPUB",
    [".epub"],
    ["", "application/epub+zip", "application/octet-stream", "application/zip"]
  );

  const arrayBuffer = await file.arrayBuffer();
  const signature = new Uint8Array(arrayBuffer, 0, Math.min(4, arrayBuffer.byteLength));
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error("This file is not a valid EPUB ZIP container.");
  }

  let archive;
  try {
    archive = await globalThis.JSZip.loadAsync(arrayBuffer);
  } catch (error) {
    throw new Error("The EPUB archive is malformed or unsupported.", { cause: error });
  }

  const mimetypeEntry = archive.file("mimetype");
  const containerEntry = archive.file("META-INF/container.xml");
  if (!mimetypeEntry || !containerEntry) {
    throw new Error("The file is missing required EPUB container entries.");
  }

  const mimetype = (await mimetypeEntry.async("string")).trim();
  if (mimetype !== "application/epub+zip") {
    throw new Error("The file has an invalid EPUB mimetype.");
  }

  const containerXml = await containerEntry.async("string");
  if (containerXml.length > 1024 * 1024 || !containerXml.includes("rootfile")) {
    throw new Error("The EPUB package location is invalid.");
  }
  const containerDocument = new DOMParser().parseFromString(containerXml, "application/xml");
  if (containerDocument.querySelector("parsererror")
    || !containerDocument.getElementsByTagNameNS("*", "rootfile").length) {
    throw new Error("The EPUB container metadata is malformed.");
  }

  const encryptionEntry = archive.file("META-INF/encryption.xml");
  if (encryptionEntry) {
    const encryptionXml = await encryptionEntry.async("string");
    if (encryptionXml.length > 1024 * 1024) {
      throw new Error("The EPUB encryption metadata exceeds the safety limit.");
    }
    const encryptionDocument = new DOMParser().parseFromString(encryptionXml, "application/xml");
    if (encryptionDocument.querySelector("parsererror")) {
      throw new Error("The EPUB encryption metadata is malformed.");
    }
    const allowedFontAlgorithms = new Set([
      "http://www.idpf.org/2008/embedding",
      "http://ns.adobe.com/pdf/enc#RC"
    ]);
    const unsupportedEncryption = [...encryptionDocument.getElementsByTagNameNS(
      "*",
      "EncryptionMethod"
    )].some((node) => !allowedFontAlgorithms.has(node.getAttribute("Algorithm")));
    if (unsupportedEncryption) {
      throw new Error("Encrypted or DRM-protected EPUB files are not supported.");
    }
  }

  return { arrayBuffer, archive };
}

export async function importEpubFile(file) {
  const { arrayBuffer } = await validateEpubFile(file);
  const identifier = await digestIdentifier(arrayBuffer);
  const book = globalThis.ePub(arrayBuffer.slice(0), {
    replacements: "blobUrl"
  });

  try {
    const [metadata] = await Promise.all([
      book.loaded.metadata,
      book.ready,
      book.opened
    ]);
    let coverBlob;
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      try {
        const response = await fetch(coverUrl);
        const candidate = await response.blob();
        if (candidate.size <= MAX_COVER_BYTES) coverBlob = candidate;
      } catch (error) {
        console.warn("The EPUB cover could not be extracted.", error);
        coverBlob = undefined;
      }
    }

    const fallbackTitle = String(file.name || "Untitled").replace(/\.epub$/i, "");
    return {
      id: `local-${identifier}`,
      kind: "local",
      format: "epub",
      title: String(metadata.title || fallbackTitle).trim(),
      authors: normalizedCreators(metadata.creator),
      subjects: normalizedSubjects(metadata.subject),
      identifier: String(metadata.identifier || identifier),
      language: String(metadata.language || ""),
      publisher: String(metadata.publisher || ""),
      licence: String(metadata.rights || "User supplied; rights not verified"),
      source: "Own upload",
      fileBlob: new Blob([arrayBuffer], { type: "application/epub+zip" }),
      fileName: file.name || `${fallbackTitle}.epub`,
      fileSize: file.size,
      coverBlob,
      addedAt: new Date().toISOString(),
      status: "unread",
      favourite: false,
      progress: 0,
      lastLocation: ""
    };
  } catch (error) {
    throw new Error("The EPUB package could not be read. It may be malformed or encrypted.", {
      cause: error
    });
  } finally {
    book.destroy();
  }
}

export async function validateMobiFile(file) {
  validateCommonFile(
    file,
    "MOBI",
    [".mobi"],
    [
      "",
      "application/x-mobipocket-ebook",
      "application/vnd.amazon.ebook",
      "application/octet-stream"
    ]
  );
  if (file.size < 110) throw new Error("The MOBI file is too small to contain valid headers.");

  const pdbHeader = new Uint8Array(await file.slice(0, 86).arrayBuffer());
  const headerView = new DataView(pdbHeader.buffer);
  const signature = new TextDecoder("windows-1252").decode(pdbHeader.slice(60, 68));
  if (signature !== "BOOKMOBI") throw new Error("This file does not contain a MOBI book header.");

  const recordCount = headerView.getUint16(76, false);
  const firstRecordOffset = headerView.getUint32(78, false);
  const recordTableEnd = 78 + recordCount * 8;
  if (!recordCount || recordCount > 100000
    || firstRecordOffset < recordTableEnd
    || firstRecordOffset + 20 > file.size) {
    throw new Error("The MOBI record table is malformed.");
  }

  const palmDocHeader = new Uint8Array(
    await file.slice(firstRecordOffset, firstRecordOffset + 32).arrayBuffer()
  );
  const palmDocView = new DataView(palmDocHeader.buffer);
  const mobiMagic = new TextDecoder().decode(palmDocHeader.slice(16, 20));
  if (mobiMagic !== "MOBI") throw new Error("The selected file is missing its MOBI header.");
  if (palmDocView.getUint16(12, false) !== 0) {
    throw new Error("Encrypted or DRM-protected MOBI files are not supported.");
  }
  const compression = palmDocView.getUint16(0, false);
  if (![1, 2, 17480].includes(compression)) {
    throw new Error("The MOBI file uses an unsupported compression method.");
  }
  return true;
}

export async function validatePdfFile(file) {
  validateCommonFile(
    file,
    "PDF",
    [".pdf"],
    ["", "application/pdf", "application/octet-stream"]
  );
  const signature = new TextDecoder().decode(
    new Uint8Array(await file.slice(0, 5).arrayBuffer())
  );
  if (signature !== "%PDF-") throw new Error("This file does not contain a valid PDF header.");
  return true;
}

async function importFoliateFile(file, format) {
  if (format === "mobi") await validateMobiFile(file);
  else await validatePdfFile(file);

  const arrayBuffer = await file.arrayBuffer();
  const identifier = await digestIdentifier(arrayBuffer);
  const storedType = format === "mobi" ? "application/x-mobipocket-ebook" : "application/pdf";
  const storedFile = new File([arrayBuffer], file.name, { type: storedType });
  const { makeBook } = await import("../vendor/foliate-js/view.js?v=14");
  let book;

  try {
    book = await withTimeout(
      makeBook(storedFile),
      30000,
      `The ${format.toUpperCase()} file took too long to open.`
    );
    const metadata = book.metadata || {};
    let coverBlob;
    if (book.getCover) {
      const candidate = await withTimeout(
        Promise.resolve(book.getCover()),
        30000,
        `The ${format.toUpperCase()} cover took too long to render.`
      );
      if (candidate instanceof Blob && candidate.size <= MAX_COVER_BYTES) {
        coverBlob = candidate;
      }
    }

    const extensionPattern = new RegExp(`\\.${format}$`, "i");
    const fallbackTitle = String(file.name || "Untitled").replace(extensionPattern, "");
    return {
      id: `local-${format}-${identifier}`,
      kind: "local",
      format,
      title: metadataText(metadata.title) || fallbackTitle,
      authors: normalizedCreators(metadata.author || metadata.creator),
      subjects: normalizedSubjects(metadata.subject),
      identifier: metadataText(metadata.identifier) || identifier,
      language: metadataText(metadata.language),
      publisher: metadataText(metadata.publisher),
      licence: metadataText(metadata.rights) || "User supplied; rights not verified",
      source: "Own upload",
      fileBlob: new Blob([arrayBuffer], { type: storedType }),
      fileName: file.name || `${fallbackTitle}.${format}`,
      fileSize: file.size,
      coverBlob,
      addedAt: new Date().toISOString(),
      status: "unread",
      favourite: false,
      progress: 0,
      lastLocation: ""
    };
  } catch (error) {
    const message = String(error?.message || error);
    if (/password|encrypted|encryption/i.test(message)) {
      throw new Error(`Password-protected or encrypted ${format.toUpperCase()} files are not supported.`, {
        cause: error
      });
    }
    throw new Error(`The ${format.toUpperCase()} book could not be read: ${message}`, {
      cause: error
    });
  } finally {
    book?.destroy?.();
  }
}

export function importMobiFile(file) {
  return importFoliateFile(file, "mobi");
}

export function importPdfFile(file) {
  return importFoliateFile(file, "pdf");
}

export function importBookFile(file) {
  const name = String(file?.name || "").toLocaleLowerCase();
  if (name.endsWith(".epub")) return importEpubFile(file);
  if (name.endsWith(".mobi")) return importMobiFile(file);
  if (name.endsWith(".pdf")) return importPdfFile(file);
  throw new Error("Choose a DRM-free EPUB or MOBI file, or a readable PDF.");
}
