// Bottom-up tree builder: a tray of leaf/node chips, merged by picking two
// neighboring chips and typing a label. The tree below is a pure, view-only
// mirror of the same forest — no edits happen there. A vanilla DOM
// controller, same architectural pattern as TreeEditor (see the "Why
// TreeEditor isn't a React component" note in README.md).

import { THEME_KEY } from "./editor";
import { layoutForest } from "./merge-layout";
import { buildPreview, collectWords, isLeaf, isTriangleNode, stripQuotes } from "./notation";
import type { LeafNode, PhraseNode, TreeNode } from "./types";
import { escapeHtml } from "./utils";

type ThemeChoice = "light" | "dark";
type TreeStyle = "simple" | "fancy";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;

const SAMPLE_SENTENCE = "The dog might chase the cat.";
const SAMPLE_WORDS: { label: string; content: string }[] = [
  { label: "D", content: "The" },
  { label: "N", content: "dog" },
  { label: "T", content: "might" },
  { label: "V", content: "chase" },
  { label: "D", content: "the" },
  { label: "N", content: "cat" },
];

// A plain six-dot grip, inlined rather than imported from components/icons.tsx
// since this chip markup is built as an HTML string, not JSX.
const GRIP_SVG =
  '<svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor" aria-hidden="true">' +
  '<circle cx="1.5" cy="1.5" r="1.3"/><circle cx="7.5" cy="1.5" r="1.3"/>' +
  '<circle cx="1.5" cy="6.5" r="1.3"/><circle cx="7.5" cy="6.5" r="1.3"/>' +
  '<circle cx="1.5" cy="11.5" r="1.3"/><circle cx="7.5" cy="11.5" r="1.3"/></svg>';

export class MergeBuilder {
  private themeToggleEl: HTMLElement;
  private resetBtn: HTMLButtonElement;
  private refInput: HTMLInputElement;
  private splitBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private trayBadge: HTMLElement;
  private tray: HTMLElement;
  private mergeBar: HTMLElement;
  private zoomOutBtn: HTMLButtonElement;
  private zoomInBtn: HTMLButtonElement;
  private zoomResetBtn: HTMLButtonElement;
  private zoomFitBtn: HTMLButtonElement;
  private exportPngBtn: HTMLButtonElement;
  private exportSvgBtn: HTMLButtonElement;
  private treeBadge: HTMLElement;
  private treeLegendEl: HTMLElement;
  private canvas: HTMLElement;

  private theme: ThemeChoice = "light";
  private treeStyle: TreeStyle = "simple";
  private zoom = 1;
  private fitRequested = false;

  // Every entry is either a basic leaf — a phrase with exactly one leaf
  // child, e.g. [D the] — or the result of a merge, with exactly two
  // children. That shape alone distinguishes "still editable" from
  // "merged, unlink to take apart" — no separate flag needed.
  private forest: TreeNode[] = [];
  private picked: number[] = [];
  private dragSrcIdx: number | null = null;

  private nodeById = new Map<string, TreeNode>();
  private idsByNode = new Map<TreeNode, string[]>();
  private parentByNode = new Map<TreeNode, TreeNode>();
  private activeId: string | null = null;
  private activeCCommand = new Set<string>();
  private activeDominated = new Set<string>();

  constructor(root: HTMLElement) {
    this.themeToggleEl = root.querySelector<HTMLElement>("#mbThemeToggle")!;
    this.resetBtn = root.querySelector<HTMLButtonElement>("#mbResetBtn")!;
    this.refInput = root.querySelector<HTMLInputElement>("#mbRefSentence")!;
    this.splitBtn = root.querySelector<HTMLButtonElement>("#mbSplitBtn")!;
    this.hintEl = root.querySelector<HTMLElement>("#mbHint")!;
    this.trayBadge = root.querySelector<HTMLElement>("#mbTrayBadge")!;
    this.tray = root.querySelector<HTMLElement>("#mbTray")!;
    this.mergeBar = root.querySelector<HTMLElement>("#mbMergeBar")!;
    this.zoomOutBtn = root.querySelector<HTMLButtonElement>("#mbZoomOutBtn")!;
    this.zoomInBtn = root.querySelector<HTMLButtonElement>("#mbZoomInBtn")!;
    this.zoomResetBtn = root.querySelector<HTMLButtonElement>("#mbZoomResetBtn")!;
    this.zoomFitBtn = root.querySelector<HTMLButtonElement>("#mbZoomFitBtn")!;
    this.exportPngBtn = root.querySelector<HTMLButtonElement>("#mbExportPngBtn")!;
    this.exportSvgBtn = root.querySelector<HTMLButtonElement>("#mbExportSvgBtn")!;
    this.treeBadge = root.querySelector<HTMLElement>("#mbTreeBadge")!;
    this.treeLegendEl = root.querySelector<HTMLElement>("#mbTreeLegend")!;
    this.canvas = root.querySelector<HTMLElement>("#mbCanvas")!;

    this.bindEvents();
    this.boot();
  }

  // ---------- boot ----------

  private boot(): void {
    try {
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "light" || savedTheme === "dark") this.theme = savedTheme;
    } catch {
      /* private browsing / storage disabled */
    }
    this.applyTheme();

    this.forest = [this.blankLeaf(), this.blankLeaf()];
    this.renderAll();

    this.resetBtn.addEventListener("click", () => {
      this.forest = SAMPLE_WORDS.map((w) => this.makeLeaf(w.label, w.content));
      this.refInput.value = SAMPLE_SENTENCE;
      this.picked = [];
      this.clearActive();
      this.renderAll();
    });

    this.splitBtn.addEventListener("click", () => this.splitReference());

    this.themeToggleEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".style-btn");
      const choice = btn?.getAttribute("data-theme-choice");
      if (choice !== "light" && choice !== "dark") return;
      this.theme = choice;
      this.applyTheme();
      try {
        localStorage.setItem(THEME_KEY, choice);
      } catch {
        /* private browsing / storage disabled */
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.picked.length) this.cancelPick();
    });
  }

  private applyTheme(): void {
    document.documentElement.setAttribute("data-theme", this.theme);
    this.themeToggleEl.querySelectorAll<HTMLButtonElement>(".style-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === this.theme);
    });
  }

  // ---------- forest helpers ----------

  private blankLeaf(): PhraseNode {
    return this.makeLeaf("", "");
  }

  private makeLeaf(label: string, content: string): PhraseNode {
    const leaf: LeafNode = { kind: "leaf", text: content, start: 0, end: 0 };
    return { kind: "phrase", label, children: [leaf], start: 0, end: 0 };
  }

  // Deliberately not a `node is PhraseNode` type predicate: that would make
  // TS narrow the false branch down to LeafNode only, which is wrong — a
  // merged (two-child) node is also a PhraseNode, just not a "basic" one.
  private isBasic(node: TreeNode): boolean {
    return node.kind === "phrase" && node.children.length === 1 && node.children[0].kind === "leaf";
  }

  private isBlank(node: TreeNode): boolean {
    if (!this.isBasic(node)) return false;
    const phrase = node as PhraseNode;
    const leaf = phrase.children[0] as LeafNode;
    return !phrase.label.trim() && !leaf.text.trim();
  }

  private glossOf(node: TreeNode): string {
    if (node.kind === "leaf") return node.text || "…";
    const words = collectWords(node);
    const preview = words.length ? buildPreview(words) : "…";
    return `${node.label || "…"} ${preview}`;
  }

  // Tokenizes the reference sentence into leaves: trailing periods are
  // dropped, and a trailing possessive ("John's", "dogs'") is split off its
  // own token, same as a linguist would bracket it.
  private splitReference(): void {
    const raw = this.refInput.value.trim();
    if (!raw) return;
    const words: string[] = [];
    for (const rawTok of raw.split(/\s+/)) {
      const stripped = rawTok.replace(/\.+$/, "");
      if (!stripped) continue;
      const possessive = /^(.+?)(['’]s)$/i.exec(stripped);
      if (possessive) {
        words.push(possessive[1], possessive[2]);
        continue;
      }
      const pluralPossessive = /^(.+[^'’])(['’])$/.exec(stripped);
      if (pluralPossessive) {
        words.push(pluralPossessive[1], pluralPossessive[2]);
        continue;
      }
      words.push(stripped);
    }
    if (!words.length) return;
    this.forest = words.map((w) => this.makeLeaf("", w));
    this.picked = [];
    this.clearActive();
    this.renderAll();
  }

  // ---------- picking + merging ----------

  private onPickChip(idx: number): void {
    if (this.picked.length === 0) {
      this.picked = [idx];
    } else if (this.picked.length === 1) {
      if (idx === this.picked[0]) this.picked = [];
      else if (Math.abs(idx - this.picked[0]) === 1) this.picked = [Math.min(idx, this.picked[0]), Math.max(idx, this.picked[0])];
      else this.picked = [idx];
    } else {
      this.picked = [idx];
    }
    this.renderTray();
    this.syncMergeBar();
  }

  private cancelPick(): void {
    this.picked = [];
    this.renderTray();
    this.syncMergeBar();
  }

  private syncMergeBar(): void {
    if (this.picked.length !== 2) {
      this.mergeBar.hidden = true;
      return;
    }
    const [i, j] = this.picked;
    const left = this.forest[i];
    const right = this.forest[j];
    this.mergeBar.hidden = false;
    this.mergeBar.innerHTML = `
      <span class="mb-merge-gloss">${escapeHtml(this.glossOf(left))}</span>
      <span class="mb-merge-plus">+</span>
      <span class="mb-merge-gloss">${escapeHtml(this.glossOf(right))}</span>
      <span class="mb-merge-arrow">→</span>
      <input type="text" class="mb-merge-input" id="mbMergeLabelInput" placeholder="New label (e.g. DP)" autocomplete="off" />
      <button type="button" class="reset-btn primary" data-action="confirm-merge">Merge</button>
      <button type="button" class="reset-btn" data-action="cancel-merge">Cancel</button>`;
    const input = this.mergeBar.querySelector<HTMLInputElement>("#mbMergeLabelInput")!;
    input.focus();
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.confirmMerge(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelPick();
      }
    });
  }

  private confirmMerge(labelRaw: string): void {
    const label = labelRaw.trim();
    if (!label) return;
    const [i, j] = this.picked;
    const newNode: PhraseNode = { kind: "phrase", label, children: [this.forest[i], this.forest[j]], start: 0, end: 0 };
    this.forest.splice(i, 2, newNode);
    this.picked = [];
    this.clearActive();
    this.renderAll();
  }

  private unlink(idx: number): void {
    const node = this.forest[idx];
    if (node.kind !== "phrase" || node.children.length !== 2) return;
    this.forest.splice(idx, 1, ...node.children);
    this.picked = [];
    this.clearActive();
    this.renderAll();
  }

  // ---------- tray rendering ----------

  private updateHint(): void {
    if (this.picked.length === 0) this.hintEl.textContent = "Click a chip, then a neighboring chip, to merge them into a bigger node.";
    else if (this.picked.length === 1) this.hintEl.textContent = "Now click the highlighted neighbor to merge with it — or press Esc to cancel.";
    else this.hintEl.textContent = "Type a label for the merged node below, then Merge.";
  }

  private renderTray(): void {
    const parts: string[] = [this.renderInsertBtn(0)];
    this.forest.forEach((node, i) => {
      parts.push(this.renderChip(node, i));
      parts.push(this.renderInsertBtn(i + 1));
    });
    this.tray.innerHTML = parts.join("");
    this.trayBadge.textContent = `${this.forest.length} ${this.forest.length === 1 ? "node" : "nodes"}`;
    this.updateHint();
  }

  private renderInsertBtn(at: number): string {
    return `<button type="button" class="mb-insert-btn" data-action="insert-leaf" data-at="${at}" title="Add a leaf here" aria-label="Add a leaf here" tabindex="-1">+</button>`;
  }

  private renderChip(node: TreeNode, i: number): string {
    const classes = ["mb-chip"];
    if (this.picked.includes(i)) classes.push("picked");
    else if (this.picked.length === 1) classes.push(Math.abs(i - this.picked[0]) === 1 ? "candidate" : "dim");
    const grip = `<span class="mb-chip-grip" draggable="true" title="Drag to reorder">${GRIP_SVG}</span>`;

    if (this.isBasic(node)) {
      const phrase = node as PhraseNode;
      const leaf = phrase.children[0] as LeafNode;
      return `
        <span class="${classes.join(" ")}" data-idx="${i}">
          ${grip}
          <input type="text" class="mb-chip-field mb-chip-label-field" data-field="label" data-idx="${i}" placeholder="Label" value="${escapeHtml(phrase.label)}" />
          <input type="text" class="mb-chip-field mb-chip-content-field" data-field="content" data-idx="${i}" placeholder="Content" value="${escapeHtml(leaf.text)}" />
          <button type="button" class="mb-mini-btn danger" data-action="remove" data-idx="${i}" title="Remove" tabindex="-1">✕</button>
        </span>`;
    }

    const words = collectWords(node);
    const preview = words.length ? buildPreview(words) : "…";
    const label = node.kind === "phrase" ? node.label || "…" : "";
    return `
      <span class="${classes.join(" ")} mb-chip-merged" data-idx="${i}">
        ${grip}
        <span class="mb-chip-gloss"><b>${escapeHtml(label)}</b> ${escapeHtml(preview)}</span>
        <button type="button" class="reset-btn" data-action="unlink" data-idx="${i}" title="Undo this merge" tabindex="-1">Unlink</button>
        <button type="button" class="mb-mini-btn danger" data-action="remove" data-idx="${i}" title="Remove this node and everything under it" tabindex="-1">✕</button>
      </span>`;
  }

  // ---------- keyboard-driven field entry ----------

  private focusLabelOf(idx: number): void {
    this.tray.querySelector<HTMLInputElement>(`[data-field="label"][data-idx="${idx}"]`)?.focus();
  }

  private focusContentOf(idx: number): void {
    this.tray.querySelector<HTMLInputElement>(`[data-field="content"][data-idx="${idx}"]`)?.focus();
  }

  // From a content field, Enter moves to the next still-basic chip's label
  // field, or appends a fresh blank chip and focuses that — so a whole
  // sentence's worth of leaves can be typed without ever reaching for the
  // mouse, the same way Tab/Enter drive the top-down editor.
  private focusNextLabelOrCreate(fromIdx: number): void {
    for (let j = fromIdx + 1; j < this.forest.length; j++) {
      if (this.isBasic(this.forest[j])) {
        this.focusLabelOf(j);
        return;
      }
    }
    this.forest.push(this.blankLeaf());
    this.picked = [];
    this.renderAll();
    this.focusLabelOf(this.forest.length - 1);
  }

  // ---------- tree rendering (view-only) ----------

  private clearActive(): void {
    this.activeId = null;
    this.activeCCommand = new Set();
    this.activeDominated = new Set();
  }

  private cCommanded(node: TreeNode): Set<TreeNode> {
    const result = new Set<TreeNode>();
    const parent = this.parentByNode.get(node);
    if (!parent || parent.kind !== "phrase") return result;
    const collect = (n: TreeNode): void => {
      result.add(n);
      if (n.kind === "phrase") for (const c of n.children) collect(c);
    };
    for (const sibling of parent.children) if (sibling !== node) collect(sibling);
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

  private onNodeClick(id: string): void {
    if (this.activeId === id) {
      this.clearActive();
    } else {
      const node = this.nodeById.get(id);
      this.activeId = id;
      this.activeCCommand = new Set();
      this.activeDominated = new Set();
      if (node) {
        for (const c of this.cCommanded(node)) for (const cid of this.idsByNode.get(c) ?? []) this.activeCCommand.add(cid);
        for (const d of this.dominated(node)) for (const did of this.idsByNode.get(d) ?? []) this.activeDominated.add(did);
      }
    }
    this.renderCanvas();
  }

  private renderLabelMarkup(label: string): string {
    const m = /^(.+)_([^_\s]+)$/.exec(label);
    if (!m) return escapeHtml(label);
    return `${escapeHtml(m[1])}<tspan dy="0.28em" font-size="0.72em">${escapeHtml(m[2])}</tspan>`;
  }

  private addHighlightRect(svg: SVGSVGElement, el: SVGGraphicsElement, cls: string): void {
    const box = el.getBBox();
    const PAD_X = 6;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", cls);
    rect.setAttribute("x", String(box.x - PAD_X));
    rect.setAttribute("y", String(box.y));
    rect.setAttribute("width", String(box.width + PAD_X * 2));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", "4");
    svg.insertBefore(rect, svg.firstChild);
  }

  // Mirrors TreeEditor's own renderTreeView (same constants, same triangle
  // handling, same class names) so a forest of islands reads as the exact
  // same visual language as the top-down tool's single tree. A fully blank
  // basic entry (no label, no content) is skipped entirely — nothing drawn
  // for it yet — and a half-filled one shows "…" for whichever side is
  // still empty, instead of either a dangling blank or "∅" (which would be
  // confusable with an actual null word).
  private renderCanvas(): void {
    this.nodeById = new Map();
    this.idsByNode = new Map();
    this.parentByNode = new Map();

    const visibleForest = this.forest.filter((n) => !this.isBlank(n));
    if (!visibleForest.length) {
      this.canvas.innerHTML = '<div class="tree-empty">Add a leaf to see it appear here.</div>';
      this.treeBadge.textContent = "";
      this.treeLegendEl.hidden = true;
      return;
    }

    const { width, maxDepth } = layoutForest(visibleForest);
    const PAD = 44;
    const LEVEL_H = 70;
    const NODE_GAP = 11;
    const w = width + PAD * 2;
    const h = (maxDepth + 1) * LEVEL_H + PAD * 1.4;

    if (this.fitRequested) {
      this.fitRequested = false;
      const availW = this.canvas.clientWidth - 20;
      const availH = this.canvas.clientHeight - 20;
      if (availW > 0 && availH > 0) this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(availW / w, availH / h)));
    }
    this.zoomResetBtn.textContent = Math.round(this.zoom * 100) + "%";
    this.zoomOutBtn.disabled = this.zoom <= ZOOM_MIN;
    this.zoomInBtn.disabled = this.zoom >= ZOOM_MAX;

    interface DrawNode {
      x: number;
      depth: number;
      leaf: boolean;
      label: string;
      text: string;
      id: string;
    }
    const nodes: DrawNode[] = [];
    const lines: { x1: number; y1: number; x2: number; y2: number; depth: number }[] = [];
    const triangles: { x: number; apexDepth: number; baseDepth: number; halfWidth: number; depth: number }[] = [];
    let counter = 0;
    const addId = (node: TreeNode, id: string) => {
      this.nodeById.set(id, node);
      const ids = this.idsByNode.get(node) ?? [];
      ids.push(id);
      this.idsByNode.set(node, ids);
    };

    const walk = (node: TreeNode, parent: TreeNode | null, parentIsBasic = false): void => {
      const depth = node.depth ?? 0;
      const x = node.x ?? 0;
      const triangle = node.kind === "phrase" && isTriangleNode(node);
      const leaf = isLeaf(node) && !triangle;
      const basic = node.kind === "phrase" && node.children.length === 1 && node.children[0].kind === "leaf";
      if (parent) {
        lines.push({ x1: parent.x ?? 0, y1: parent.depth ?? 0, x2: x, y2: depth, depth });
        this.parentByNode.set(node, parent);
      }
      const id = "m" + counter++;
      addId(node, id);

      let displayLabel = node.kind === "phrase" ? node.label : "";
      if (basic && !displayLabel.trim()) displayLabel = "…";
      let displayText = node.kind === "leaf" ? stripQuotes(node.text) : "";
      if (node.kind === "leaf" && parentIsBasic && !node.text.trim()) displayText = "…";

      nodes.push({ x, depth, leaf, label: displayLabel, text: displayText, id });

      if (triangle && node.kind === "phrase") {
        const baseDepth = depth + 1;
        const halfWidth = (node.triangleWidth ?? 86) / 2;
        triangles.push({ x, apexDepth: depth, baseDepth, halfWidth, depth: baseDepth });
        const tid = "m" + counter++;
        addId(node, tid);
        nodes.push({ x, depth: baseDepth, leaf: true, label: "", text: collectWords(node).map(stripQuotes).join(" "), id: tid });
        return;
      }
      if (!leaf && node.kind === "phrase") for (const c of node.children) walk(c, node, basic);
    };
    visibleForest.forEach((root) => walk(root, null));

    const simple = this.treeStyle === "simple";
    let svg = `<svg class="tree-svg" viewBox="0 0 ${w} ${h}" width="${w * this.zoom}" height="${h * this.zoom}">`;
    for (const l of lines) {
      const x1 = l.x1 + PAD;
      const y1 = l.y1 * LEVEL_H + PAD + NODE_GAP;
      const x2 = l.x2 + PAD;
      const y2 = l.y2 * LEVEL_H + PAD - NODE_GAP;
      if (simple) {
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--ink)" stroke-width="1"/>`;
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
      const stroke = simple ? "var(--ink)" : `var(--depth-${t.depth % 5})`;
      svg += `<polygon points="${apexX},${apexY} ${baseX1},${baseY} ${baseX2},${baseY}" fill="none" stroke="${stroke}" stroke-width="${simple ? 1 : 1.6}"${simple ? "" : ' opacity=".75"'}/>`;
    }
    for (const n of nodes) {
      const colorCls = simple ? (n.leaf ? "simple-leaf" : "simple-node") : "d" + (n.depth % 5);
      const cls = [n.leaf ? "leaf" : "label", colorCls];
      if (n.id === this.activeId) cls.push("active");
      if (this.activeCCommand.has(n.id)) cls.push("c-command");
      if (this.activeDominated.has(n.id)) cls.push("dominated");
      const labelMarkup = n.leaf ? escapeHtml(n.text) : this.renderLabelMarkup(n.label);
      svg += `<text id="${n.id}" class="tree-node ${cls.join(" ")}" x="${n.x + PAD}" y="${n.depth * LEVEL_H + PAD}" text-anchor="middle" dominant-baseline="central">${labelMarkup}</text>`;
    }
    svg += "</svg>";
    this.canvas.innerHTML = svg;

    const svgEl = this.canvas.querySelector<SVGSVGElement>("svg.tree-svg");
    if (svgEl) {
      if (this.activeId) {
        const el = document.getElementById(this.activeId);
        if (el instanceof SVGGraphicsElement) this.addHighlightRect(svgEl, el, "tree-node-highlight");
      }
      for (const id of this.activeCCommand) {
        const el = document.getElementById(id);
        if (el instanceof SVGGraphicsElement) this.addHighlightRect(svgEl, el, "tree-c-command-highlight");
      }
      for (const id of this.activeDominated) {
        const el = document.getElementById(id);
        if (el instanceof SVGGraphicsElement) this.addHighlightRect(svgEl, el, "tree-dominance-highlight");
      }
    }

    this.canvas.querySelectorAll<SVGTextElement>(".tree-node").forEach((el) => {
      el.addEventListener("click", () => this.onNodeClick(el.id));
    });

    const phraseCount = nodes.filter((n) => !n.leaf).length;
    const leafCount = nodes.filter((n) => n.leaf).length;
    this.treeBadge.textContent = `${phraseCount} ${phraseCount === 1 ? "node" : "nodes"} · ${leafCount} ${leafCount === 1 ? "leaf" : "leaves"}`;
    this.treeLegendEl.hidden = !this.activeId;
  }

  private renderAll(): void {
    this.renderTray();
    this.syncMergeBar();
    this.renderCanvas();
  }

  // ---------- event wiring ----------

  private bindEvents(): void {
    this.tray.addEventListener("input", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const idx = Number(target.getAttribute("data-idx"));
      const field = target.getAttribute("data-field");
      const node = this.forest[idx];
      if (!node || node.kind !== "phrase") return;
      if (field === "label") node.label = target.value;
      else if (field === "content" && node.children[0]?.kind === "leaf") (node.children[0] as LeafNode).text = target.value;
      this.renderCanvas();
    });

    this.tray.addEventListener("focusin", (e) => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.classList.contains("mb-chip-field")) target.select();
    });

    this.tray.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const target = e.target;
      if (!(target instanceof HTMLInputElement) || !target.classList.contains("mb-chip-field")) return;
      e.preventDefault();
      const idx = Number(target.getAttribute("data-idx"));
      const field = target.getAttribute("data-field");
      if (field === "label") this.focusContentOf(idx);
      else this.focusNextLabelOrCreate(idx);
    });

    this.tray.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return;
      const actionBtn = target.closest<HTMLButtonElement>("button[data-action]");
      if (actionBtn) {
        const action = actionBtn.getAttribute("data-action");
        const idx = actionBtn.hasAttribute("data-idx") ? Number(actionBtn.getAttribute("data-idx")) : -1;
        switch (action) {
          case "insert-leaf": {
            const at = Number(actionBtn.getAttribute("data-at"));
            this.forest.splice(at, 0, this.blankLeaf());
            this.picked = [];
            this.renderAll();
            this.focusLabelOf(at);
            break;
          }
          case "remove":
            this.forest.splice(idx, 1);
            this.picked = [];
            this.clearActive();
            this.renderAll();
            break;
          case "unlink":
            this.unlink(idx);
            break;
        }
        return;
      }
      const chip = target.closest<HTMLElement>(".mb-chip[data-idx]");
      if (chip) this.onPickChip(Number(chip.getAttribute("data-idx")));
    });

    // Drag-and-drop reordering, delegated on the tray so it survives
    // re-renders. Only the grip handle is draggable, so dragging never
    // fights with selecting text in the label/content fields.
    this.tray.addEventListener("dragstart", (e) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>(".mb-chip-grip");
      const chip = grip?.closest<HTMLElement>(".mb-chip[data-idx]");
      if (!grip || !chip) {
        e.preventDefault();
        return;
      }
      this.dragSrcIdx = Number(chip.getAttribute("data-idx"));
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(this.dragSrcIdx));
      }
      chip.classList.add("dragging");
    });

    this.tray.addEventListener("dragover", (e) => {
      if (this.dragSrcIdx === null) return;
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".mb-chip[data-idx]");
      if (!chip) return;
      e.preventDefault();
      const rect = chip.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      this.tray.querySelectorAll(".mb-chip").forEach((c) => c.classList.remove("drop-before", "drop-after"));
      chip.classList.add(before ? "drop-before" : "drop-after");
    });

    this.tray.addEventListener("drop", (e) => {
      if (this.dragSrcIdx === null) return;
      e.preventDefault();
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".mb-chip[data-idx]");
      const src = this.dragSrcIdx;
      this.dragSrcIdx = null;
      if (!chip) return;
      const destIdx = Number(chip.getAttribute("data-idx"));
      const rect = chip.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      let insertAt = before ? destIdx : destIdx + 1;
      if (insertAt === src || insertAt === src + 1) return; // dropped back where it started
      const [moved] = this.forest.splice(src, 1);
      if (src < insertAt) insertAt--;
      this.forest.splice(insertAt, 0, moved);
      this.picked = [];
      this.renderAll();
    });

    this.tray.addEventListener("dragend", () => {
      this.dragSrcIdx = null;
      this.tray.querySelectorAll(".mb-chip").forEach((c) => c.classList.remove("dragging", "drop-before", "drop-after"));
    });

    this.mergeBar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!btn) return;
      if (btn.getAttribute("data-action") === "confirm-merge") {
        const input = this.mergeBar.querySelector<HTMLInputElement>("#mbMergeLabelInput");
        this.confirmMerge(input?.value ?? "");
      } else if (btn.getAttribute("data-action") === "cancel-merge") {
        this.cancelPick();
      }
    });

    this.zoomOutBtn.addEventListener("click", () => this.setZoom(this.zoom / ZOOM_STEP));
    this.zoomInBtn.addEventListener("click", () => this.setZoom(this.zoom * ZOOM_STEP));
    this.zoomResetBtn.addEventListener("click", () => this.setZoom(1));
    this.zoomFitBtn.addEventListener("click", () => {
      this.fitRequested = true;
      this.renderCanvas();
    });

    this.exportPngBtn.addEventListener("click", () => this.exportPng());
    this.exportSvgBtn.addEventListener("click", () => this.exportSvg());
  }

  private setZoom(z: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    this.renderCanvas();
  }

  // ---------- export (mirrors TreeEditor's, against this.canvas) ----------

  private getExportSvg(): SVGSVGElement | null {
    const live = this.canvas.querySelector<SVGSVGElement>(".tree-svg");
    if (!live) return null;
    const clone = live.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const liveEls = Array.from(live.querySelectorAll<SVGElement>("*"));
    const cloneEls = Array.from(clone.querySelectorAll<SVGElement>("*"));
    liveEls.forEach((liveEl, i) => {
      const cloneEl = cloneEls[i];
      const cs = getComputedStyle(liveEl);
      const tag = liveEl.tagName.toLowerCase();
      if (tag === "text") {
        cloneEl.setAttribute("fill", cs.fill);
        cloneEl.setAttribute("font-family", cs.fontFamily);
        cloneEl.setAttribute("font-style", cs.fontStyle);
        cloneEl.setAttribute("font-weight", cs.fontWeight);
        cloneEl.setAttribute("font-size", cs.fontSize);
        cloneEl.removeAttribute("class");
        cloneEl.removeAttribute("id");
      } else if (tag === "line" || tag === "path" || tag === "polygon") {
        cloneEl.setAttribute("stroke", cs.stroke);
      } else if (
        tag === "rect" &&
        (liveEl.classList.contains("tree-node-highlight") ||
          liveEl.classList.contains("tree-c-command-highlight") ||
          liveEl.classList.contains("tree-dominance-highlight"))
      ) {
        cloneEl.setAttribute("fill", cs.fill);
        cloneEl.removeAttribute("class");
      }
    });

    const viewBox = (clone.getAttribute("viewBox") || "0 0 0 0").split(" ").map(Number);
    const w = viewBox[2] || 0;
    const h = viewBox[3] || 0;
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));

    const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", String(w));
    rect.setAttribute("height", String(h));
    rect.setAttribute("fill", bg);
    clone.insertBefore(rect, clone.firstChild);

    return clone;
  }

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

  private exportSvg(): void {
    const svg = this.getExportSvg();
    if (!svg) return;
    const markup = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    this.triggerDownload(new Blob([markup], { type: "image/svg+xml" }), "syntax-tree-merge.svg");
  }

  private exportPng(): void {
    const svg = this.getExportSvg();
    if (!svg) return;
    const w = parseFloat(svg.getAttribute("width") || "0");
    const h = parseFloat(svg.getAttribute("height") || "0");
    if (!w || !h) return;
    const SCALE = 2;
    const markup = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const canvasEl = document.createElement("canvas");
      canvasEl.width = w * SCALE;
      canvasEl.height = h * SCALE;
      const ctx = canvasEl.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
        canvasEl.toBlob((blob) => {
          if (blob) this.triggerDownload(blob, "syntax-tree-merge.png");
          URL.revokeObjectURL(url);
        }, "image/png");
      } else {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }
}
