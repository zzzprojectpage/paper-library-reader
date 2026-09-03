const EXTERNAL_SOURCES = Object.freeze({
  epubbooks: Object.freeze({
    key: "epubbooks",
    name: "ePubBooks",
    url: "https://www.epubbooks.com/",
    description: "A third-party ebook catalogue requested by the user.",
    rightsNotice: "Confirm that each title is public domain or otherwise licensed for your use before downloading."
  }),
  standardebooks: Object.freeze({
    key: "standardebooks",
    name: "Standard Ebooks",
    url: "https://standardebooks.org/ebooks",
    description: "A catalogue focused on carefully produced editions of classic works.",
    rightsNotice: "Check the edition and copyright status for your jurisdiction before downloading."
  }),
  wikisource: Object.freeze({
    key: "wikisource",
    name: "Wikisource",
    url: "https://en.wikisource.org/wiki/Main_Page",
    description: "A community library of source texts with export availability varying by work.",
    rightsNotice: "Review the public-domain or free-licence notice shown for each work."
  }),
  globalgrey: Object.freeze({
    key: "globalgrey",
    name: "Global Grey",
    url: "https://www.globalgreyebooks.com/",
    description: "A catalogue of classic texts offered in ebook formats.",
    rightsNotice: "Review the source notice and local copyright status before downloading."
  }),
  doab: Object.freeze({
    key: "doab",
    name: "Directory of Open Access Books",
    shortName: "DOAB",
    url: "https://www.doabooks.org/",
    description: "A directory of peer-reviewed open-access books from academic publishers.",
    rightsNotice: "Licences and available formats vary by title; upload only a compatible EPUB."
  })
});

export function getExternalSource(key) {
  return EXTERNAL_SOURCES[key] || null;
}

export function listExternalSources() {
  return Object.values(EXTERNAL_SOURCES);
}
