import { buildFoldMap, mapNodeToRaw, remapFolds } from "./fold-map";
import {
  buildPreview,
  collectWords,
  findEmptySlots,
  findMatchSet,
  isLeaf,
  parseTree,
  scanBrackets,
  tokenize,
} from "./notation";
import { layout } from "./layout";
import type { BracketScan, FoldableNode, FoldRecord, LabelOption, MatchSet, TreeNode } from "./types";
import { escapeHtml, lineOf } from "./utils";

const UNIT = "    "; // 4 spaces per nesting level
const DRAFT_KEY = "syntax-tree-creator-draft";
const FOLDS_KEY = "syntax-tree-creator-folds";

// Disabled for now; showAutocomplete/chooseAutocomplete etc. stay in place.
const AUTOCOMPLETE_ENABLED = false;

const LABELS: LabelOption[] = [
  { key: "S", desc: "Sentence" },
  { key: "NP", desc: "Noun phrase" },
  { key: "VP", desc: "Verb phrase" },
  { key: "PP", desc: "Prepositional phrase" },
  { key: "AP", desc: "Adjective phrase" },
  { key: "AdvP", desc: "Adverb phrase" },
  { key: "DP", desc: "Determiner phrase" },
  { key: "CP", desc: "Complementizer phrase" },
  { key: "TP", desc: "Tense phrase" },
  { key: "IP", desc: "Inflection phrase" },
  { key: "Det", desc: "Determiner" },
  { key: "D", desc: "Determiner" },
  { key: "N", desc: "Noun" },
  { key: "V", desc: "Verb" },
  { key: "P", desc: "Preposition" },
  { key: "Adj", desc: "Adjective" },
  { key: "A", desc: "Adjective" },
  { key: "Adv", desc: "Adverb" },
  { key: "Deg", desc: "Degree word" },
  { key: "Comp", desc: "Complementizer" },
  { key: "Infl", desc: "Inflection" },
  { key: "T", desc: "Tense" },
  { key: "Neg", desc: "Negation" },
  { key: "Conj", desc: "Conjunction" },
];

const SAMPLE =
  "[S\n    [NP [Det the] [N dog]]\n    [VP\n        [V chased]\n        [NP [Det the] [N cat]]\n    ]\n]";

interface TreeSpan {
  start: number;
  end: number;
  id: string;
}

export class TreeEditor {
  private ta: HTMLTextAreaElement;
  private overlay: HTMLPreElement;
  private gutterEl: HTMLElement;
  private statusEl: HTMLElement;
  private charCountEl: HTMLElement;
  private treeArea: HTMLElement;
  private treeBadge: HTMLElement;
  private acEl: HTMLElement;

  private acOpen = false;
  private acItems: LabelOption[] = [];
  private acIndex = 0;
  private acRange: [number, number] | null = null;

  private treeSpans: TreeSpan[] = [];
  private folds: FoldRecord[] = [];
  private prevValue = "";

  constructor(root: HTMLElement) {
    this.ta = root.querySelector<HTMLTextAreaElement>("#editor")!;
    this.overlay = root.querySelector<HTMLPreElement>("#overlay")!;
    this.gutterEl = root.querySelector<HTMLElement>("#gutter")!;
    this.statusEl = root.querySelector<HTMLElement>("#statusLine")!;
    this.charCountEl = root.querySelector<HTMLElement>("#charCount")!;
    this.treeArea = root.querySelector<HTMLElement>("#treeArea")!;
    this.treeBadge = root.querySelector<HTMLElement>("#treeBadge")!;
    this.acEl = root.querySelector<HTMLElement>("#autocomplete")!;

    this.bindEvents();
    this.renderLegend(root);
    this.boot(root);
  }

  // ---------- boot ----------

  private boot(root: HTMLElement): void {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(DRAFT_KEY);
    } catch {
      /* private browsing / storage disabled */
    }
    try {
      const savedFolds = JSON.parse(localStorage.getItem(FOLDS_KEY) || "[]");
      if (Array.isArray(savedFolds)) this.folds = savedFolds;
    } catch {
      /* ignore malformed storage */
    }

    this.ta.value = saved || "";
    this.prevValue = this.ta.value;
    this.update();
    this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length);

    root.querySelector<HTMLButtonElement>("#resetBtn")!.addEventListener("click", () => {
      this.folds = [];
      this.setValue(SAMPLE, SAMPLE.length);
      this.ta.focus();
    });
  }

  private renderLegend(root: HTMLElement): void {
    const names = ["Depth 1", "Depth 2", "Depth 3", "Depth 4", "Depth 5"];
    const html = names.map((name, i) => `<span class="chip"><span class="dot" style="background:var(--depth-${i})"></span>${name}</span>`).join("");
    root.querySelector<HTMLElement>("#legend")!.innerHTML = html;
  }

  // ---------- core update loop ----------

  private update(): void {
    this.folds = remapFolds(this.prevValue, this.ta.value, this.folds);
    const text = this.ta.value;
    const scan = scanBrackets(text);
    const caret = this.ta.selectionStart;
    const matchSet = findMatchSet(scan, caret);
    this.overlay.innerHTML = this.buildOverlayHTML(text, scan, matchSet, caret);
    this.renderStatus(text, scan, caret);

    let foldable: FoldableNode[] = [];
    if (!text.trim()) {
      this.showTreeMessage(
        'Press <kbd>[</kbd> in the editor to start a node — a <b>label</b> slot and a <b>content</b> slot will appear for you to fill in.',
      );
    } else if (!scan.balanced) {
      this.showTreeMessage("Fix the bracket error below the editor to see the tree.");
    } else {
      const tree = parseTree(tokenize(text));
      if (tree) {
        // tree is for gutter/fold detection (raw text); fullTree (folds
        // expanded back to their real content) is what actually renders.
        const expanded = buildFoldMap(text, this.folds);
        const fullTree = this.folds.length ? parseTree(tokenize(expanded.text)) : tree;
        this.renderTreeView(fullTree || tree, expanded.map);
        this.highlightActiveNode();
        foldable = this.collectFoldable(tree, text);
      } else {
        this.showTreeMessage("A tree starts with an opening bracket, e.g. <b>[S …]</b>.");
      }
    }
    this.renderGutter(text, foldable);

    this.checkAutocomplete();
    this.prevValue = text;
    try {
      localStorage.setItem(DRAFT_KEY, text);
      localStorage.setItem(FOLDS_KEY, JSON.stringify(this.folds));
    } catch {
      /* private browsing / storage disabled */
    }
  }

  private setValue(newVal: string, selStart: number, selEnd?: number): void {
    this.ta.value = newVal;
    this.ta.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
    this.update();
  }

  // ---------- overlay (bracket coloring, ghost slots, fold chips) ----------

  private buildOverlayHTML(text: string, scan: BracketScan, matchSet: MatchSet | null, caret: number): string {
    const pieces: string[] = [];
    let d = 0;
    const errIdx = new Set(scan.errors.map((e) => e.index));
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "[" || ch === "]") {
        let depthForColor: number;
        if (ch === "[") {
          depthForColor = d;
          d++;
        } else {
          d = Math.max(0, d - 1);
          depthForColor = d;
        }
        let cls = "br d" + (depthForColor % 5);
        if (errIdx.has(i)) cls += " err";
        if (matchSet && (i === matchSet.a || i === matchSet.b)) cls += " match";
        pieces.push(`<span class="${cls}">${ch}</span>`);
      } else {
        pieces.push(escapeHtml(ch));
      }
    }

    const slotMap = new Map<number, { type: "label" | "content"; at: number }[]>();
    for (const slot of findEmptySlots(text)) {
      const arr = slotMap.get(slot.at) ?? [];
      arr.push(slot);
      slotMap.set(slot.at, arr);
    }

    const foldStarts = new Set(this.folds.map((f) => f.start));
    const foldEnds = new Set(this.folds.map((f) => f.end));

    let html = "";
    for (let p = 0; p <= text.length; p++) {
      if (foldEnds.has(p)) html += "</span>";
      const slots = slotMap.get(p);
      if (slots) {
        for (const slot of slots) {
          const activeCls = caret === slot.at ? " active" : "";
          html += `<span class="slot-ghost${activeCls}">${slot.type === "label" ? "label" : "content"}</span>`;
        }
      }
      if (foldStarts.has(p)) html += '<span class="fold-chip">';
      if (p < text.length) html += pieces[p];
    }
    if (!text.length || text[text.length - 1] !== "\n") html += "\n";
    return html;
  }

  // ---------- rendering ----------

  private renderGutter(text: string, foldable: FoldableNode[]): void {
    const totalLines = text.split("\n").length;
    const foldByLine = new Map<number, FoldableNode>();
    for (const f of foldable) {
      const ln = lineOf(text, f.start);
      if (!foldByLine.has(ln)) foldByLine.set(ln, f);
    }
    const unfoldByLine = new Map<number, number>();
    this.folds.forEach((f, idx) => unfoldByLine.set(lineOf(text, f.start), idx));

    let html = "";
    for (let i = 1; i <= totalLines; i++) {
      let btn = "";
      const unfoldIdx = unfoldByLine.get(i);
      const foldable0 = foldByLine.get(i);
      if (unfoldIdx !== undefined) {
        btn = `<button type="button" class="fold-btn" data-unfold="${unfoldIdx}" title="Expand this node">▸</button>`;
      } else if (foldable0) {
        btn =
          `<button type="button" class="fold-btn" data-fold-start="${foldable0.start}" data-fold-end="${foldable0.end}" ` +
          `data-label="${escapeHtml(foldable0.label)}" data-preview="${escapeHtml(foldable0.preview)}" title="Collapse this node">▾</button>`;
      }
      html += `<div class="gline">${btn}<span class="lineno">${i}</span></div>`;
    }
    this.gutterEl.innerHTML = html;
  }

  private renderStatus(text: string, scan: BracketScan, caret: number): void {
    if (scan.errors.length) {
      this.statusEl.textContent = scan.errors[0].message;
      this.statusEl.classList.add("danger");
    } else {
      const before = text.slice(0, caret);
      const line = before.split("\n").length;
      const col = caret - before.lastIndexOf("\n");
      this.statusEl.textContent = `Line ${line}, Col ${col}`;
      this.statusEl.classList.remove("danger");
    }
    this.charCountEl.textContent = `${text.length} ${text.length === 1 ? "char" : "chars"}`;
  }

  private showTreeMessage(html: string): void {
    this.treeArea.innerHTML = `<div class="tree-empty">${html}</div>`;
    this.treeBadge.textContent = "";
    this.treeSpans = [];
  }

  private renderTreeView(root: TreeNode, map: ReturnType<typeof buildFoldMap>["map"]): void {
    layout(root);
    this.treeSpans = [];
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
    let maxDepth = 0;
    let maxX = 0;

    const walk = (node: TreeNode, parent: TreeNode | null): void => {
      const depth = node.depth ?? 0;
      const x = node.x ?? 0;
      maxDepth = Math.max(maxDepth, depth);
      maxX = Math.max(maxX, x);
      const leaf = isLeaf(node);
      if (parent) lines.push({ x1: parent.x ?? 0, y1: parent.depth ?? 0, x2: x, y2: depth, depth });
      const id = "n" + this.treeSpans.length;
      const raw = mapNodeToRaw(node, map);
      this.treeSpans.push({ start: raw.start, end: raw.end, id });
      nodes.push({
        x,
        depth,
        leaf,
        label: node.kind === "phrase" ? node.label : "",
        text: node.kind === "leaf" ? node.text : "",
        start: raw.start,
        end: raw.end,
        id,
      });
      if (!leaf && node.kind === "phrase") for (const c of node.children) walk(c, node);
    };
    walk(root, null);

    const PAD = 44;
    const LEVEL_H = 70;
    const w = maxX + PAD * 2;
    const h = (maxDepth + 1) * LEVEL_H + PAD * 1.4;
    let svg = `<svg class="tree-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;
    for (const l of lines) {
      const x1 = l.x1 + PAD;
      const y1 = l.y1 * LEVEL_H + PAD + 10;
      const x2 = l.x2 + PAD;
      const y2 = l.y2 * LEVEL_H + PAD - 12;
      svg += `<path d="M ${x1} ${y1} C ${x1} ${y1 + 28}, ${x2} ${y2 - 22}, ${x2} ${y2}" fill="none" stroke="var(--depth-${l.depth % 5})" stroke-width="1.6" opacity=".75"/>`;
    }
    for (const n of nodes) {
      const cls = (n.leaf ? "leaf" : "label") + " d" + (n.depth % 5);
      const label = n.leaf ? n.text : n.label || "∅";
      svg += `<text id="${n.id}" class="tree-node ${cls}" data-start="${n.start}" data-end="${n.end}" x="${n.x + PAD}" y="${n.depth * LEVEL_H + PAD}" text-anchor="middle">${escapeHtml(label)}</text>`;
    }
    svg += "</svg>";
    this.treeArea.innerHTML = svg;

    this.treeArea.querySelectorAll<SVGTextElement>(".tree-node").forEach((el) => {
      el.addEventListener("click", () => {
        const s = +el.getAttribute("data-start")!;
        const e = +el.getAttribute("data-end")!;
        this.ta.focus();
        this.ta.setSelectionRange(s, e);
        this.update();
      });
    });

    const phraseCount = nodes.filter((n) => !n.leaf).length;
    const leafCount = nodes.filter((n) => n.leaf).length;
    this.treeBadge.textContent = `${phraseCount} ${phraseCount === 1 ? "node" : "nodes"} · ${leafCount} ${leafCount === 1 ? "leaf" : "leaves"}`;
  }

  private highlightActiveNode(): void {
    const caret = this.ta.selectionStart;
    let best: TreeSpan | null = null;
    for (const sp of this.treeSpans) {
      if (caret >= sp.start && caret <= sp.end) {
        if (!best || sp.end - sp.start < best.end - best.start) best = sp;
      }
    }
    this.treeArea.querySelectorAll(".tree-node.active").forEach((el) => el.classList.remove("active"));
    if (best) document.getElementById(best.id)?.classList.add("active");
  }

  // ---------- caret pixel position (for autocomplete) ----------

  private getCaretPixelPos(): { left: number; top: number } {
    const div = document.createElement("div");
    const style = getComputedStyle(this.ta);
    const props: (keyof CSSStyleDeclaration)[] = [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderLeftWidth",
      "boxSizing",
      "width",
    ];
    for (const p of props) (div.style as any)[p] = style[p];
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre";
    div.style.top = "0";
    div.style.left = "-9999px";
    div.textContent = this.ta.value.substring(0, this.ta.selectionStart);
    const span = document.createElement("span");
    span.textContent = ".";
    div.appendChild(span);
    document.body.appendChild(div);
    const left = span.offsetLeft;
    const top = span.offsetTop;
    const lineHeight = parseInt(style.lineHeight) || 20;
    document.body.removeChild(div);
    return { left: left - this.ta.scrollLeft, top: top - this.ta.scrollTop + lineHeight };
  }

  // ---------- autocomplete ----------

  private hideAutocomplete(): void {
    this.acOpen = false;
    this.acEl.hidden = true;
  }

  private refreshSel(): void {
    this.acEl.querySelectorAll(".ac-item").forEach((el, i) => el.classList.toggle("sel", i === this.acIndex));
  }

  private showAutocomplete(items: LabelOption[], s: number, pos: number): void {
    this.acOpen = true;
    this.acItems = items;
    this.acIndex = 0;
    this.acRange = [s, pos];
    const pix = this.getCaretPixelPos();
    this.acEl.style.left = pix.left + "px";
    this.acEl.style.top = pix.top + "px";
    this.acEl.innerHTML = items
      .map(
        (it, i) =>
          `<div class="ac-item${i === 0 ? " sel" : ""}" data-i="${i}"><span class="ac-label">${escapeHtml(it.key)}</span><span class="ac-desc">${escapeHtml(it.desc)}</span></div>`,
      )
      .join("");
    this.acEl.hidden = false;
    this.acEl.querySelectorAll<HTMLElement>(".ac-item").forEach((row) => {
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        this.chooseAutocomplete(+row.getAttribute("data-i")!);
      });
    });
  }

  private chooseAutocomplete(i: number): void {
    const it = this.acItems[i];
    const [s, pos] = this.acRange!;
    const val = this.ta.value;
    const newVal = val.slice(0, s) + it.key + val.slice(pos);
    this.hideAutocomplete();
    this.setValue(newVal, s + it.key.length);
    this.ta.focus();
  }

  private checkAutocomplete(): void {
    if (!AUTOCOMPLETE_ENABLED) return;
    if (this.ta.selectionStart !== this.ta.selectionEnd) {
      this.hideAutocomplete();
      return;
    }
    const text = this.ta.value;
    const pos = this.ta.selectionStart;
    let s = pos;
    while (s > 0 && /[A-Za-z]/.test(text[s - 1])) s--;
    if (s > 0 && text[s - 1] === "[") {
      const partial = text.slice(s, pos).toLowerCase();
      const items = LABELS.filter((l) => l.key.toLowerCase().startsWith(partial));
      if (items.length) {
        this.showAutocomplete(items, s, pos);
        return;
      }
    }
    this.hideAutocomplete();
  }

  private handleAutocompleteKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.acIndex = (this.acIndex + 1) % this.acItems.length;
      this.refreshSel();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.acIndex = (this.acIndex - 1 + this.acItems.length) % this.acItems.length;
      this.refreshSel();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      this.chooseAutocomplete(this.acIndex);
      this.advance(); // don't let confirming a suggestion swallow the keystroke
    } else if (e.key === "Escape") {
      this.hideAutocomplete();
    } else {
      this.acOpen = false;
    }
  }

  // ---------- indent helpers ----------

  private lineEndOf(value: string, pos: number): number {
    const idx = value.indexOf("\n", pos);
    return idx === -1 ? value.length : idx;
  }

  private computeDepthAt(text: string, pos: number): number {
    const seg = text.slice(0, pos);
    return (seg.match(/\[/g) || []).length - (seg.match(/\]/g) || []).length;
  }

  // Returns the end of the next line if the current and next line are both
  // blank (an empty slot to jump into); null otherwise.
  private nextBlankLineEnd(value: string, pos: number): number | null {
    const curEnd = this.lineEndOf(value, pos);
    if (!/^\s*$/.test(value.slice(pos, curEnd))) return null;
    if (curEnd >= value.length) return null;
    const nextEnd = this.lineEndOf(value, curEnd + 1);
    if (!/^\s*$/.test(value.slice(curEnd + 1, nextEnd))) return null;
    return nextEnd;
  }

  private indentSelection(outdent: boolean): void {
    const value = this.ta.value;
    const ss = this.ta.selectionStart;
    const se = this.ta.selectionEnd;
    const lineStart = value.lastIndexOf("\n", ss - 1) + 1;
    const lineEndSearch = value.indexOf("\n", se);
    const lineEnd = lineEndSearch === -1 ? value.length : lineEndSearch;
    const segment = value.slice(lineStart, lineEnd);
    const lines = segment.split("\n").map((l) => (outdent ? l.replace(/^ {1,4}/, "") : UNIT + l));
    const newSegment = lines.join("\n");
    const newVal = value.slice(0, lineStart) + newSegment + value.slice(lineEnd);
    this.setValue(newVal, lineStart, lineEnd + (newSegment.length - segment.length));
  }

  private outdentAtCursor(): void {
    const value = this.ta.value;
    const ss = this.ta.selectionStart;
    const lineStart = value.lastIndexOf("\n", ss - 1) + 1;
    const m = /^ {1,4}/.exec(value.slice(lineStart));
    if (m) this.setValue(value.slice(0, lineStart) + value.slice(lineStart + m[0].length), Math.max(lineStart, ss - m[0].length));
  }

  // Finishes the current slot: collapses it to one line if it's a plain
  // leaf, then opens a new sibling slot one level up.
  private advance(): void {
    const value = this.ta.value;
    const ss = this.ta.selectionStart;

    const jump = this.nextBlankLineEnd(value, ss);
    if (jump !== null) {
      this.ta.setSelectionRange(jump, jump);
      this.update();
      return;
    }

    const closeIdx = value.indexOf("]", ss);
    if (closeIdx === -1) {
      this.setValue(value.slice(0, ss) + UNIT + value.slice(ss), ss + UNIT.length);
      return;
    }

    const curEnd = this.lineEndOf(value, ss);
    const lineStart = value.lastIndexOf("\n", ss - 1) + 1;
    const trimmed = value.slice(lineStart, curEnd).trim();

    if (trimmed === "") {
      // this slot was never filled in — remove it instead of leaving a stray blank line
      const removeThrough = curEnd < value.length ? curEnd + 1 : curEnd;
      const withoutLine = value.slice(0, lineStart) + value.slice(removeThrough);
      const shiftedCloseIdx = closeIdx - (removeThrough - lineStart);
      const insAt = shiftedCloseIdx + 1;
      const depthRemoved = Math.max(0, this.computeDepthAt(withoutLine, insAt));
      const lineRemoved = "\n" + UNIT.repeat(depthRemoved);
      this.setValue(withoutLine.slice(0, insAt) + lineRemoved + withoutLine.slice(insAt), insAt + lineRemoved.length);
      return;
    }

    const labelLineEnd = lineStart - 1; // the "\n" right before this content line
    if (trimmed.charAt(0) !== "[" && labelLineEnd >= 0) {
      // the content turned out to be a leaf word, not a nested node —
      // collapse the label + content back onto one line, e.g. "[Det the]"
      const labelLineStart = value.lastIndexOf("\n", labelLineEnd - 1) + 1;
      const mLabel = /^(\s*)\[(.*)$/.exec(value.slice(labelLineStart, labelLineEnd));
      if (mLabel) {
        const collapsed = mLabel[1] + "[" + mLabel[2] + " " + trimmed + "]";
        const collapsedVal = value.slice(0, labelLineStart) + collapsed + value.slice(closeIdx + 1);
        const afterCollapsedClose = labelLineStart + collapsed.length;
        const depthCollapsed = Math.max(0, this.computeDepthAt(collapsedVal, afterCollapsedClose));
        const lineCollapsed = "\n" + UNIT.repeat(depthCollapsed);
        this.setValue(
          collapsedVal.slice(0, afterCollapsedClose) + lineCollapsed + collapsedVal.slice(afterCollapsedClose),
          afterCollapsedClose + lineCollapsed.length,
        );
        return;
      }
    }

    // already nested, or an irregular edit — just pop out past it as-is
    const afterClose = closeIdx + 1;
    const depthAfter = Math.max(0, this.computeDepthAt(value, afterClose));
    const newLine = "\n" + UNIT.repeat(depthAfter);
    this.setValue(value.slice(0, afterClose) + newLine + value.slice(afterClose), afterClose + newLine.length);
  }

  // Like advance()'s leaf-collapse step, but never deletes or adds a line —
  // used on blur, where nothing should type into a new slot afterward.
  private collapseLeafAtCursor(): void {
    const value = this.ta.value;
    const ss = this.ta.selectionStart;
    const se = this.ta.selectionEnd;
    if (ss !== se) return;
    const closeIdx = value.indexOf("]", ss);
    if (closeIdx === -1) return;
    const curEnd = this.lineEndOf(value, ss);
    const lineStart = value.lastIndexOf("\n", ss - 1) + 1;
    const trimmed = value.slice(lineStart, curEnd).trim();
    if (trimmed === "" || trimmed.charAt(0) === "[") return;
    const labelLineEnd = lineStart - 1;
    if (labelLineEnd < 0) return;
    const labelLineStart = value.lastIndexOf("\n", labelLineEnd - 1) + 1;
    const mLabel = /^(\s*)\[(.*)$/.exec(value.slice(labelLineStart, labelLineEnd));
    if (!mLabel) return;
    const collapsed = mLabel[1] + "[" + mLabel[2] + " " + trimmed + "]";
    const collapsedVal = value.slice(0, labelLineStart) + collapsed + value.slice(closeIdx + 1);
    this.setValue(collapsedVal, labelLineStart + collapsed.length);
  }

  // ---------- folding ----------

  private foldRange(start: number, end: number, label: string, preview: string): void {
    let value = this.ta.value;
    let newEnd = end;
    // Absorb any fold already inside this range first — a stash must hold
    // real text, never another fold's placeholder.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < this.folds.length; i++) {
        const inner = this.folds[i];
        if (inner.start >= start && inner.end <= newEnd) {
          value = value.slice(0, inner.start) + inner.original + value.slice(inner.end);
          newEnd += inner.original.length - (inner.end - inner.start);
          this.folds.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    const placeholder = "[" + label + (preview ? " " + preview : "") + "]";
    const original = value.slice(start, newEnd);
    this.folds.push({ start, end: start + placeholder.length, original });
    this.ta.value = value.slice(0, start) + placeholder + value.slice(newEnd);
    this.prevValue = this.ta.value;
    this.ta.focus();
    this.ta.setSelectionRange(start, start + placeholder.length);
    this.update();
  }

  private unfoldAt(idx: number): void {
    const f = this.folds[idx];
    if (!f) return;
    const value = this.ta.value;
    this.folds.splice(idx, 1);
    this.ta.value = value.slice(0, f.start) + f.original + value.slice(f.end);
    this.prevValue = this.ta.value;
    this.ta.focus();
    this.ta.setSelectionRange(f.start, f.start + f.original.length);
    this.update();
  }

  private collectFoldable(root: TreeNode, text: string): FoldableNode[] {
    const result: FoldableNode[] = [];
    const walk = (node: TreeNode): void => {
      if (isLeaf(node) || node.kind !== "phrase") return;
      if (lineOf(text, node.end) > lineOf(text, node.start)) {
        const words = collectWords(node);
        result.push({ start: node.start, end: node.end, label: node.label, preview: words.length ? buildPreview(words) : "…" });
      }
      for (const c of node.children) walk(c);
    };
    walk(root);
    return result;
  }

  // ---------- event wiring ----------

  private bindEvents(): void {
    this.ta.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.ta.addEventListener("input", () => this.update());
    this.ta.addEventListener("click", () => {
      // Clicking inside a fold's placeholder expands it.
      if (this.ta.selectionStart === this.ta.selectionEnd) {
        const pos = this.ta.selectionStart;
        for (let i = 0; i < this.folds.length; i++) {
          if (pos > this.folds[i].start && pos < this.folds[i].end) {
            this.unfoldAt(i);
            return;
          }
        }
      }
      this.update();
    });
    this.ta.addEventListener("keyup", (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) this.update();
    });
    this.ta.addEventListener("scroll", () => this.syncScroll());
    this.ta.addEventListener("blur", () => this.collapseLeafAtCursor());

    this.gutterEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".fold-btn");
      if (!btn) return;
      if (btn.hasAttribute("data-unfold")) this.unfoldAt(+btn.getAttribute("data-unfold")!);
      else if (btn.hasAttribute("data-fold-start"))
        this.foldRange(
          +btn.getAttribute("data-fold-start")!,
          +btn.getAttribute("data-fold-end")!,
          btn.getAttribute("data-label") || "",
          btn.getAttribute("data-preview") || "",
        );
    });
  }

  private syncScroll(): void {
    this.overlay.scrollTop = this.ta.scrollTop;
    this.overlay.scrollLeft = this.ta.scrollLeft;
    this.gutterEl.scrollTop = this.ta.scrollTop;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.acOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
      this.handleAutocompleteKey(e);
      return;
    }
    const value = this.ta.value;
    const ss = this.ta.selectionStart;
    const se = this.ta.selectionEnd;

    if (e.key === "Enter") {
      e.preventDefault();
      if (ss !== se) {
        const depthSel = Math.max(0, this.computeDepthAt(value, ss));
        const insSel = "\n" + UNIT.repeat(depthSel);
        this.setValue(value.slice(0, ss) + insSel + value.slice(se), ss + insSel.length);
        return;
      }
      this.advance();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (ss !== se) {
        this.indentSelection(e.shiftKey);
        return;
      }
      if (e.shiftKey) {
        this.outdentAtCursor();
        return;
      }
      this.advance();
      return;
    }

    if (e.key === "[") {
      e.preventDefault();
      if (ss !== se) {
        this.setValue(value.slice(0, ss) + "[" + value.slice(ss, se) + "]" + value.slice(se), ss + 1, se + 1);
        return;
      }
      const after = value.slice(se);
      const depth = Math.max(0, this.computeDepthAt(value, ss));
      const tail = after.length === 0 || after.charAt(0) === "\n" ? "" : "\n" + UNIT.repeat(depth);
      const skeleton = "[\n" + UNIT.repeat(depth + 1) + "\n" + UNIT.repeat(depth) + "]" + tail;
      this.setValue(value.slice(0, ss) + skeleton + after, ss + 1);
      return;
    }

    if (e.key === "]") {
      if (ss === se && value.charAt(ss) === "]") {
        e.preventDefault();
        this.ta.setSelectionRange(ss + 1, ss + 1);
        this.update();
        return;
      }
    }

    if (e.key === "Backspace") {
      if (ss === se && value.charAt(ss - 1) === "[") {
        const d = Math.max(0, this.computeDepthAt(value, ss - 1));
        const expectedTail = "\n" + UNIT.repeat(d + 1) + "\n" + UNIT.repeat(d) + "]";
        if (value.slice(ss, ss + expectedTail.length) === expectedTail) {
          e.preventDefault();
          this.setValue(value.slice(0, ss - 1) + value.slice(ss + expectedTail.length), ss - 1);
          return;
        }
      }
      if (ss === se && value.charAt(ss - 1) === "[" && value.charAt(ss) === "]") {
        e.preventDefault();
        this.setValue(value.slice(0, ss - 1) + value.slice(ss + 1), ss - 1);
      }
    }
  }
}
