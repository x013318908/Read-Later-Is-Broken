# Read Later Is Broken

Read Later Is Broken is a Chrome extension for DeepReading: save pages to NotebookLM, listen when they matter, then ask better questions.

Read later is broken. Listen first. Ask later.

This project is not affiliated with Google or NotebookLM.

## Install

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/read-later-is-broken/cllfneapemcmglbmdknppgancgdacgfi)

## What It Does

- Adds the current browser tab to selected NotebookLM notebooks.
- Separates broad digest saving from focused theme saving.
- Supports Daily, Weekly, and Monthly digest notebooks with fixed ISO-style names.
- Lets you search existing NotebookLM notebooks and keep selected theme notebooks checked.
- Lets you create a new NotebookLM notebook from the same search/title field.
- Runs add jobs in the background, so the popup can be closed while NotebookLM processes the request.
- Stores the last add result in the popup so persistent NotebookLM-side errors remain visible.
- Uses Chrome UI language for the extension UI, with English and Japanese locale files.

The extension adds pages as NotebookLM sources. It does not automatically generate Deep Dives or audio overviews.

## DeepReading Flow

1. Save the current page to digest or theme notebooks.
2. Open NotebookLM when the notebook is worth attention.
3. Generate a Deep Dive or ask follow-up questions inside NotebookLM.

## Development Setup

```powershell
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, and load the generated `dist` folder as an unpacked extension.

For development builds:

```powershell
npm run dev
```

## Current Scope

- The extension targets one active browser tab at a time.
- The popup fetches the current tab URL/title and sends that page to selected destinations.
- If no saved destinations exist, the popup fetches the NotebookLM notebook list automatically.
- The notebook list can be refreshed from the popup.
- Digest mode targets only Daily / Weekly / Monthly notebooks.
- Theme mode targets checked existing notebooks.
- Checked notebooks remain visible even when the search query would otherwise filter them out.
- List refresh, search, and notebook creation views place checked notebooks first; immediate check/uncheck actions do not reorder the list.
- Daily / Weekly / Monthly notebooks use local dates and these names:
  - `Daily yyyy-MM-dd`
  - `Weekly yyyy-Www`
  - `Monthly yyyy-MM`
- Date notebooks are reused when a same-name notebook exists, and created when missing.
- Duplicate URLs are intentionally inserted again because NotebookLM allows duplicates and imports the current page state.

Out of scope for now:

- URL pattern matching
- Custom naming templates
- Multi-tab batch adds
- Automatic Deep Dive or audio overview generation

## Permissions

The extension requests:

- `activeTab`: read the current tab URL/title after the user opens the popup.
- `scripting`: run bundled helper code in temporary NotebookLM tabs.
- `storage`: store extension settings and the last add result in Chrome extension storage.
- `https://notebooklm.google.com/*`: list, create, and add sources to NotebookLM notebooks.

See [Permission Justifications](https://x013318908.github.io/Read-Later-Is-Broken/permissions.html) for the public review-facing explanation.

## GitHub Pages

GitHub Pages is published from the `docs/` folder on the `main` branch:

- [Landing page](https://x013318908.github.io/Read-Later-Is-Broken/)
- [Privacy Policy](https://x013318908.github.io/Read-Later-Is-Broken/privacy.html)
- [Permission Justifications](https://x013318908.github.io/Read-Later-Is-Broken/permissions.html)

Useful local files:

- `docs/index.html`: landing page
- `docs/privacy.html`: Chrome Web Store privacy policy
- `docs/permissions.html`: Chrome Web Store permission explanations
- `docs/assets/screenshots/`: screenshots for Pages and store materials
- `docs/assets/promotion_image/`: promotional images
- `docs/roadmap.md`: project notes and deferred ideas

## Project Files

- `public/manifest.json`: Chrome Manifest V3
- `public/_locales/*`: manifest and extension UI localization resources
- `public/icons/*`: extension icons
- `popup.html`, `src/popup/*`: popup UI
- `src/background.ts`: service worker and NotebookLM job handling
- `src/shared/*`: shared types, storage, and i18n helpers
- `src/styles/app.css`: popup styles

## NotebookLM Limits To Keep In Mind

NotebookLM limits depend on the user's plan. During development, Google AI Plus allowed up to 200 notebooks and up to 100 URL sources per notebook. When a limit is reached, add attempts can keep failing until notebooks or sources are removed in NotebookLM.

The extension keeps the last result visible in the popup so these repeated failures are easier to notice.
