# Syntax Tree Creator

A code-editor-grade bracket notation editor for linguistic syntax trees — type `[` to open a node, get a guided label + content slot, and watch a live tree stay in sync as you build it top-down.

## Develop

```sh
npm install
npm run dev
```

Opens a dev server with hot reload at `http://localhost:3000`.

## Build

```sh
npm run build   # type-checks and produces a production build
npm run start   # serve the production build locally to sanity-check it
npm run lint    # eslint
```

## Deploy

No server data, no environment variables — on [Vercel](https://vercel.com):

1. Push this repo to GitHub.
2. In the Vercel dashboard, **Add New → Project**, import the repo.
3. Vercel auto-detects Next.js — no config needed. Deploy.

Every push to `main` redeploys; every PR gets its own preview URL.

## Project structure

```
app/
  layout.tsx        — root layout: fonts (next/font/google), page metadata
  page.tsx           — the one route; renders <TreeEditorApp />
  globals.css        — all styling (light/dark aware via CSS custom properties)
components/
  TreeEditorApp.tsx  — thin React wrapper: mounts TreeEditor against a ref
lib/tree-editor/
  editor.ts          — TreeEditor: a vanilla DOM controller, not a React
                        component — owns the editor's DOM directly (overlay
                        rendering, cursor/selection, folding, keystrokes)
  notation.ts         — pure parsing: tokenizer, tree parser, bracket scanner
  layout.ts           — tidy-tree layout: packs subtrees by their contours
  fold-map.ts         — coordinate mapping between the editor's folded view
                        and the tree's always-unfolded view
  types.ts            — shared TypeScript types
  utils.ts            — small string/DOM helpers
public/
  favicon.svg
```

`notation.ts`, `layout.ts`, and `fold-map.ts` have no DOM dependency (`layout.ts`
measures text with a canvas when one exists, and estimates widths otherwise) —
they're the easiest things to unit test if this grows test coverage later.

**Why `TreeEditor` isn't a React component:** most of what it does — syncing
a `<textarea>`'s cursor/selection on every keystroke, splicing text at exact
offsets, rebuilding an overlay — is imperative DOM work that doesn't map
cleanly onto React's render model. `TreeEditorApp.tsx` mounts it once via
`useEffect` + a ref, the same pattern used for any non-React widget (a map,
a chart, CodeMirror). If a feature needs React state/props later, add it as
its own component alongside `TreeEditorApp`, not by converting the
controller itself.

## Possible future: a backend

Everything today runs client-side (drafts persist to `localStorage` only).
If this grows features that need a server — saving/sharing a tree by link,
accounts, a tree library — add API routes under `app/api/`, Next's own
convention for this. No migration needed; the framework's already in place.
