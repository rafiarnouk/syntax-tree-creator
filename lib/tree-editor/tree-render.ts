// Draws a parsed tree as SVG markup. Has no ties to the editor, so anything
// that only needs a picture of a tree can use it.

import { collectWords, extractArrows, isLeaf, isTriangleNode, parseTree, scanBrackets, stripQuotes, tokenize } from "./notation";
import type { MovementArrow } from "./notation";
import { labelWidth, layout, LEVEL_H, measurer, NODE_GAP } from "./layout";
import type { TreeNode } from "./types";
import { escapeHtml } from "./utils";

export type TreeStyle = "simple" | "fancy";

export interface TreeSpan {
  start: number;
  end: number;
  id: string;
}

export interface TreeDrawing {
  markup: string; // the contents of the <svg>, sized to w by h
  w: number;
  h: number;
  spans: TreeSpan[];
  nodeById: Map<string, TreeNode>;
  parentByNode: Map<TreeNode, TreeNode>;
  idsByNode: Map<TreeNode, string[]>;
  phraseCount: number;
  leafCount: number;
}

interface DrawOptions {
  style?: TreeStyle;
  idPrefix?: string;
  toRaw?: (node: TreeNode) => { start: number; end: number };
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function drawTree(parsed: TreeNode, { style = "simple", idPrefix = "n", toRaw = (n) => n }: DrawOptions = {}): TreeDrawing {
  const spans: TreeSpan[] = [];
  const nodeById = new Map<string, TreeNode>();
  const parentByNode = new Map<TreeNode, TreeNode>();
  const idsByNode = new Map<TreeNode, string[]>();
  const { tree: root, arrows } = extractArrows(parsed);
  const treeW = layout(root);
  const addId = (node: TreeNode, id: string) => {
    nodeById.set(id, node);
    const ids = idsByNode.get(node) ?? [];
    ids.push(id);
    idsByNode.set(node, ids);
  };
  interface DrawNode {
    x: number;
    depth: number;
    leaf: boolean;
    label: string;
    text: string;
    start: number;
    end: number;
    id: string;
  }
  const nodes: DrawNode[] = [];
  const lines: { x1: number; y1: number; x2: number; y2: number; depth: number }[] = [];
  const triangles: { x: number; apexDepth: number; baseDepth: number; halfWidth: number; depth: number }[] = [];
  const terminals: { x: number; depth: number; at: number }[] = [];
  let maxDepth = 0;

  const walk = (node: TreeNode, parent: TreeNode | null): void => {
    const depth = node.depth ?? 0;
    const x = node.x ?? 0;
    maxDepth = Math.max(maxDepth, depth);
    const triangle = node.kind === "phrase" && isTriangleNode(node);
    const terminal = isLeaf(node) && !triangle;
    // A childless node with a label, e.g. [T_1], draws just its label.
    const leaf = terminal && !(node.kind === "phrase" && node.label);
    if (terminal) terminals.push({ x, depth, at: node.start });
    if (parent) {
      lines.push({ x1: parent.x ?? 0, y1: parent.depth ?? 0, x2: x, y2: depth, depth });
      parentByNode.set(node, parent);
    }
    const id = idPrefix + spans.length;
    const raw = toRaw(node);
    spans.push({ start: raw.start, end: raw.end, id });
    addId(node, id);
    nodes.push({
      x,
      depth,
      leaf,
      label: node.kind === "phrase" ? node.label : "",
      text: node.kind === "leaf" ? stripQuotes(node.text) : "",
      start: raw.start,
      end: raw.end,
      id,
    });

    if (triangle && node.kind === "phrase") {
      const baseDepth = depth + 1;
      maxDepth = Math.max(maxDepth, baseDepth);
      const halfWidth = (node.triangleWidth ?? 0) / 2;
      triangles.push({ x, apexDepth: depth, baseDepth, halfWidth, depth: baseDepth });
      const first = node.children[0];
      terminals.push({ x, depth: baseDepth, at: first.start });
      const last = node.children[node.children.length - 1];
      const rawSpan = toRaw({ ...first, end: last.end });
      const tid = idPrefix + spans.length;
      spans.push({ start: rawSpan.start, end: rawSpan.end, id: tid });
      addId(node, tid);
      nodes.push({
        x,
        depth: baseDepth,
        leaf: true,
        label: "",
        text: collectWords(node).map(stripQuotes).join(" "),
        start: rawSpan.start,
        end: rawSpan.end,
        id: tid,
      });
      return;
    }
    if (!leaf && node.kind === "phrase") for (const c of node.children) walk(c, node);
  };
  walk(root, null);

  const PAD = 44;
  const w = treeW + PAD * 2;
  const arrowSvg = arrows.length ? renderArrows(arrows, terminals, treeSegments(nodes, lines, triangles, PAD), PAD) : { markup: "", bottom: 0 };
  const h = Math.max((maxDepth + 1) * LEVEL_H + PAD * 1.4, arrowSvg.bottom + PAD * 0.6);
  const simple = style === "simple";

  let markup = "";
  for (const l of lines) {
    const x1 = l.x1 + PAD;
    const y1 = l.y1 * LEVEL_H + PAD + NODE_GAP;
    const x2 = l.x2 + PAD;
    const y2 = l.y2 * LEVEL_H + PAD - NODE_GAP;
    if (simple) {
      markup += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--tree-line)" stroke-width="1"/>`;
    } else {
      markup += `<path d="M ${x1} ${y1} C ${x1} ${y1 + 28}, ${x2} ${y2 - 22}, ${x2} ${y2}" fill="none" stroke="var(--depth-${l.depth % 5})" stroke-width="1.6" opacity=".75"/>`;
    }
  }
  for (const t of triangles) {
    const apexX = t.x + PAD;
    const apexY = t.apexDepth * LEVEL_H + PAD + NODE_GAP;
    const baseY = t.baseDepth * LEVEL_H + PAD - NODE_GAP;
    const baseX1 = t.x + PAD - t.halfWidth;
    const baseX2 = t.x + PAD + t.halfWidth;
    const stroke = simple ? "var(--tree-line)" : `var(--depth-${t.depth % 5})`;
    markup += `<polygon points="${apexX},${apexY} ${baseX1},${baseY} ${baseX2},${baseY}" fill="none" stroke="${stroke}" stroke-width="${simple ? 1 : 1.6}"${simple ? "" : ' opacity=".75"'}/>`;
  }
  for (const n of nodes) {
    const colorCls = simple ? (n.leaf ? "simple-leaf" : "simple-node") : "d" + (n.depth % 5);
    const cls = (n.leaf ? "leaf" : "label") + " " + colorCls;
    const labelMarkup = n.leaf ? escapeHtml(n.text) : renderLabelMarkup(n.label || "∅");
    markup += `<text id="${n.id}" class="tree-node ${cls}" data-start="${n.start}" data-end="${n.end}" x="${n.x + PAD}" y="${n.depth * LEVEL_H + PAD}" text-anchor="middle" dominant-baseline="central">${labelMarkup}</text>`;
  }
  markup += arrowSvg.markup;

  const phraseCount = nodes.filter((n) => !n.leaf).length;
  const leafCount = nodes.filter((n) => n.leaf).length;
  return { markup, w, h, spans, nodeById, parentByNode, idsByNode, phraseCount, leafCount };
}

// Null when the text isn't a complete tree yet.
export function drawSource(source: string, idPrefix?: string): TreeDrawing | null {
  if (!source.trim() || !scanBrackets(source).balanced) return null;
  const tree = parseTree(tokenize(source));
  return tree ? drawTree(tree, { idPrefix }) : null;
}

// Everything drawn, as segments: lines, triangle edges, and a line along the
// bottom of each node's text.
function treeSegments(
  nodes: { x: number; depth: number; leaf: boolean; label: string; text: string }[],
  lines: { x1: number; y1: number; x2: number; y2: number }[],
  triangles: { x: number; apexDepth: number; baseDepth: number; halfWidth: number }[],
  pad: number,
): Segment[] {
  const TEXT_BOTTOM = 8;
  const measure = measurer();
  const segs: Segment[] = [];
  for (const n of nodes) {
    const w = n.leaf ? measure(n.text) : labelWidth(n.label || "∅", measure);
    const x = n.x + pad;
    const y = n.depth * LEVEL_H + pad + TEXT_BOTTOM;
    segs.push({ x1: x - w / 2, y1: y, x2: x + w / 2, y2: y });
  }
  for (const l of lines) {
    segs.push({ x1: l.x1 + pad, y1: l.y1 * LEVEL_H + pad + NODE_GAP, x2: l.x2 + pad, y2: l.y2 * LEVEL_H + pad - NODE_GAP });
  }
  for (const t of triangles) {
    const apex = { x: t.x + pad, y: t.apexDepth * LEVEL_H + pad + NODE_GAP };
    const baseY = t.baseDepth * LEVEL_H + pad - NODE_GAP;
    segs.push({ x1: apex.x, y1: apex.y, x2: apex.x - t.halfWidth, y2: baseY });
    segs.push({ x1: apex.x, y1: apex.y, x2: apex.x + t.halfWidth, y2: baseY });
  }
  return segs;
}

// Boxy arrows: down from one word, across just below the lowest thing
// drawn between the two, and up into the other. An arrow overlapping one
// already placed runs below it.
function renderArrows(
  arrows: MovementArrow[],
  terminals: { x: number; depth: number; at: number }[],
  segs: Segment[],
  pad: number,
): { markup: string; bottom: number } {
  const CLEAR = 12;
  const STACK = 8;
  const HEAD = 7;
  const SPREAD = 8;
  const wordBottom = (i: number) => terminals[i].depth * LEVEL_H + pad + NODE_GAP;

  const lowestIn = (lo: number, hi: number): number => {
    let y = 0;
    for (const s of segs) {
      const sl = Math.min(s.x1, s.x2);
      const sr = Math.max(s.x1, s.x2);
      if (sr < lo || sl > hi) continue;
      if (sl === sr) {
        y = Math.max(y, s.y1, s.y2);
        continue;
      }
      const yAt = (x: number) => s.y1 + ((s.y2 - s.y1) * (x - s.x1)) / (s.x2 - s.x1);
      y = Math.max(y, yAt(Math.max(sl, lo)), yAt(Math.min(sr, hi)));
    }
    return y;
  };

  const spans: { from: number; to: number; head: MovementArrow["head"] }[] = [];
  for (const a of arrows) {
    let from = 0;
    terminals.forEach((t, i) => {
      if (t.at < a.at) from = i;
    });
    const to = a.target - 1;
    if (to < 0 || to >= terminals.length || to === from) continue;
    spans.push({ from, to, head: a.head });
  }
  spans.sort((a, b) => Math.abs(a.to - a.from) - Math.abs(b.to - b.from));

  // Arrows meeting at one word attach side by side, ordered by where their
  // other end is, so their legs neither overlap nor cross.
  const ends = new Map<number, { key: string; other: number }[]>();
  spans.forEach((s, k) => {
    for (const [at, other, side] of [[s.from, s.to, "from"], [s.to, s.from, "to"]] as const) {
      const list = ends.get(at) ?? [];
      list.push({ key: k + side, other: terminals[other].x });
      ends.set(at, list);
    }
  });
  const shift = new Map<string, number>();
  for (const list of ends.values()) {
    list.sort((a, b) => a.other - b.other);
    list.forEach((e, i) => shift.set(e.key, (i - (list.length - 1) / 2) * SPREAD));
  }

  const placed: { lo: number; hi: number; bottom: number }[] = [];
  let markup = "";
  let maxBottom = 0;
  spans.forEach((s, k) => {
    const x1 = terminals[s.from].x + pad + shift.get(k + "from")!;
    const x2 = terminals[s.to].x + pad + shift.get(k + "to")!;
    const lo = Math.min(x1, x2) - HEAD;
    const hi = Math.max(x1, x2) + HEAD;
    const tip1 = wordBottom(s.from);
    const tip2 = wordBottom(s.to);
    let bottom = Math.max(lowestIn(lo, hi), tip1, tip2) + CLEAR;
    for (const p of placed) if (p.lo <= hi && lo <= p.hi) bottom = Math.max(bottom, p.bottom + STACK);
    placed.push({ lo, hi, bottom });
    maxBottom = Math.max(maxBottom, bottom);

    const headAtFrom = s.head !== "to";
    const headAtTo = s.head !== "from";
    const y1 = tip1 + (headAtFrom ? HEAD : 0);
    const y2 = tip2 + (headAtTo ? HEAD : 0);
    markup += `<path class="tree-arrow" d="M ${x1} ${y1} V ${bottom} H ${x2} V ${y2}" fill="none" stroke="var(--tree-arrow)" stroke-width="1.2" stroke-linejoin="miter"/>`;
    const head = (x: number, tip: number) =>
      `<polygon class="tree-arrow" points="${x},${tip} ${x - HEAD / 2},${tip + HEAD} ${x + HEAD / 2},${tip + HEAD}" fill="var(--tree-arrow)" stroke="none"/>`;
    if (headAtFrom) markup += head(x1, tip1);
    if (headAtTo) markup += head(x2, tip2);
  });
  return { markup, bottom: maxBottom };
}

function renderLabelMarkup(label: string): string {
  const m = /^(.+)_([^_\s]+)$/.exec(label);
  if (!m) return escapeHtml(label);
  return `${escapeHtml(m[1])}<tspan dy="0.28em" font-size="0.72em">${escapeHtml(m[2])}</tspan>`;
}
