// Labeled bracket notation, e.g. "[S [NP the dog] [VP barks]]".

import type { BracketScan, EmptySlot, MatchSet, Token, TreeNode } from "./types";

export const INDENT_UNIT = "    "; // 4 spaces per nesting level

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\[|\]|"[^"]*"|[^[\]\s]+/g; // a quoted phrase is one token even with spaces inside
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = m[0];
    tokens.push({
      type: t === "[" ? "open" : t === "]" ? "close" : "word",
      text: t,
      start: m.index,
      end: m.index + t.length,
    });
  }
  return tokens;
}

export function parseTree(tokens: Token[]): TreeNode | null {
  if (!tokens.length || tokens[0].type !== "open") return null;
  let pos = 0;

  function parseNode(): TreeNode {
    const openTok = tokens[pos];
    pos++;
    let label = "";
    if (tokens[pos] && tokens[pos].type === "word") {
      label = tokens[pos].text;
      pos++;
    }
    const children: TreeNode[] = [];
    while (tokens[pos] && tokens[pos].type !== "close") {
      if (tokens[pos].type === "open") {
        children.push(parseNode());
      } else {
        children.push({ kind: "leaf", text: tokens[pos].text, start: tokens[pos].start, end: tokens[pos].end });
        pos++;
      }
    }
    const closeTok = tokens[pos];
    pos++;
    return {
      kind: "phrase",
      label,
      children,
      start: openTok.start,
      end: closeTok ? closeTok.end : openTok.end,
    };
  }

  return parseNode();
}

// A phrase with no children renders the same as a leaf — nothing to descend into.
export function isLeaf(node: TreeNode): boolean {
  return node.kind === "leaf" || node.children.length === 0;
}

// A phrase whose content is bare words with no sub-brackets, e.g. "[VP chased the cat]" —
// drawn as a triangle over the full string rather than three separate branches. A single
// quoted leaf, e.g. [DP "boy"], is also a triangle regardless of word count.
export function isTriangleNode(node: TreeNode): boolean {
  if (node.kind !== "phrase") return false;
  if (node.children.length >= 2 && node.children.every((c) => c.kind === "leaf")) return true;
  const only = node.children[0];
  return node.children.length === 1 && only.kind === "leaf" && isQuoted(only.text);
}

function isQuoted(text: string): boolean {
  return /^"[\s\S]*"$/.test(text);
}

export function stripQuotes(text: string): string {
  return isQuoted(text) ? text.slice(1, -1) : text;
}

// Rebuilds a node's text in the same canonical shape the editor itself
// produces: a node with no sub-brackets (blank, or one or more bare leaf
// words) collapses onto one line; anything with nested structure expands,
// one child per line.
export function formatTree(node: TreeNode, depth = 0): string {
  if (node.kind === "leaf") return node.text;
  const opening = node.label ? "[" + node.label : "[";
  const hasNested = node.children.some((c) => c.kind === "phrase");
  if (!hasNested) {
    const words = node.children.map((c) => (c.kind === "leaf" ? c.text : "")).join(" ");
    return opening + (words ? " " + words : "") + "]";
  }
  const indent = INDENT_UNIT.repeat(depth);
  const childIndent = INDENT_UNIT.repeat(depth + 1);
  const childLines = node.children.map((c) => childIndent + formatTree(c, depth + 1));
  return opening + "\n" + childLines.join("\n") + "\n" + indent + "]";
}

export function scanBrackets(text: string): BracketScan {
  const stack: number[] = [];
  const brackets: BracketScan["brackets"] = [];
  const errors: BracketScan["errors"] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") {
      brackets.push({ index: i, type: "open" });
      stack.push(brackets.length - 1);
    } else if (ch === "]") {
      if (stack.length === 0) {
        brackets.push({ index: i, type: "close" });
        errors.push({ index: i, message: 'Unexpected "]": no matching "[" before it.' });
      } else {
        const openIdx = stack.pop()!;
        brackets[openIdx].pairIndex = brackets.length;
        brackets.push({ index: i, type: "close", pairIndex: openIdx });
      }
    }
  }
  for (const openIdx of stack) {
    errors.push({ index: brackets[openIdx].index, message: 'Unclosed "[": missing a matching "]".' });
  }
  return { brackets, errors, balanced: errors.length === 0 };
}

// The innermost "[...]" pair that actually contains `pos` — not just the
// nearest bracket character in either direction. Used to ground editing
// commands in the node the cursor is really inside, instead of guessing
// from nearby lines (which breaks once there's more than one child, or the
// cursor isn't at the "end" of anything).
export function findEnclosingBracket(scan: BracketScan, pos: number): { openIdx: number; closeIdx: number } | null {
  let best: { openIdx: number; closeIdx: number } | null = null;
  for (const b of scan.brackets) {
    if (b.type !== "open" || b.pairIndex === undefined) continue;
    const close = scan.brackets[b.pairIndex];
    if (b.index < pos && close.index >= pos) {
      if (!best || b.index > best.openIdx) best = { openIdx: b.index, closeIdx: close.index };
    }
  }
  return best;
}

// Where a node's label token ends, e.g. for "[NP ..." at openIdx, the offset
// right after "NP". Falls back to right after "[" when there's no label.
export function labelEnd(text: string, openIdx: number): number {
  const m = /^\[([^[\]\s]+)?/.exec(text.slice(openIdx));
  return m && m[1] ? openIdx + 1 + m[1].length : openIdx + 1;
}

export function findMatchSet(scan: BracketScan, caret: number): MatchSet | null {
  for (const pos of [caret - 1, caret]) {
    const b = scan.brackets.find((x) => x.index === pos);
    if (b) {
      if (b.pairIndex !== undefined) return { a: b.index, b: scan.brackets[b.pairIndex].index };
      return { a: b.index, b: -1 };
    }
  }
  return null;
}

// All the terminal words under a node, in reading order — labels (NP, Det,
// V...) are structure, not content, so they're left out.
export function collectWords(node: TreeNode): string[] {
  const words: string[] = [];
  function walk(n: TreeNode) {
    if (isLeaf(n)) {
      if (n.kind === "leaf") words.push(n.text);
      return;
    }
    if (n.kind !== "phrase") return;
    for (const c of n.children) walk(c);
  }
  walk(node);
  return words;
}

// Keeps a folded preview from growing as long as the thing it's hiding: show
// whole words from the front and back until the budget runs out.
export function buildPreview(words: string[]): string {
  const MAX = 40;
  const full = words.join(" ");
  if (full.length <= MAX || words.length <= 2) return full;

  const budget = MAX - 3;
  const front: string[] = [];
  const back: string[] = [];
  let i = 0;
  let j = words.length - 1;
  let frontLen = 0;
  let backLen = 0;

  while (i < j) {
    const tryFront = frontLen + words[i].length + (front.length ? 1 : 0);
    const tryBack = backLen + words[j].length + (back.length ? 1 : 0);
    if (tryFront + backLen <= budget && frontLen <= backLen) {
      front.push(words[i]);
      frontLen = tryFront;
      i++;
    } else if (tryBack + frontLen <= budget) {
      back.unshift(words[j]);
      backLen = tryBack;
      j--;
    } else {
      break;
    }
  }
  if (!front.length) front.push(words[0]);
  if (!back.length) back.push(words[words.length - 1]);
  return front.join(" ") + " … " + back.join(" ");
}

// A slot is a spot the guided top-down flow still needs filled: the label
// right after a lone "[", or the blank indented line below it.
export function findEmptySlots(text: string): EmptySlot[] {
  const slots: EmptySlot[] = [];
  let depth = 0;
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let lineEnd = text.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = n;
    const line = text.slice(i, lineEnd);
    const depthAtLineStart = depth;
    for (const ch of line) {
      if (ch === "[") depth++;
      else if (ch === "]") depth = Math.max(0, depth - 1);
    }
    if (/^\s*\[$/.test(line)) slots.push({ type: "label", at: i + line.length });
    else if (/^\s*$/.test(line) && depthAtLineStart > 0) slots.push({ type: "content", at: i + line.length });
    if (lineEnd === n) break;
    i = lineEnd + 1;
  }
  return slots;
}
