# Paper Library Reader — Technical Reference

A static, privacy-focused EPUB/MOBI/PDF library and paper-style reader. Search the
public-domain Project Gutenberg catalogue, download a title at its source, or
upload your own DRM-free ebook or PDF and reopen it from **Own Books**.

## Run locally

Requirements: Python 3.10+ and a current desktop browser.

On Windows, the simplest option is to double-click:

```text
START-PAPER-LIBRARY.cmd
```

It starts the local server and opens the correct browser address automatically.
Do not double-click `index.html`; a `file://` page cannot load this app's
JavaScript modules.

Manual command:

```powershell
cd "$env:USERPROFILE\Desktop\paper-library-reader"
python -m http.server 4173 --bind 127.0.0.1
```

Open <http://localhost:4173/>.

Do not open `index.html` with `file://`. Browsers restrict ES modules, catalogue
requests, service workers, Cache Storage, and some local persistence on file
URLs.

There is no build step: the checked-in static files are the production output.

## Main paths and controls

| Path | Purpose |
|---|---|
| `#/library` | Discover and filter public-domain catalogue records |
| `#/own-books` | Search, filter, upload, remove, and open locally stored books |
| `#/reader/<book-id>` | Read one locally stored book |

The header has context-aware **Search**, **Refresh**, and **Upload book**
buttons. Search focuses catalogue search or Own Books search. Refresh retries
the current catalogue query or reloads Own Books without clearing filters.
Upload accepts one or more `.epub`, `.mobi`, or `.pdf` files and sends them to
Own Books.

**Own Books is an application path, not a visible disk folder.** Browser
security does not permit a static site to choose or continuously access a
filesystem folder. Book blobs and their metadata are stored in IndexedDB for
this site. Use **Clear local data** to remove all books, progress, bookmarks,
notes, preferences, and Paper Library caches.

## Features

- Responsive grid and list library views
- Search by title, author, subject, and Project Gutenberg ID (`id: 1342`)
- Source selector for Project Gutenberg and five external free/open catalogues
- Source, licence, language, reading-status, and favourites information
- Upload button, drag-and-drop import, structural EPUB/MOBI/PDF validation,
  duplicate detection, a 100 MB limit, and explicit MOBI/EPUB DRM rejection
- IndexedDB persistence for book files, metadata, covers, progress, last
  location, bookmarks, highlights, notes, favourites, status, and preferences
- Paginated and continuous reading; automatic, single-page, and two-page modes
- Light, sepia, dark, and high-contrast themes
- Font, size, weight, line spacing, paragraph spacing, and margin controls
- Table of contents, location slider, progress, in-book full-text search,
  bookmarks, highlights, notes, and full screen
- Arrow/Page Up/Page Down navigation, `B` bookmark shortcut, `/` book search,
  keyboard focus indicators, and non-blocking horizontal touch gestures
- Offline app shell and offline reopening of saved books
- Empty, loading, offline, API-failure, malformed-file, and no-result states
- Reduced-motion and forced-colour support

## Architecture

```text
paper-library-reader/
|-- assets/
|   |-- icon-192.png
|   |-- icon-512.png
|   `-- icon.svg
|-- scripts/
|   |-- make-test-epub.py
|   `-- make-test-pdf.py
|-- src/
|   |-- app.js
|   |-- catalogue.js
|   |-- external-sources.js
|   |-- foliate-reader.js
|   |-- importer.js
|   |-- reader.js
|   |-- storage.js
|   `-- utils.js
|-- styles/
|   `-- app.css
|-- tests/
|   |-- fixtures/
|   |   |-- pride-and-prejudice.mobi
|   |   |-- test-book.epub
|   |   `-- test-document.pdf
|   |-- browser-tests.html
|   |-- browser-tests.js
|   `-- e2e.py
|-- vendor/
|   |-- foliate-js/
|   |   |-- vendor/
|   |   |   |-- pdfjs/
|   |   |   |   |-- cmaps/
|   |   |   |   |-- standard_fonts/
|   |   |   |   |-- pdf.mjs
|   |   |   |   `-- pdf.worker.mjs
|   |   |   `-- fflate.js
|   |   |-- mobi.js
|   |   |-- pdf.js
|   |   |-- view.js
|   |   `-- supporting renderer modules
|   |-- EPUBJS-LICENSE.txt
|   |-- JSZIP-LICENSE.txt
|   |-- epub.min.js
|   `-- jszip.min.js
|-- .gitignore
|-- ANDROID-PHONE-SETUP.txt
|-- index.html
|-- LICENSE
|-- manifest.webmanifest
|-- README.md
|-- requirements-test.txt
|-- service-worker.js
|-- START-ANDROID.sh
|-- Start-Paper-Library.ps1
|-- START-PAPER-LIBRARY.cmd
`-- THIRD_PARTY_NOTICES.txt
```

`app.js` owns routing and UI state. `catalogue.js` is an isolated catalogue
adapter. `importer.js` treats all uploaded formats as untrusted input.
`storage.js` contains the IndexedDB boundary. `reader.js` handles EPUB, while
`foliate-reader.js` handles MOBI and PDF through the same paper-style shell.
The service worker caches only same-origin application assets; imported books
stay in IndexedDB.

## Dependency decision

Checked 2026-09-03.

| Library | Status/licence | Decision |
|---|---|---|
| epub.js 0.3.93 | BSD-2-Clause; repository active in 2026; browser/mobile reflow support | Selected as the smallest mature renderer with locations, navigation, themes, selection, and search primitives |
| JSZip 3.10.1 | MIT or GPL-3.0-or-later; used under MIT | Selected for EPUB ZIP handling and pre-render validation |
| foliate-js commit `78914ae` | MIT; active in 2026 | Selected modular MOBI/KF8 and fixed-layout rendering components; the application supplies its own UI and storage |
| PDF.js 5.5.207 | Apache-2.0 | Selected for local PDF parsing, canvas/text-layer rendering, metadata, search extraction, and page thumbnails |
| Readium `ts-toolkit` | BSD-3-Clause; active in 2026 | Evaluated; not selected because the toolkit and deployment surface are larger than this static reader needs |
| NYPL Simplified web reader | Archived legacy repository | Not selected; unsuitable as a maintained browser dependency |

Runtime dependencies are pinned and vendored, so no package manager or CDN is
needed at runtime. See `THIRD_PARTY_NOTICES.txt` and the licence files under
`vendor/`.

## Public catalogue

The Gutendex adapter searches Project Gutenberg metadata and excludes every
record where the API does not explicitly return `copyright: false`. Public
domain status varies by jurisdiction; the UI displays that warning.

Project Gutenberg's EPUB endpoints do not currently provide browser CORS
permission. A static app therefore cannot safely fetch and persist those files
with JavaScript. **Get EPUB** opens the legitimate Project Gutenberg download;
after downloading, use **Upload book** to add the file to Own Books. No public
CORS proxy, scraping service, secret, paid backend, DRM bypass, or unauthorised
source is used.

Additional catalogues are included as **external sources**:

| Source | Intended use | Current check |
|---|---|---|
| ePubBooks | User-requested ebook catalogue; verify each title | Blocked by the current corporate web filter |
| Standard Ebooks | Carefully produced editions of classic works | HTTPS endpoint returned 403 on this network |
| Wikisource | Public-domain and freely licensed source texts | HTTPS page responded successfully |
| Global Grey | Classic texts in ebook formats | HTTPS page responded successfully |
| DOAB | Peer-reviewed open-access academic books | HTTPS page responded successfully |

The app opens each official site in a new tab and does not scrape, mirror, or
claim licence status for its catalogue. Check each title's rights notice and
format before downloading and uploading it.

If Gutendex is unavailable, the app shows a retry state. Saved Own Books remain
available.

## Security and privacy

- Imported files are checked for extension/MIME and real format signatures.
  EPUB checks include ZIP/container structure and encryption metadata; MOBI
  checks include PDB/MOBI headers, record bounds, compression, and DRM flags;
  PDF parsing disables JavaScript evaluation and rejects unreadable documents.
- EPUB scripts are disabled by a sandbox. Script, object, embed, iframe, form,
  event-handler, `srcdoc`, JavaScript URL, remote stylesheet, and remote EPUB
  image content is removed during rendering.
- MOBI documents run in script-disabled sandbox frames and receive the same
  active-content sanitisation. PDF pages are application-generated canvas and
  selectable text layers; embedded document code is never executed.
- Application-controlled static templates are the only HTML inserted as HTML;
  book metadata, search results, annotations, and errors use text nodes.
- A Content Security Policy limits scripts, frames, connections, objects,
  forms, fonts, and base URLs.
- No uploaded book is transmitted. Catalogue searches go only to Gutendex;
  catalogue covers are loaded from their HTTPS source with no referrer.
- No credentials or API keys are required or included.

Storage:

| Store | Data |
|---|---|
| IndexedDB | EPUB/MOBI/PDF blobs, optional cover blobs, metadata, progress, positions, favourites, status, bookmarks, notes, reader preferences |
| localStorage | Grid/list display preference only |
| Cache Storage | Same-origin application shell only |

Browser storage is subject to user clearing, private-browsing restrictions,
quota, and eviction policy. Keep the original book files as backups.

## Automated tests

Install the pinned test-only dependency:

```powershell
python -m pip install -r requirements-test.txt
```

With the local server running in another terminal:

```powershell
python scripts\make-test-epub.py
python scripts\make-test-pdf.py
python tests\e2e.py
```

The test runner uses an installed Microsoft Edge channel. It covers pure
catalogue logic, API failure handling, malformed/encrypted book rejection,
metadata extraction, IndexedDB reruns, settings, annotations, EPUB/MOBI/PDF
rendering and search, full-text
search, the Gutendex adapter contract, all configured external sources,
Search/Refresh/Upload controls, the Own Books route, reader refresh, bookmarks,
highlights/notes, offline reopening, keyboard focus order, 375/768/1440 px
layouts, and an Android Pixel 5 touch/browser profile covering upload, Own
Books, search, EPUB rendering, and MOBI/PDF import and PDF display.

Verified on 2026-09-03 with Python 3.14.2, Playwright 1.62.0, and Microsoft Edge
150.0.4078.65: **17 browser tests passed; the end-to-end workflow passed with
no application console errors.**

Not runtime-tested here: physical iOS/Android devices, Safari/Firefox, screen
reader announcements, password-protected PDFs, commercial DRM formats,
right-to-left MOBI/KF8 books, storage quota exhaustion, and files near the
100 MB limit. Those remain manual acceptance checks.

## Desktop and mobile access

This is a standard static HTML application; no APK or native Android project is
required. Keep the **entire folder structure** together. `index.html` depends
on the CSS, JavaScript modules, vendored reader libraries, icons, manifest, and
service worker in the adjacent folders. No book files need to be placed beside
the app.

### Android-only setup (no PC)

The Android ZIP contains `ANDROID-PHONE-SETUP.txt` at archive root and inside
the application folder. It gives the complete Termux setup. In summary:

```sh
termux-setup-storage
pkg update
pkg install python
cd ~/storage/downloads/paper-library-reader
sh START-ANDROID.sh
```

Then open `http://127.0.0.1:4173/` in Android Chrome and keep Termux running.
Do not open `index.html` directly.

### Recommended Android setup

Deploy the complete folder to an HTTPS static host, open its URL in current
Android Chrome, then choose **Install app** or **Add to Home screen** from the
browser menu. HTTPS enables the installable app shell and offline reopening.
Use **Upload book** to select EPUB, MOBI, or PDF files from Android
Files/Downloads. Each phone
keeps its own books in that browser's IndexedDB; books do not sync between the
PC and phone.

### Temporary same-Wi-Fi setup

For another device on the same trusted network:

```powershell
python -m http.server 4173 --bind 0.0.0.0
```

Open `http://<computer-LAN-IP>:4173/` and allow the port only on the trusted
private network if the firewall prompts. Keep the computer and terminal
running while the phone uses the app. Upload, reading, search, and IndexedDB
work, but service workers require HTTPS except on `localhost`; use HTTPS
static hosting for Android installation and offline app-shell behaviour.

Copying the folder to Android and opening `index.html` directly from a file
manager is not supported because `file://` blocks modules and service workers.
Use the included Termux launcher instead.

## Static deployment

Upload the folder contents unchanged to GitHub Pages, Azure Static Web Apps,
Netlify, Cloudflare Pages, or another HTTPS static host. Hash routing means no
SPA rewrite rule is required. Keep the CSP in `index.html`; if a host adds a
CSP header, it must allow the same sources. Deploying a prior copy of the
folder rolls back application code. Browser data uses the same origin and is
not deleted by a code rollback.
