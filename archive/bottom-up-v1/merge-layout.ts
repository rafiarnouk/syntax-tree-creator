// Layout for the bottom-up merge builder: a forest of independent subtrees
// side by side, growing upward as merges happen.

import { isLeaf } from "./notation";
import type { PhraseNode, TreeNode } from "./types";

export const LEAF_GAP = 86;
const TREE_GAP = 54; // horizontal gap between separate forest members

export interface ForestLayout {
  width: number;
  maxLevel: number;
}

// Each node's `depth` is set to its own height above its leaves (0 at a
// leaf, 1 above a single wrapped word, and so on) rather than distance from
// a shared root — there isn't one yet, and forest members can be different
// heights. That way a freshly-merged pair's new parent always lands
// directly above its two children, and every leaf stays pinned to the same
// baseline no matter how tall its neighbors in the forest are.
export function layoutForest(forest: TreeNode[]): ForestLayout {
  let cursorX = 0;
  let maxLevel = 0;

  function levelOf(node: TreeNode): number {
    if (isLeaf(node)) return 0;
    const children = (node as PhraseNode).children;
    return 1 + Math.max(...children.map(levelOf));
  }

  function assignX(node: TreeNode): void {
    if (isLeaf(node)) {
      node.x = cursorX + LEAF_GAP / 2;
      cursorX += LEAF_GAP;
      return;
    }
    const children = (node as PhraseNode).children;
    for (const c of children) assignX(c);
    const first = children[0];
    const last = children[children.length - 1];
    node.x = ((first.x ?? 0) + (last.x ?? 0)) / 2;
  }

  function assignLevels(node: TreeNode): void {
    node.depth = levelOf(node);
    maxLevel = Math.max(maxLevel, node.depth);
    if (isLeaf(node)) return;
    for (const c of (node as PhraseNode).children) assignLevels(c);
  }

  forest.forEach((root, i) => {
    if (i > 0) cursorX += TREE_GAP;
    assignX(root);
    assignLevels(root);
  });

  return { width: cursorX, maxLevel };
}
