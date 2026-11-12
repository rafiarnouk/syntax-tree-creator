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

No environment variables needed — on [Vercel](https://vercel.com):

1. Push this repo to GitHub.
2. In the Vercel dashboard, **Add New → Project**, import the repo.
3. Vercel auto-detects Next.js — no config needed. Deploy.

Every push to `main` redeploys; every PR gets its own preview URL.

## Project structure

```
app/
  layout.tsx        — root layout: fonts (next/font/google), page metadata,
                        and <Workspace>
  page.tsx           — the builders' route (they render from the layout)
  trees/page.tsx     — the saved-tree gallery
  globals.css        — all styling (light/dark aware via CSS custom properties)
components/
  Workspace.tsx      — keeps both builders mounted across routes; owns the
                        save/open actions and the prompt dialog
  TreeEditorApp.tsx  — thin React wrapper: mounts TreeEditor against a ref
  NavBar.tsx         — top bar: builder modes, My trees, theme toggle
  DocumentBar.tsx    — the open tree's title and save status, New / Example / Save
  SplitDivider.tsx   — the draggable line between the editor and the tree
  TreeGallery.tsx    — the saved-tree gallery
lib/tree-editor/
  editor.ts          — TreeEditor: a vanilla DOM controller, not a React
                        component — owns the editor's DOM directly (overlay
                        rendering, cursor/selection, folding, keystrokes)
  notation.ts         — pure parsing: tokenizer, tree parser, bracket scanner
  layout.ts           — tidy-tree layout: packs subtrees by their contours
  tree-render.ts      — draws a parsed tree as SVG markup, with no editor needed
  tree-store.ts       — saved trees: the TreeStore interface and its
                        localStorage implementation
  tree-session.ts     — links the editor to the saved tree it has open
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

## Saved trees

Trees are saved to `localStorage` for now, so they stay in one browser. The plan
is to move them to Firebase (Auth + Firestore): implement `TreeStore` against
Firestore and swap the `treeStore` export in `tree-store.ts`. Everything else
already goes through that interface, which is async for this reason.

The editor's draft is separate from saved trees. It is written on every change,
so unsaved work survives a reload; saving copies it into the open tree.

Other features that need a server (sharing a tree by link, say) can go in API
routes under `app/api/`, Next's own convention for this.
