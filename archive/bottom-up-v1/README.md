# Bottom-up builder — v1 (superseded)

First attempt at the bottom-up (Merge-based) tree builder: side-by-side
panels, click-to-merge directly in the tree SVG, a leaf-setup/merging
phase split, a history-stack undo, and a custom leaf-anchored forest
layout that didn't match the top-down tree's own depth-from-root look.

Replaced by a chip-tray design: a flat tray of leaf/node chips above a
view-only tree, order-independent unlink instead of undo, and a forest
layout that reuses `layout()` from `lib/tree-editor/layout.ts` per island
so the tree renders exactly like the top-down one.

Kept here for reference only — excluded from the TypeScript/ESLint
project (see `archive/**` in `tsconfig.json` and `eslint.config.mjs`) and
not imported from anywhere.
