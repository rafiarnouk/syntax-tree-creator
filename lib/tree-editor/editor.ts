import { buildFoldMap, mapNodeToRaw, remapFolds, validFolds } from "./fold-map";
import {
  buildPreview,
  collectWords,
  extractArrows,
  findEmptySlots,
  findEnclosingBracket,
  findMatchSet,
  formatTree,
  INDENT_UNIT,
  isArrowToken,
  isLeaf,
  isTriangleNode,
  labelEnd,
  parseTree,
  scanBrackets,
  stripQuotes,
  tokenize,
} from "./notation";
import { layout, LEVEL_H, NODE_GAP } from "./layout";
import { buildExportSvg } from "./svg-export";
import { bindThemeToggle } from "./theme";
import { TreeViewport } from "./viewport";
import type { MovementArrow } from "./notation";
import type { BracketScan, FoldableNode, FoldRecord, LabelOption, MatchSet, TreeNode } from "./types";
import { escapeHtml, lineOf } from "./utils";

const UNIT = INDENT_UNIT;
const DRAFT_KEY = "syntax-tree-creator-draft";
const FOLDS_KEY = "syntax-tree-creator-folds";
const STYLE_KEY = "syntax-tree-creator-style";
const REF_KEY = "syntax-tree-creator-reference";
const HIGHLIGHTS_KEY = "syntax-tree-creator-highlights";

type TreeStyle = "simple" | "fancy";

// Archived: the Simple/Fancy toggle is gone from the UI, so the tree always
// draws "simple". Flip this (and restore #styleToggle) to bring it back.
const FANCY_STYLE_ENABLED = false;

// Typed text gets checked against this as you go; a matching trigger right
// before the cursor is replaced with its symbol.
const SHORTCUTS: Record<string, string> = {
  "\\phi": "Φ",
};

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

// Disabled for now; showAutocomplete/chooseAutocomplete etc. stay in place.
const AUTOCOMPLETE_ENABLED = false;

const FORMAT_BTN_TITLE = "Reformat to the standard indentation (collapses leaves, expands everything else)";
const FORMAT_BTN_FOLDED_TITLE = "Auto-indent is disabled while a node is collapsed. Expand it first.";

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
  "[TP\n    [DP_1\n        [D The]\n        [NP dog]\n    ]\n    [T\n        [T might]\n        [VP\n            [V chase]\n            [DP_2\n                [D the]\n                [NP cat]\n            ]\n        ]\n    ]\n]";
const SAMPLE_SENTENCE = "The dog might chase the cat.";

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
  private treeLegendEl: HTMLElement;
  private acEl: HTMLElement;
  private styleToggleEl: HTMLElement | null;
  private themeToggleEl: HTMLElement;
  private refInput: HTMLInputElement;
  private viewport: TreeViewport;
  private exportPngBtn: HTMLButtonElement;
  private exportSvgBtn: HTMLButtonElement;
  private formatBtn: HTMLButtonElement;
  private highlightToggleBtn: HTMLButtonElement;

  private acOpen = false;
  private acItems: LabelOption[] = [];
  private acIndex = 0;
  private acRange: [number, number] | null = null;

  private treeSpans: TreeSpan[] = [];
  private treeNodeById = new Map<string, TreeNode>();
  private parentByTreeNode = new Map<TreeNode, TreeNode>();
  private idsByTreeNode = new Map<TreeNode, string[]>();
  private folds: FoldRecord[] = [];
  private prevValue = "";
  private treeStyle: TreeStyle = "simple";
  private highlightsEnabled = true;

  constructor(root: HTMLElement) {
    this.ta = root.querySelector<HTMLTextAreaElement>("#editor")!;
    this.overlay = root.querySelector<HTMLPreElement>("#overlay")!;
    this.gutterEl = root.querySelector<HTMLElement>("#gutter")!;
    this.statusEl = root.querySelector<HTMLElement>("#statusLine")!;
    this.charCountEl = root.querySelector<HTMLElement>("#charCount")!;
    this.treeArea = root.querySelector<HTMLElement>("#treeArea")!;
    this.treeBadge = root.querySelector<HTMLElement>("#treeBadge")!;
    this.treeLegendEl = root.querySelector<HTMLElement>("#treeLegend")!;
    this.acEl = root.querySelector<HTMLElement>("#autocomplete")!;
    this.styleToggleEl = root.querySelector<HTMLElement>("#styleToggle");
    this.themeToggleEl = root.querySelector<HTMLElement>("#themeToggle")!;
    this.refInput = root.querySelector<HTMLInputElement>("#refSentence")!;
    this.viewport = new TreeViewport(this.treeArea, {
      out: root.querySelector<HTMLButtonElement>("#zoomOutBtn")!,
      in: root.querySelector<HTMLButtonElement>("#zoomInBtn")!,
      reset: root.querySelector<HTMLButtonElement>("#zoomResetBtn")!,
      fit: root.querySelector<HTMLButtonElement>("#zoomFitBtn")!,
    });
    this.exportPngBtn = root.querySelector<HTMLButtonElement>("#exportPngBtn")!;
    this.exportSvgBtn = root.querySelector<HTMLButtonElement>("#exportSvgBtn")!;
    this.formatBtn = root.querySelector<HTMLButtonElement>("#formatBtn")!;
    this.highlightToggleBtn = root.querySelector<HTMLButtonElement>("#highlightToggleBtn")!;

    this.bindEvents();
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
    try {
      const savedStyle = localStorage.getItem(STYLE_KEY);
      if (FANCY_STYLE_ENABLED && (savedStyle === "simple" || savedStyle === "fancy")) this.treeStyle = savedStyle;
    } catch {
      /* private browsing / storage disabled */
    }
    try {
      this.refInput.value = localStorage.getItem(REF_KEY) || "";
    } catch {
      /* private browsing / storage disabled */
    }
    try {
      const savedHighlights = localStorage.getItem(HIGHLIGHTS_KEY);
      if (savedHighlights !== null) this.highlightsEnabled = savedHighlights !== "0";
    } catch {
      /* private browsing / storage disabled */
    }

    this.ta.value = saved || "";
    this.folds = validFolds(this.ta.value, this.folds);
    this.prevValue = this.ta.value;
    this.renderStyleToggle();
    bindThemeToggle(this.themeToggleEl);
    this.applyHighlightToggle();
    this.update();
    this.ta.setSelectionRange(this.ta.value.length, this.ta.value.length);
    // Tree layout measures text, so redo it once the web font is in.
    document.fonts?.ready.then(() => this.update());

    root.querySelector<HTMLButtonElement>("#resetBtn")!.addEventListener("click", () => {
      this.folds = [];
      this.setValue(SAMPLE, SAMPLE.length);
      this.refInput.value = SAMPLE_SENTENCE;
      try {
        localStorage.setItem(REF_KEY, SAMPLE_SENTENCE);
      } catch {
        /* private browsing / storage disabled */
      }
      this.ta.focus();
    });

    this.refInput.addEventListener("input", () => {
      try {
        localStorage.setItem(REF_KEY, this.refInput.value);
      } catch {
        /* private browsing / storage disabled */
      }
    });

    this.styleToggleEl?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".style-btn");
      const style = btn?.getAttribute("data-style");
      if (style !== "simple" && style !== "fancy") return;
      this.treeStyle = style;
      this.renderStyleToggle();
      try {
        localStorage.setItem(STYLE_KEY, style);
      } catch {
        /* private browsing / storage disabled */
      }
      this.update();
    });

    this.highlightToggleBtn.addEventListener("click", () => {
      this.highlightsEnabled = !this.highlightsEnabled;
      this.applyHighlightToggle();
      try {
        localStorage.setItem(HIGHLIGHTS_KEY, this.highlightsEnabled ? "1" : "0");
      } catch {
        /* private browsing / storage disabled */
      }
      this.highlightActiveNode();
    });
  }

  private applyHighlightToggle(): void {
    this.highlightToggleBtn.classList.toggle("off", !this.highlightsEnabled);
    this.highlightToggleBtn.setAttribute("aria-pressed", String(this.highlightsEnabled));
    this.highlightToggleBtn.title = this.highlightsEnabled ? "Disable node highlighting" : "Enable node highlighting";
  }

  private renderStyleToggle(): void {
    this.styleToggleEl?.querySelectorAll<HTMLButtonElement>(".style-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-style") === this.treeStyle);
    });
  }

  // ---------- core update loop ----------

  // Replaces a trigger ending right at the cursor (e.g. "\phi") with its symbol.
  private expandShortcuts(): void {
    if (this.ta.selectionStart !== this.ta.selectionEnd) return;
    const pos = this.ta.selectionStart;
    const value = this.ta.value;
    for (const trigger in SHORTCUTS) {
      if (pos >= trigger.length && value.slice(pos - trigger.length, pos) === trigger) {
        const replacement = SHORTCUTS[trigger];
        const newPos = pos - trigger.length + replacement.length;
        this.ta.value = value.slice(0, pos - trigger.length) + replacement + value.slice(pos);
        this.ta.setSelectionRange(newPos, newPos);
        return;
      }
    }
  }

  private update(): void {
    this.expandShortcuts();
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
        'Press <kbd>[</kbd> in the editor to start a node. A <b>label</b> slot and a <b>content</b> slot will appear for you to fill in.',
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

    for (const t of tokenize(text)) {
      if (t.type !== "word" || !isArrowToken(t.text)) continue;
      pieces[t.start] = '<span class="arrow-tok">' + pieces[t.start];
      pieces[t.end - 1] += "</span>";
    }

    // One vertical guide per complete indent unit in a line's leading whitespace,
    // marked on that unit's first space so it lines up with the content below it.
    let lineStart = 0;
    for (let i = 0; i <= text.length; i++) {
      if (i === text.length || text[i] === "\n") {
        const leading = /^ */.exec(text.slice(lineStart, i))![0].length;
        const depth = Math.floor(leading / UNIT.length);
        for (let lvl = 1; lvl <= depth; lvl++) {
          const pos = lineStart + (lvl - 1) * UNIT.length;
          pieces[pos] = `<span class="indent-guide">${pieces[pos]}</span>`;
        }
        lineStart = i + 1;
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
        btn = `<button type="button" class="fold-btn" data-fold-start="${foldable0.start}" data-fold-end="${foldable0.end}" title="Collapse this node">▾</button>`;
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
    this.viewport.clear();
    this.treeBadge.textContent = "";
    this.treeSpans = [];
    this.exportPngBtn.disabled = true;
    this.exportSvgBtn.disabled = true;
    this.formatBtn.disabled = true;
  }

  private renderTreeView(parsed: TreeNode, map: ReturnType<typeof buildFoldMap>["map"]): void {
    this.exportPngBtn.disabled = false;
    this.exportSvgBtn.disabled = false;
    this.formatBtn.disabled = this.folds.length > 0;
    this.formatBtn.title = this.folds.length > 0 ? FORMAT_BTN_FOLDED_TITLE : FORMAT_BTN_TITLE;
    const { tree: root, arrows } = extractArrows(parsed);
    const treeW = layout(root);
    this.treeSpans = [];
    this.treeNodeById = new Map();
    this.parentByTreeNode = new Map();
    this.idsByTreeNode = new Map();
    const addId = (node: TreeNode, id: string) => {
      this.treeNodeById.set(id, node);
      const ids = this.idsByTreeNode.get(node) ?? [];
      ids.push(id);
      this.idsByTreeNode.set(node, ids);
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
      const leaf = isLeaf(node) && !triangle;
      if (leaf) terminals.push({ x, depth, at: node.start });
      if (parent) {
        lines.push({ x1: parent.x ?? 0, y1: parent.depth ?? 0, x2: x, y2: depth, depth });
        this.parentByTreeNode.set(node, parent);
      }
      const id = "n" + this.treeSpans.length;
      const raw = mapNodeToRaw(node, map);
      this.treeSpans.push({ start: raw.start, end: raw.end, id });
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
        const rawSpan = mapNodeToRaw({ ...first, end: last.end }, map);
        const tid = "n" + this.treeSpans.length;
        this.treeSpans.push({ start: rawSpan.start, end: rawSpan.end, id: tid });
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
    const arrowSvg = this.renderArrows(arrows, terminals, PAD);
    const h = Math.max((maxDepth + 1) * LEVEL_H + PAD * 1.4, arrowSvg.bottom + PAD * 0.6);
    const simple = this.treeStyle === "simple";
    const zoom = this.viewport.scale;

    let svg = `<svg class="tree-svg" viewBox="0 0 ${w} ${h}" width="${w * zoom}" height="${h * zoom}">`;
    for (const l of lines) {
      const x1 = l.x1 + PAD;
      const y1 = l.y1 * LEVEL_H + PAD + NODE_GAP;
      const x2 = l.x2 + PAD;
      const y2 = l.y2 * LEVEL_H + PAD - NODE_GAP;
      if (simple) {
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--tree-line)" stroke-width="1"/>`;
      } else {
        svg += `<path d="M ${x1} ${y1} C ${x1} ${y1 + 28}, ${x2} ${y2 - 22}, ${x2} ${y2}" fill="none" stroke="var(--depth-${l.depth % 5})" stroke-width="1.6" opacity=".75"/>`;
      }
    }
    for (const t of triangles) {
      const apexX = t.x + PAD;
      const apexY = t.apexDepth * LEVEL_H + PAD + NODE_GAP;
      const baseY = t.baseDepth * LEVEL_H + PAD - NODE_GAP;
      const baseX1 = t.x + PAD - t.halfWidth;
      const baseX2 = t.x + PAD + t.halfWidth;
      const stroke = simple ? "var(--tree-line)" : `var(--depth-${t.depth % 5})`;
      svg += `<polygon points="${apexX},${apexY} ${baseX1},${baseY} ${baseX2},${baseY}" fill="none" stroke="${stroke}" stroke-width="${simple ? 1 : 1.6}"${simple ? "" : ' opacity=".75"'}/>`;
    }
    for (const n of nodes) {
      const colorCls = simple ? (n.leaf ? "simple-leaf" : "simple-node") : "d" + (n.depth % 5);
      const cls = (n.leaf ? "leaf" : "label") + " " + colorCls;
      const labelMarkup = n.leaf ? escapeHtml(n.text) : this.renderLabelMarkup(n.label || "∅");
      svg += `<text id="${n.id}" class="tree-node ${cls}" data-start="${n.start}" data-end="${n.end}" x="${n.x + PAD}" y="${n.depth * LEVEL_H + PAD}" text-anchor="middle" dominant-baseline="central">${labelMarkup}</text>`;
    }
    svg += arrowSvg.markup + "</svg>";
    this.treeArea.innerHTML = svg;
    this.viewport.show(this.treeArea.querySelector<SVGSVGElement>("svg.tree-svg")!, w, h);

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

  // Each arrow dips below the lowest word it spans; arrows that overlap a
  // shorter one already drawn go below that one too.
  private renderArrows(
    arrows: MovementArrow[],
    terminals: { x: number; depth: number; at: number }[],
    pad: number,
  ): { markup: string; bottom: number } {
    const DIP = 22;
    const STACK = 12;
    const HEAD = 7;
    const wordBottom = (i: number) => terminals[i].depth * LEVEL_H + pad + NODE_GAP;

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

    const placed: { lo: number; hi: number; bottom: number }[] = [];
    let markup = "";
    let maxBottom = 0;
    for (const s of spans) {
      const lo = Math.min(s.from, s.to);
      const hi = Math.max(s.from, s.to);
      let bottom = 0;
      for (let i = lo; i <= hi; i++) bottom = Math.max(bottom, wordBottom(i) + DIP);
      for (const p of placed) if (p.lo <= hi && lo <= p.hi) bottom = Math.max(bottom, p.bottom + STACK);
      placed.push({ lo, hi, bottom });
      maxBottom = Math.max(maxBottom, bottom);

      const headAtFrom = s.head !== "to";
      const headAtTo = s.head !== "from";
      const x1 = terminals[s.from].x + pad;
      const x2 = terminals[s.to].x + pad;
      const tip1 = wordBottom(s.from);
      const tip2 = wordBottom(s.to);
      const y1 = tip1 + (headAtFrom ? HEAD : 0);
      const y2 = tip2 + (headAtTo ? HEAD : 0);
      // A cubic with both control points at c bottoms out at (y1 + y2) / 8 + 0.75c.
      const c = (bottom - (y1 + y2) / 8) / 0.75;
      markup += `<path class="tree-arrow" d="M ${x1} ${y1} C ${x1} ${c}, ${x2} ${c}, ${x2} ${y2}" fill="none" stroke="var(--tree-arrow)" stroke-width="1.2"/>`;
      const head = (x: number, tip: number) =>
        `<polygon class="tree-arrow" points="${x},${tip} ${x - HEAD / 2},${tip + HEAD} ${x + HEAD / 2},${tip + HEAD}" fill="var(--tree-arrow)" stroke="none"/>`;
      if (headAtFrom) markup += head(x1, tip1);
      if (headAtTo) markup += head(x2, tip2);
    }
    return { markup, bottom: maxBottom };
  }

  private renderLabelMarkup(label: string): string {
    const m = /^(.+)_([^_\s]+)$/.exec(label);
    if (!m) return escapeHtml(label);
    return `${escapeHtml(m[1])}<tspan dy="0.28em" font-size="0.72em">${escapeHtml(m[2])}</tspan>`;
  }

  // All nodes a sister of `node` dominates (plus the sisters themselves) —
  // the standard c-command relation, since every node's parent here is the
  // "first branching node" that dominates it.
  private cCommanded(node: TreeNode): Set<TreeNode> {
    const result = new Set<TreeNode>();
    const parent = this.parentByTreeNode.get(node);
    if (!parent || parent.kind !== "phrase") return result;
    const collect = (n: TreeNode): void => {
      result.add(n);
      if (n.kind === "phrase") for (const c of n.children) collect(c);
    };
    for (const sibling of parent.children) {
      if (sibling !== node) collect(sibling);
    }
    return result;
  }

  private dominated(node: TreeNode): Set<TreeNode> {
    const result = new Set<TreeNode>();
    const collect = (n: TreeNode): void => {
      if (n.kind !== "phrase") return;
      for (const c of n.children) {
        result.add(c);
        collect(c);
      }
    };
    collect(node);
    return result;
  }

  private addHighlightRect(svg: SVGSVGElement, el: SVGGraphicsElement, cls: string): void {
    const box = el.getBBox();
    const PAD_X = 6;
    const PAD_Y = 0;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", cls);
    rect.setAttribute("x", String(box.x - PAD_X));
    rect.setAttribute("y", String(box.y - PAD_Y));
    rect.setAttribute("width", String(box.width + PAD_X * 2));
    rect.setAttribute("height", String(box.height + PAD_Y * 2));
    rect.setAttribute("rx", "4");
    svg.insertBefore(rect, svg.firstChild);
  }

  private clearActiveHighlight(): void {
    this.treeArea
      .querySelectorAll(".tree-node.active, .tree-node.c-command, .tree-node.dominated")
      .forEach((el) => el.classList.remove("active", "c-command", "dominated"));
    this.treeArea
      .querySelectorAll(".tree-node-highlight, .tree-c-command-highlight, .tree-dominance-highlight")
      .forEach((el) => el.remove());
    this.treeLegendEl.hidden = true;
  }

  private highlightActiveNode(): void {
    this.clearActiveHighlight();
    if (!this.highlightsEnabled) return;
    if (document.activeElement !== this.ta) return;
    const caret = this.ta.selectionStart;
    let best: TreeSpan | null = null;
    for (const sp of this.treeSpans) {
      if (caret >= sp.start && caret <= sp.end) {
        if (!best || sp.end - sp.start < best.end - best.start) best = sp;
      }
    }
    if (!best) return;
    const el = document.getElementById(best.id);
    const svg = this.treeArea.querySelector<SVGSVGElement>("svg.tree-svg");
    if (!el || !svg || !(el instanceof SVGGraphicsElement)) return;
    el.classList.add("active");
    this.addHighlightRect(svg, el, "tree-node-highlight");
    this.treeLegendEl.hidden = false;

    const activeNode = this.treeNodeById.get(best.id);
    if (!activeNode) return;
    for (const commanded of this.cCommanded(activeNode)) {
      for (const id of this.idsByTreeNode.get(commanded) ?? []) {
        const cEl = document.getElementById(id);
        if (cEl instanceof SVGGraphicsElement) {
          cEl.classList.add("c-command");
          this.addHighlightRect(svg, cEl, "tree-c-command-highlight");
        }
      }
    }
    for (const dom of this.dominated(activeNode)) {
      for (const id of this.idsByTreeNode.get(dom) ?? []) {
        const dEl = document.getElementById(id);
        if (dEl instanceof SVGGraphicsElement) {
          dEl.classList.add("dominated");
          this.addHighlightRect(svg, dEl, "tree-dominance-highlight");
        }
      }
    }
  }

  // ---------- caret pixel position (for autocomplete) ----------

  private getCaretPixelPos(): { left: number; top: number } {
    const div = document.createElement("div");
    const style = getComputedStyle(this.ta) as unknown as Record<string, string>;
    const props = [
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
    const divStyle = div.style as unknown as Record<string, string>;
    for (const p of props) divStyle[p] = style[p];
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

  // Inserts a plain newline at `pos`, indented to match — the same thing any
  // text editor's Enter key would do. This is the fallback whenever the
  // cursor isn't somewhere the guided flow recognizes, so editing in the
  // middle of an existing tree is predictable instead of jumping somewhere
  // unrelated.
  private insertPlainNewline(value: string, pos: number): void {
    const depth = Math.max(0, this.computeDepthAt(value, pos));
    const ins = "\n" + UNIT.repeat(depth);
    this.setValue(value.slice(0, pos) + ins + value.slice(pos), pos + ins.length);
  }

  // If the node enclosing `pos` has no sub-brackets in it (blank, or a
  // plain — possibly multi-word — leaf), collapses it onto one line, e.g.
  // "[Det\n    the\n]" -> "[Det the]", "[VP\n    \n]" -> "[VP]". Returns the
  // new value and the offset right after the collapsed node's "]", or null
  // if this node already has nested structure (nothing to collapse).
  private collapseSimpleLeaf(value: string, enclosing: { openIdx: number; closeIdx: number }): { value: string; afterClose: number } | null {
    const lEnd = labelEnd(value, enclosing.openIdx);
    const inner = value.slice(lEnd, enclosing.closeIdx);
    if (inner.includes("[")) return null;
    const opening = value.slice(enclosing.openIdx, lEnd);
    const trimmedInner = inner.trim();
    const collapsed = trimmedInner ? opening + " " + trimmedInner + "]" : opening + "]";
    const newVal = value.slice(0, enclosing.openIdx) + collapsed + value.slice(enclosing.closeIdx + 1);
    return { value: newVal, afterClose: enclosing.openIdx + collapsed.length };
  }

  // Jumps into an existing empty slot — either a blank line already sitting
  // below a label (the fresh top-down case), or a node that's already
  // collapsed to one line with nothing in it, e.g. "[VP]", which gets
  // re-expanded into a fresh content line. Returns false (and does nothing)
  // when there's no such slot at the cursor, so callers can fall back to
  // their own behavior instead of this silently being a no-op.
  private enterBlankSlot(): boolean {
    if (this.ta.selectionStart !== this.ta.selectionEnd) return false;
    const value = this.ta.value;
    const pos = this.ta.selectionStart;

    const jump = this.nextBlankLineEnd(value, pos);
    if (jump !== null) {
      this.ta.setSelectionRange(jump, jump);
      this.update();
      return true;
    }

    const scan = scanBrackets(value);
    if (!scan.balanced) return false;
    const enclosing = findEnclosingBracket(scan, pos);
    if (!enclosing) return false;

    const lEnd = labelEnd(value, enclosing.openIdx);
    const inner = value.slice(lEnd, enclosing.closeIdx);
    if (inner.includes("\n") || inner.trim() !== "") return false; // not a collapsed empty node

    const depth = Math.max(0, this.computeDepthAt(value, enclosing.openIdx));
    const opening = value.slice(enclosing.openIdx, lEnd);
    const skeleton = opening + "\n" + UNIT.repeat(depth + 1) + "\n" + UNIT.repeat(depth) + "]";
    const newVal = value.slice(0, enclosing.openIdx) + skeleton + value.slice(enclosing.closeIdx + 1);
    const contentPos = enclosing.openIdx + opening.length + 1 + UNIT.repeat(depth + 1).length;
    this.setValue(newVal, contentPos);
    return true;
  }

  // Finishes whatever's at the cursor and moves on, the way Tab/Enter are
  // expected to. What "finishing" means depends on where the cursor
  // actually is, found via real bracket matching rather than assumptions
  // about nearby lines:
  //  - an empty or already-typed slot -> enterBlankSlot() jumps into it
  //  - end of a node with no children yet (blank, or one plain leaf word)
  //    -> collapse it to one line and open a new sibling slot after it
  //  - end of a node that already has children -> open a new child slot
  //    inside it, so you can go back and add another branch later
  //  - anywhere else (mid-word, between existing siblings, ...) -> just
  //    insert a newline at the cursor, like a normal text editor would
  private advance(): void {
    if (this.enterBlankSlot()) return;

    const value = this.ta.value;
    const pos = this.ta.selectionStart;
    const scan = scanBrackets(value);
    if (!scan.balanced) {
      this.insertPlainNewline(value, pos);
      return;
    }

    const enclosing = findEnclosingBracket(scan, pos);
    if (!enclosing) {
      this.insertPlainNewline(value, pos);
      return;
    }

    const tail = value.slice(pos, enclosing.closeIdx);
    if (tail.trim() !== "") {
      // cursor isn't at the end of this node's content — a normal, local edit
      this.insertPlainNewline(value, pos);
      return;
    }

    const lEnd = labelEnd(value, enclosing.openIdx);
    const inner = value.slice(lEnd, enclosing.closeIdx);

    if (!inner.includes("[")) {
      // blank, or a single (possibly multi-word) leaf — finish/tidy it, then
      // open a sibling slot for this node's parent
      const collapsed = this.collapseSimpleLeaf(value, enclosing)!;
      this.placeSiblingSlot(collapsed.value, collapsed.afterClose);
      return;
    }

    // this node already has children — offer a new child slot inside it,
    // right before its closing bracket, so another branch can be added
    const closeLineStart = value.lastIndexOf("\n", enclosing.closeIdx - 1) + 1;
    const closeLine = value.slice(closeLineStart, this.lineEndOf(value, closeLineStart));
    if (/^\s*\]/.test(closeLine)) {
      // reuse an already-blank line right before the closing bracket, if
      // there is one, instead of adding a redundant second one — unless the
      // cursor is already sitting in that empty slot, meaning there's
      // nothing to fill in and advance() was pressed again: drop the slot
      // and open a sibling for this node's own parent instead, so an
      // unused trailing child slot can't trap the cursor one level too deep
      const prevLineEnd = Math.max(0, closeLineStart - 1);
      const prevLineStart = value.lastIndexOf("\n", prevLineEnd - 1) + 1;
      if (closeLineStart > 0 && value.slice(prevLineStart, prevLineEnd).trim() === "") {
        if (pos >= prevLineStart && pos <= prevLineEnd) {
          const removed = closeLineStart - prevLineStart;
          const newVal = value.slice(0, prevLineStart) + value.slice(closeLineStart);
          this.placeSiblingSlot(newVal, enclosing.closeIdx - removed + 1);
          return;
        }
        this.setValue(value, prevLineEnd);
        return;
      }
      const childDepth = Math.max(0, this.computeDepthAt(value, enclosing.closeIdx));
      const insertion = UNIT.repeat(childDepth) + "\n";
      this.setValue(value.slice(0, closeLineStart) + insertion + value.slice(closeLineStart), closeLineStart + UNIT.repeat(childDepth).length);
      return;
    }
    // closing bracket isn't on its own line (irregular/manually-edited structure) — stay predictable
    this.insertPlainNewline(value, pos);
  }

  // After finishing a node, decide where "the next slot" is: reuse a blank
  // line if one's already sitting right there (e.g. from resuming an
  // earlier node), skip past an existing sibling if one already follows, or
  // open a fresh slot if this was the last child so far.
  private placeSiblingSlot(value: string, afterClose: number): void {
    const reuse = this.nextBlankLineEnd(value, afterClose);
    if (reuse !== null) {
      this.setValue(value, reuse);
      return;
    }
    const nextLineStart = value.charAt(afterClose) === "\n" ? afterClose + 1 : afterClose;
    const nextLineEnd = this.lineEndOf(value, nextLineStart);
    const nextLine = value.slice(nextLineStart, nextLineEnd);
    if (nextLineStart < value.length && nextLine.trim() !== "" && !/^\s*\]/.test(nextLine)) {
      // a sibling already sits right here — nothing to insert, just move on
      this.setValue(value, nextLineStart);
      return;
    }
    const depth = Math.max(0, this.computeDepthAt(value, afterClose));
    const newLine = "\n" + UNIT.repeat(depth);
    this.setValue(value.slice(0, afterClose) + newLine + value.slice(afterClose), afterClose + newLine.length);
  }

  // Tidies a finished leaf onto one line without deleting or adding a line —
  // used on blur, where nothing's about to type into a new slot afterward.
  private collapseLeafAtCursor(): void {
    if (this.ta.selectionStart !== this.ta.selectionEnd) return;
    const value = this.ta.value;
    const pos = this.ta.selectionStart;
    const scan = scanBrackets(value);
    if (!scan.balanced) return;
    const enclosing = findEnclosingBracket(scan, pos);
    if (!enclosing) return;
    if (value.slice(pos, enclosing.closeIdx).trim() !== "") return; // not at the end of this node's content

    const lEnd = labelEnd(value, enclosing.openIdx);
    if (!value.slice(lEnd, enclosing.closeIdx).trim()) return; // blank — leave it for advance() to handle
    const collapsed = this.collapseSimpleLeaf(value, enclosing);
    if (collapsed) this.setValue(collapsed.value, collapsed.afterClose);
  }

  // ---------- folding ----------
  // A fold swaps a node's text for a one-line placeholder, e.g.
  // "[NP the … dog]", and keeps the real text in its record. Folds never
  // nest: folding around one expands it first.

  // Replaces raw text [start, end), shifting every fold after it and
  // dropping any inside it.
  private spliceRaw(start: number, end: number, text: string): void {
    const delta = text.length - (end - start);
    this.folds = this.folds
      .filter((f) => f.end <= start || f.start >= end)
      .map((f) => (f.start >= end ? { ...f, start: f.start + delta, end: f.end + delta } : f));
    const value = this.ta.value;
    this.ta.value = value.slice(0, start) + text + value.slice(end);
    this.prevValue = this.ta.value;
  }

  // Runs a fold/unfold of raw [start, end) without moving the view: the
  // caret keeps its place (or goes to `start` if it was inside), and so
  // does the scroll position.
  private withFoldEdit(start: number, end: number, edit: () => void): void {
    const caret = this.ta.selectionStart;
    const scrollTop = this.ta.scrollTop;
    const lengthBefore = this.ta.value.length;
    edit();
    const delta = this.ta.value.length - lengthBefore;
    const next = caret <= start ? caret : caret >= end ? caret + delta : start;
    this.ta.focus({ preventScroll: true });
    this.ta.setSelectionRange(next, next);
    this.update();
    this.ta.scrollTop = scrollTop;
    this.syncScroll();
  }

  private foldRange(start: number, end: number): void {
    this.withFoldEdit(start, end, () => {
      let newEnd = end;
      const inner = this.folds.filter((f) => f.start >= start && f.end <= end).sort((a, b) => b.start - a.start);
      for (const f of inner) {
        this.spliceRaw(f.start, f.end, f.original);
        newEnd += f.original.length - (f.end - f.start);
      }
      const original = this.ta.value.slice(start, newEnd);
      const node = parseTree(tokenize(original));
      const label = node?.kind === "phrase" ? node.label : "";
      const words = node ? collectWords(node) : [];
      const placeholder = "[" + label + " " + (words.length ? buildPreview(words) : "…") + "]";
      this.spliceRaw(start, newEnd, placeholder);
      this.folds.push({ start, end: start + placeholder.length, original });
    });
  }

  private unfoldAt(idx: number): void {
    const f = this.folds[idx];
    if (!f) return;
    this.withFoldEdit(f.start, f.end, () => this.spliceRaw(f.start, f.end, f.original));
  }

  private foldAt(pos: number): FoldRecord | undefined {
    return this.folds.find((f) => pos > f.start && pos < f.end);
  }

  // Keyboard caret moves hop over a placeholder as if it were one
  // character, in the direction they were going.
  private snapOutOfFolds(prevStart: number, prevEnd: number): void {
    const hop = (p: number, prev: number): number => {
      const f = this.foldAt(p);
      if (!f) return p;
      if (p > prev) return f.end;
      if (p < prev) return f.start;
      return p - f.start < f.end - p ? f.start : f.end;
    };
    const { selectionStart: s, selectionEnd: e, selectionDirection: dir } = this.ta;
    const ns = hop(s, prevStart);
    const ne = s === e ? ns : hop(e, prevEnd);
    if (ns === s && ne === e) return;
    this.ta.setSelectionRange(Math.min(ns, ne), Math.max(ns, ne), dir);
    this.update();
  }

  // A mouse selection that ends partway into a placeholder grows to cover it.
  private coverFolds(): void {
    const { selectionStart: s, selectionEnd: e, selectionDirection: dir } = this.ta;
    if (s === e) return;
    const ns = this.foldAt(s)?.start ?? s;
    const ne = this.foldAt(e)?.end ?? e;
    if (ns !== s || ne !== e) this.ta.setSelectionRange(ns, ne, dir);
  }

  // An edit that would cut into a placeholder selects the whole collapsed
  // node instead, so it can only be deleted or replaced as a unit.
  private guardFolds(e: InputEvent): void {
    if (!this.folds.length || e.inputType.startsWith("history")) return;
    let s = this.ta.selectionStart;
    let end = this.ta.selectionEnd;
    if (s === end && e.inputType.startsWith("delete")) {
      if (e.inputType.includes("Backward")) s = Math.max(0, s - 1);
      else end += 1;
    }
    const cuts = (f: FoldRecord) =>
      s === end ? s > f.start && s < f.end : s < f.end && end > f.start && (s > f.start || end < f.end);
    const hit = this.folds.find(cuts);
    if (!hit) return;
    e.preventDefault();
    this.ta.setSelectionRange(Math.min(this.ta.selectionStart, hit.start), Math.max(this.ta.selectionEnd, hit.end));
    this.update();
  }

  // Copying a collapsed node copies what it hides, not its placeholder.
  private copyExpanded(e: ClipboardEvent, cut: boolean): void {
    const s = this.ta.selectionStart;
    const end = this.ta.selectionEnd;
    const inside = this.folds.filter((f) => f.start >= s && f.end <= end).map((f) => ({ ...f, start: f.start - s, end: f.end - s }));
    if (!inside.length || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", buildFoldMap(this.ta.value.slice(s, end), inside).text);
    if (!cut) return;
    this.spliceRaw(s, end, "");
    this.ta.setSelectionRange(s, s);
    this.update();
  }

  private collectFoldable(root: TreeNode, text: string): FoldableNode[] {
    const result: FoldableNode[] = [];
    const walk = (node: TreeNode): void => {
      if (isLeaf(node) || node.kind !== "phrase") return;
      if (lineOf(text, node.end) > lineOf(text, node.start)) result.push({ start: node.start, end: node.end });
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
    this.ta.addEventListener("beforeinput", (e) => this.guardFolds(e));
    this.ta.addEventListener("copy", (e) => this.copyExpanded(e, false));
    this.ta.addEventListener("cut", (e) => this.copyExpanded(e, true));
    this.ta.addEventListener("mouseup", () => this.coverFolds());
    this.ta.addEventListener("keyup", (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) this.update();
    });
    this.ta.addEventListener("scroll", () => this.syncScroll());
    this.ta.addEventListener("blur", () => {
      this.collapseLeafAtCursor();
      this.clearActiveHighlight();
    });

    // Keeps the editor focused: a blur would tidy the current leaf, shifting
    // the offsets these buttons were rendered with.
    this.gutterEl.addEventListener("mousedown", (e) => e.preventDefault());
    this.gutterEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".fold-btn");
      if (!btn) return;
      if (btn.hasAttribute("data-unfold")) this.unfoldAt(+btn.getAttribute("data-unfold")!);
      else if (btn.hasAttribute("data-fold-start")) this.foldRange(+btn.getAttribute("data-fold-start")!, +btn.getAttribute("data-fold-end")!);
    });

    this.exportPngBtn.addEventListener("click", () => this.exportPng());
    this.exportSvgBtn.addEventListener("click", () => this.exportSvg());
    this.formatBtn.addEventListener("click", () => this.formatDocument());
  }

  // ---------- export ----------

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private async exportSvg(): Promise<void> {
    const live = this.treeArea.querySelector<SVGSVGElement>(".tree-svg");
    if (!live) return;
    const svg = await buildExportSvg(live);
    const markup = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    this.triggerDownload(new Blob([markup], { type: "image/svg+xml" }), "syntax-tree.svg");
  }

  private async exportPng(): Promise<void> {
    const live = this.treeArea.querySelector<SVGSVGElement>(".tree-svg");
    if (!live) return;
    const svg = await buildExportSvg(live);
    const w = parseFloat(svg.getAttribute("width") || "0");
    const h = parseFloat(svg.getAttribute("height") || "0");
    if (!w || !h) return;
    const SCALE = 2; // supersample for a crisper raster export
    const markup = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * SCALE;
      canvas.height = h * SCALE;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) this.triggerDownload(blob, "syntax-tree.png");
          URL.revokeObjectURL(url);
        }, "image/png");
      } else {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // Reparses the whole document and rewrites it in the editor's own
  // canonical shape — useful after pasting in something messy. Fold state
  // can't survive a full rewrite (every offset changes), so it's cleared.
  private formatDocument(): void {
    if (this.folds.length > 0) return;
    const value = this.ta.value;
    const scan = scanBrackets(value);
    if (!scan.balanced) return;
    const tree = parseTree(tokenize(value));
    if (!tree) return;
    this.folds = [];
    const formatted = formatTree(tree);
    this.setValue(formatted, formatted.length);
  }

  private syncScroll(): void {
    this.overlay.scrollTop = this.ta.scrollTop;
    this.overlay.scrollLeft = this.ta.scrollLeft;
    this.gutterEl.scrollTop = this.ta.scrollTop;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.folds.length && NAV_KEYS.has(e.key)) {
      const { selectionStart, selectionEnd } = this.ta;
      setTimeout(() => this.snapOutOfFolds(selectionStart, selectionEnd));
    }
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

    if (e.key === " " && ss === se) {
      // Only jumps into an existing empty slot (e.g. "NP" + space lands in
      // its content). Unlike Tab/Enter it never collapses/pops out a filled
      // slot — space has to stay a normal character or multi-word leaf
      // content like "the dog" couldn't be typed.
      if (this.enterBlankSlot()) {
        e.preventDefault();
        return;
      }
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
