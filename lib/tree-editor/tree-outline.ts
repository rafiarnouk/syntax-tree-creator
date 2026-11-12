// A label-free sketch of a tree: dots for nodes, lines for branches. Words sit
// in evenly spaced columns, so the shape doesn't depend on how long they are.

import { extractArrows, isLeaf, isTriangleNode, parseTree, scanBrackets, tokenize } from "./notation";
import { curvedBranch } from "./tree-render";
import type { TreeNode } from "./types";

export interface TreeOutline {
  markup: string;
  w: number;
  h: number;
}

// Dot radius and line thickness, at the size a small tree is drawn.
const DOT_R = 7.5;
const LINE_W = 1;

const COL = 26;
const ROW = 30;
const PAD = 12;
// Roughly the gallery's preview box: big trees get scaled down to fit, so their
// dots are drawn larger to stay at least MIN_DOT pixels across once shrunk.
const FIT_W = 250;
const FIT_H = 150;
const MIN_DOT = 2.6;

interface Point {
  x: number;
  depth: number;
}

// Null when the text isn't a complete tree yet.
export function drawOutline(source: string): TreeOutline | null {
  if (!source.trim() || !scanBrackets(source).balanced) return null;
  const parsed = parseTree(tokenize(source));
  if (!parsed) return null;
  // Arrow tokens like ->2 aren't words, so they come out before drawing.
  const { tree } = extractArrows(parsed);

  const edges: [Point, Point][] = [];
  const nodes: (Point & { word: boolean })[] = [];
  let columns = 0;
  let maxDepth = 0;

  const place = (node: TreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    // Several words under one node, e.g. [DP the old man], draw as a single word.
    if (isTriangleNode(node) && node.kind === "phrase") {
      const x = columns++ * COL;
      maxDepth = Math.max(maxDepth, depth + 1);
      edges.push([{ x, depth }, { x, depth: depth + 1 }]);
      nodes.push({ x, depth, word: false }, { x, depth: depth + 1, word: true });
      return x;
    }
    if (isLeaf(node) || node.kind === "leaf") {
      const x = columns++ * COL;
      nodes.push({ x, depth, word: node.kind === "leaf" });
      return x;
    }
    const xs = node.children.map((child) => place(child, depth + 1));
    const x = (xs[0] + xs[xs.length - 1]) / 2;
    for (const cx of xs) edges.push([{ x, depth }, { x: cx, depth: depth + 1 }]);
    nodes.push({ x, depth, word: false });
    return x;
  };
  place(tree, 0);

  const treeW = (columns - 1) * COL;
  const yOf = (depth: number) => depth * ROW + PAD;
  const xOf = (x: number) => x + PAD;

  const w = treeW + PAD * 2;
  const h = maxDepth * ROW + PAD * 2;
  const scale = Math.min(1, FIT_W / w, FIT_H / h);
  const r = Math.max(DOT_R, MIN_DOT / scale);

  let markup = "";
  for (const [p, c] of edges) {
    const d = curvedBranch(xOf(p.x), yOf(p.depth), xOf(c.x), yOf(c.depth));
    markup += `<path class="outline-edge" d="${d}" stroke-width="${LINE_W}" vector-effect="non-scaling-stroke"/>`;
  }
  for (const n of nodes) {
    markup += `<circle class="${n.word ? "outline-word" : "outline-node"}" cx="${xOf(n.x)}" cy="${yOf(n.depth)}" r="${n.word ? r * 0.9 : r}" stroke-width="${LINE_W}" vector-effect="non-scaling-stroke"/>`;
  }
  return { markup, w, h };
}
