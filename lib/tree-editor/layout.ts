import { collectWords, isLeaf, isTriangleNode, stripQuotes } from "./notation";
import type { TreeNode } from "./types";

export const LEAF_GAP = 86;
// Plain char-count estimate, not a measured font metric: no web-font-loading
// race to get wrong, and the one constant below is easy to eyeball-tune.
const CHAR_WIDTH = 5; // ~px per character at 14px italic serif (measured, not guessed)
const TRIANGLE_PAD_CHARS = 2; // chars of padding on each side

export function layout(root: TreeNode): void {
  let cursorX = 0;

  function assign(node: TreeNode, depth: number): void {
    node.depth = depth;

    if (isTriangleNode(node) && node.kind === "phrase") {
      const text = collectWords(node).map(stripQuotes).join(" ");
      const width = (text.length + TRIANGLE_PAD_CHARS * 2) * CHAR_WIDTH;
      node.triangleWidth = width;
      node.x = cursorX + width / 2;
      cursorX += width;
      return;
    }
    if (isLeaf(node)) {
      node.x = cursorX + LEAF_GAP / 2;
      cursorX += LEAF_GAP;
      return;
    }

    const children = (node as Extract<TreeNode, { kind: "phrase" }>).children;
    for (const c of children) assign(c, depth + 1);
    const first = children[0];
    const last = children[children.length - 1];
    node.x = ((first.x ?? 0) + (last.x ?? 0)) / 2;
  }

  assign(root, 0);
}
