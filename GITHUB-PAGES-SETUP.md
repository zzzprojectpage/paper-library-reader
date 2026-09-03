# Publish Paper Library with GitHub Pages

This folder is the repository root. Upload its **contents**, including
`.nojekyll`, rather than uploading the parent `GitHub Pages Ready` folder.

1. Create a new public GitHub repository, for example `paper-library-reader`.
2. Add this folder with GitHub Desktop (recommended because the PDF character
   maps make the project larger than a convenient browser upload), or upload
   the files in multiple batches with **Add file → Upload files**.
3. Commit and push every item, including `.nojekyll`, to the `main` branch.
4. Open **Settings → Pages**.
5. Under **Build and deployment**, select **Deploy from a branch**.
6. Select branch `main`, folder `/(root)`, then **Save**.
7. After deployment completes, open:
   `https://YOUR-GITHUB-USERNAME.github.io/paper-library-reader/`

The app uses relative URLs and hash routing, so it works under a repository
subpath without a custom domain or rewrite rule.

## Public behavior

- Visitors receive only application code and open-source reader libraries.
- Uploaded EPUB, MOBI, and PDF files stay in each visitor's browser IndexedDB.
- No uploaded book is committed to GitHub or sent to the site owner.
- Catalogue searches call Gutendex directly from the visitor's browser.
- External catalogues open their official websites.
- GitHub Pages provides the HTTPS required for installation and offline caching.

To update the site, replace the changed files in the repository and commit.
Do not remove `.nojekyll`, `vendor`, `src`, `styles`, or `assets`.
