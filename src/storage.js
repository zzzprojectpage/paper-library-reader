import { uuid } from "./utils.js";

const DATABASE_NAME = "paper-library-reader";
const DATABASE_VERSION = 1;
const BOOK_STORE = "books";
const ANNOTATION_STORE = "annotations";
const SETTING_STORE = "settings";

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(BOOK_STORE)) {
        const books = database.createObjectStore(BOOK_STORE, { keyPath: "id" });
        books.createIndex("kind", "kind", { unique: false });
        books.createIndex("lastOpenedAt", "lastOpenedAt", { unique: false });
        books.createIndex("status", "status", { unique: false });
        books.createIndex("favourite", "favourite", { unique: false });
      }

      if (!database.objectStoreNames.contains(ANNOTATION_STORE)) {
        const annotations = database.createObjectStore(ANNOTATION_STORE, { keyPath: "id" });
        annotations.createIndex("bookId", "bookId", { unique: false });
        annotations.createIndex("type", "type", { unique: false });
      }

      if (!database.objectStoreNames.contains(SETTING_STORE)) {
        database.createObjectStore(SETTING_STORE, { keyPath: "key" });
      }
    });

    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    }, { once: true });

    request.addEventListener("error", () => {
      databasePromise = undefined;
      reject(request.error);
    }, { once: true });

    request.addEventListener("blocked", () => {
      databasePromise = undefined;
      reject(new Error("Local storage is blocked by another open Paper Library tab."));
    }, { once: true });
  });

  return databasePromise;
}

export async function putBook(book) {
  const database = await openDatabase();
  const transaction = database.transaction(BOOK_STORE, "readwrite");
  const now = new Date().toISOString();
  const record = {
    addedAt: now,
    favourite: false,
    progress: 0,
    status: "unread",
    ...book,
    updatedAt: now
  };
  transaction.objectStore(BOOK_STORE).put(record);
  await transactionComplete(transaction);
  return record;
}

export async function patchBook(id, changes) {
  const current = await getBook(id);
  if (!current) throw new Error("The selected book is no longer in Own Books.");
  return putBook({ ...current, ...changes, id });
}

export async function getBook(id) {
  const database = await openDatabase();
  const transaction = database.transaction(BOOK_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(BOOK_STORE).get(id));
  await transactionComplete(transaction);
  return result;
}

export async function findBookByCatalogueId(catalogueId) {
  const books = await listBooks();
  return books.find((book) => book.catalogueId === catalogueId);
}

export async function listBooks() {
  const database = await openDatabase();
  const transaction = database.transaction(BOOK_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(BOOK_STORE).getAll());
  await transactionComplete(transaction);
  return result.sort((left, right) => {
    const leftDate = left.lastOpenedAt || left.addedAt || "";
    const rightDate = right.lastOpenedAt || right.addedAt || "";
    return rightDate.localeCompare(leftDate);
  });
}

export async function deleteBook(id) {
  const database = await openDatabase();
  const transaction = database.transaction([BOOK_STORE, ANNOTATION_STORE], "readwrite");
  transaction.objectStore(BOOK_STORE).delete(id);

  const index = transaction.objectStore(ANNOTATION_STORE).index("bookId");
  const cursorRequest = index.openKeyCursor(IDBKeyRange.only(id));
  cursorRequest.addEventListener("success", () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    transaction.objectStore(ANNOTATION_STORE).delete(cursor.primaryKey);
    cursor.continue();
  });

  await transactionComplete(transaction);
}

export async function saveAnnotation(annotation) {
  const database = await openDatabase();
  const transaction = database.transaction(ANNOTATION_STORE, "readwrite");
  const now = new Date().toISOString();
  const record = {
    id: uuid(),
    createdAt: now,
    ...annotation,
    updatedAt: now
  };
  transaction.objectStore(ANNOTATION_STORE).put(record);
  await transactionComplete(transaction);
  return record;
}

export async function listAnnotations(bookId, type) {
  const database = await openDatabase();
  const transaction = database.transaction(ANNOTATION_STORE, "readonly");
  const records = await requestResult(
    transaction.objectStore(ANNOTATION_STORE).index("bookId").getAll(IDBKeyRange.only(bookId))
  );
  await transactionComplete(transaction);
  return records
    .filter((record) => !type || record.type === type)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function deleteAnnotation(id) {
  const database = await openDatabase();
  const transaction = database.transaction(ANNOTATION_STORE, "readwrite");
  transaction.objectStore(ANNOTATION_STORE).delete(id);
  await transactionComplete(transaction);
}

export async function setSetting(key, value) {
  const database = await openDatabase();
  const transaction = database.transaction(SETTING_STORE, "readwrite");
  transaction.objectStore(SETTING_STORE).put({ key, value });
  await transactionComplete(transaction);
}

export async function getSetting(key, fallback) {
  const database = await openDatabase();
  const transaction = database.transaction(SETTING_STORE, "readonly");
  const record = await requestResult(transaction.objectStore(SETTING_STORE).get(key));
  await transactionComplete(transaction);
  return record ? record.value : fallback;
}

export async function clearDatabase() {
  if (databasePromise) {
    const database = await databasePromise;
    database.close();
    databasePromise = undefined;
  }

  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", resolve, { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener(
      "blocked",
      () => reject(new Error("Close other Paper Library tabs before clearing local data.")),
      { once: true }
    );
  });
}
