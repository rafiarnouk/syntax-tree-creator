// Tidy-tree layout from measured text widths. Each subtree keeps a contour
// (its left/right extent on every row below it) and siblings are packed as
// close as their contours allow, so a short subtree can tuck in under a
// neighbor's empty space. A terminal also reserves the column beneath it, so
// words always stay in reading order and nothing hangs directly under one.

import { collectWords, isLeaf, isTriangleNode, stripQuotes } from "./notation";
import type { TreeNode } from "./types";

export const LEVEL_H = 50;
export const NODE_GAP = 10; // line clearance above/below a node's (vertically centered) text

const FONT_SIZE = 14;
const SUB_SCALE = 0.72; // matches the subscript tspan in renderLabelMarkup
const H_GAP = 16; // min space between neighbors on a row
const MIN_SPREAD = 28; // min distance between sibling centers, so branches never go near-vertical
const MIN_TRIANGLE = 20;
const MIN_W = 10;

type Row = [number, number];

let ctx: CanvasRenderingContext2D | null | undefined;

function measurer(): (text: string) => number {
  if (ctx === undefined) ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const c = ctx;
  if (!c) return (text) => text.length * FONT_SIZE * 0.55;
  c.font = `${FONT_SIZE}px ${getComputedStyle(document.body).fontFamily}`;
  return (text) => c.measureText(text).width;
}

export function labelWidth(label: string, measure: (t: string) => number): number {
  const m = /^(.+)_([^_\s]+)$/.exec(label);
  return m ? measure(m[1]) + measure(m[2]) * SUB_SCALE : measure(label);
}

const at = (rows: Row[], k: number): Row => rows[Math.min(k, rows.length - 1)];

// How far right of `a`'s origin `b`'s origin must sit for the two not to touch.
function separation(a: Row[], b: Row[]): number {
  let d = -Infinity;
  for (let k = 0; k < Math.max(a.length, b.length); k++) d = Math.max(d, at(a, k)[1] - at(b, k)[0] + H_GAP);
  return Math.max(d, MIN_SPREAD);
}

// Left-packed and right-packed placements both satisfy every pairwise
// constraint, so their average does too, and it spreads middle siblings evenly.
function pack(shapes: Row[][]): number[] {
  const n = shapes.length;
  const left = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    left[i] = -Infinity;
    for (let j = 0; j < i; j++) left[i] = Math.max(left[i], left[j] + separation(shapes[j], shapes[i]));
  }
  const right = new Array<number>(n).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    right[i] = Infinity;
    for (let j = i + 1; j < n; j++) right[i] = Math.min(right[i], right[j] - separation(shapes[i], shapes[j]));
  }
  return left.map((l, i) => (l + right[i] - right[0]) / 2);
}

// Sets depth, x, and (for triangles) triangleWidth on every node; x runs from
// 0 at the tree's leftmost extent. Returns the tree's full width.
export function layout(root: TreeNode): number {
  const measure = measurer();
  const offsets = new Map<TreeNode, number[]>();

  const box = (w: number): Row => {
    const half = Math.max(w, MIN_W) / 2;
    return [-half, half];
  };

  function shape(node: TreeNode, depth: number): Row[] {
    node.depth = depth;
    if (node.kind === "leaf") return [box(measure(stripQuotes(node.text)))];
    const label = box(labelWidth(node.label, measure));
    if (isTriangleNode(node)) {
      const base = Math.max(measure(collectWords(node).map(stripQuotes).join(" ")), MIN_TRIANGLE);
      node.triangleWidth = base;
      return [label, box(base)];
    }
    if (isLeaf(node)) return [label];

    const kids = node.children.map((c) => shape(c, depth + 1));
    const off = pack(kids);
    const mid = (off[0] + off[off.length - 1]) / 2;
    const rel = off.map((o) => o - mid);
    offsets.set(node, rel);

    const rows: Row[] = [label];
    const deepest = Math.max(...kids.map((k) => k.length));
    for (let k = 0; k < deepest; k++) {
      let l = Infinity;
      let r = -Infinity;
      kids.forEach((kid, i) => {
        const row = at(kid, k);
        l = Math.min(l, row[0] + rel[i]);
        r = Math.max(r, row[1] + rel[i]);
      });
      rows.push([l, r]);
    }
    return rows;
  }

  const rows = shape(root, 0);
  const minX = Math.min(...rows.map((r) => r[0]));
  const maxX = Math.max(...rows.map((r) => r[1]));

  const place = (node: TreeNode, x: number): void => {
    node.x = x;
    const rel = offsets.get(node);
    if (rel && node.kind === "phrase") node.children.forEach((c, i) => place(c, x + rel[i]));
  };
  place(root, -minX);
  return maxX - minX;
}
