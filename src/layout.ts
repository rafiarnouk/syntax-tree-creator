import { isLeaf } from "./notation";
import type { TreeNode } from "./types";

const LEAF_GAP = 86;

export function layout(root: TreeNode): void {
  let leafX = 0;

  function assign(node: TreeNode, depth: number): void {
    node.depth = depth;
    if (isLeaf(node)) {
      node.x = leafX * LEAF_GAP;
      leafX++;
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
