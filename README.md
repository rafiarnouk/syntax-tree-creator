# Syntax Tree Creator

A code-editor-grade bracket notation editor for linguistic syntax trees — type `[` to open a node, get a guided label + content slot, and watch a live tree stay in sync as you build it top-down.

## Develop

```sh
npm install
npm run dev
```

Opens a dev server with hot reload at `http://localhost:5173`.

## Build

```sh
npm run build   # type-checks with tsc, then bundles with vite into dist/
npm run preview # serve the production build locally to sanity-check it
```

## Deploy

This is a static, client-only site — no server, no environment variables. On [Vercel](https://vercel.com):

1. Push this repo to GitHub.
2. In the Vercel dashboard, **Add New → Project**, import the repo.
3. Vercel auto-detects the Vite framework preset — no config needed. Deploy.

Every push to `main` redeploys; every PR gets its own preview URL.

## Project structure

```
index.html        — page shell + markup (editor panel, tree panel, footer)
src/style.css      — all styling (light/dark aware via CSS custom properties)
src/main.ts        — entry point, boots the editor against the DOM
src/editor.ts       — TreeEditor: owns the DOM, all interactive behavior
                     (keystrokes, overlay rendering, folding, autocomplete)
src/notation.ts     — pure parsing: tokenizer, tree parser, bracket scanner
src/layout.ts       — assigns tree node positions for the SVG render
src/fold-map.ts     — coordinate mapping between the editor's folded view
                     and the tree's always-unfolded view
src/types.ts        — shared TypeScript types
src/utils.ts         — small string/DOM helpers
```

`notation.ts`, `layout.ts`, and `fold-map.ts` have no DOM dependency — they're
the easiest things to unit test if this grows test coverage later.

## Possible future: a backend

Everything today runs client-side (drafts persist to `localStorage` only).
If this grows features that need a server — saving/sharing a tree by link,
accounts, a tree library — the natural next step on Vercel is a `/api`
folder of serverless functions, which deploys alongside this static site
with no framework migration required. Reach for a full framework (e.g.
Next.js) only if the app outgrows that.
