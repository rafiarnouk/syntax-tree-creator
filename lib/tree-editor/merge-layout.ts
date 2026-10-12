// Lays out a forest of independent subtrees (islands) side by side for the
// bottom-up merge builder. Each island is positioned with the project's own
// layout() — unmodified — so depth and x come out identical to how the
// top-down tool would draw the same subtree; this just shifts each island
// over by the width of the ones before it.

import { layout, LEAF_GAP } from "./layout";
import { isLeaf, isTriangleNode } from "./notation";
import type { PhraseNode, TreeNode } from "./types";

const ISLAND_GAP = 60;

export interface ForestLayout {
  width: number;
  maxDepth: number;
}

function rightEdge(node: TreeNode): number {
  if (node.kind === "phrase" && isTriangleNode(node)) return (node.x ?? 0) + (node.triangleWidth ?? LEAF_GAP) / 2;
  if (isLeaf(node)) return (node.x ?? 0) + LEAF_GAP / 2;
  let m = 0;
  for (const c of (node as PhraseNode).children) m = Math.max(m, rightEdge(c));
  return m;
}

function shiftAndMeasureDepth(node: TreeNode, dx: number, onDepth: (d: number) => void): void {
  node.x = (node.x ?? 0) + dx;
  onDepth(node.depth ?? 0);
  if (node.kind === "phrase") for (const c of node.children) shiftAndMeasureDepth(c, dx, onDepth);
}

export function layoutForest(forest: TreeNode[]): ForestLayout {
  let cursorX = 0;
  let maxDepth = 0;

  forest.forEach((root, i) => {
    layout(root);
    const w = rightEdge(root);
    if (i > 0) cursorX += ISLAND_GAP;
    shiftAndMeasureDepth(root, cursorX, (d) => {
      maxDepth = Math.max(maxDepth, d);
    });
    cursorX += w;
  });

  return { width: cursorX, maxDepth };
}
