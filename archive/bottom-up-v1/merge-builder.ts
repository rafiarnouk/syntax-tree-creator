// Bottom-up tree builder: list leaves and their categories, then repeatedly
// Merge two neighboring (adjacent, unmerged) nodes until one remains. A
// vanilla DOM controller, same architectural pattern as TreeEditor — see
// the "Why TreeEditor isn't a React component" note in README.md.

import { layoutForest } from "./merge-layout";
import { buildPreview, collectWords } from "./notation";
import { THEME_KEY } from "./editor";
import type { LeafNode, PhraseNode, TreeNode } from "./types";
import { escapeHtml } from "./utils";

type ThemeChoice = "light" | "dark";
type Phase = "setup" | "merging";

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;

interface LeafEntry {
  category: string;
  word: string;
  isNull: boolean;
}

interface MergeStep {
  left: string;
  right: string;
  label: string;
}

interface HistoryEntry {
  forest: TreeNode[];
  steps: MergeStep[];
}

const SAMPLE_LEAVES: LeafEntry[] = [
  { category: "D", word: "The", isNull: false },
  { category: "N", word: "dog", isNull: false },
  { category: "T", word: "might", isNull: false },
  { category: "V", word: "chase", isNull: false },
  { category: "D", word: "the", isNull: false },
  { category: "N", word: "cat", isNull: false },
];

export class MergeBuilder {
  private themeToggleEl: HTMLElement;
  private resetBtn: HTMLButtonElement;
  private leftLabel: HTMLElement;
  private leftBadge: HTMLElement;
  private leftBody: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private zoomOutBtn: HTMLButtonElement;
  private zoomInBtn: HTMLButtonElement;
  private zoomResetBtn: HTMLButtonElement;
  private zoomFitBtn: HTMLButtonElement;
  private exportPngBtn: HTMLButtonElement;
  private exportSvgBtn: HTMLButtonElement;
  private treeBadge: HTMLElement;
  private mergeBar: HTMLElement;
  private canvas: HTMLElement;

  private theme: ThemeChoice = "light";
  private zoom = 1;
  private fitRequested = false;

  private phase: Phase = "setup";
  private leaves: LeafEntry[] = [{ category: "", word: "", isNull: false }, { category: "", word: "", isNull: false }];
  private forest: TreeNode[] = [];
  private history: HistoryEntry[] = [];
  private steps: MergeStep[] = [];
  private picked: number[] = [];
  private rootIds: string[] = [];
  private nodeById = new Map<string, TreeNode>();

  constructor(root: HTMLElement) {
    this.themeToggleEl = root.querySelector<HTMLElement>("#mbThemeToggle")!;
    this.resetBtn = root.querySelector<HTMLButtonElement>("#mbResetBtn")!;
    this.leftLabel = root.querySelector<HTMLElement>("#mbLeftLabel")!;
    this.leftBadge = root.querySelector<HTMLElement>("#mbLeftBadge")!;
    this.leftBody = root.querySelector<HTMLElement>("#mbLeftBody")!;
    this.undoBtn = root.querySelector<HTMLButtonElement>("#mbUndoBtn")!;
    this.zoomOutBtn = root.querySelector<HTMLButtonElement>("#mbZoomOutBtn")!;
    this.zoomInBtn = root.querySelector<HTMLButtonElement>("#mbZoomInBtn")!;
    this.zoomResetBtn = root.querySelector<HTMLButtonElement>("#mbZoomResetBtn")!;
    this.zoomFitBtn = root.querySelector<HTMLButtonElement>("#mbZoomFitBtn")!;
    this.exportPngBtn = root.querySelector<HTMLButtonElement>("#mbExportPngBtn")!;
    this.exportSvgBtn = root.querySelector<HTMLButtonElement>("#mbExportSvgBtn")!;
    this.treeBadge = root.querySelector<HTMLElement>("#mbTreeBadge")!;
    this.mergeBar = root.querySelector<HTMLElement>("#mbMergeBar")!;
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

    this.resetBtn.addEventListener("click", () => {
      this.leaves = SAMPLE_LEAVES.map((l) => ({ ...l }));
      this.phase = "setup";
      this.forest = [];
      this.history = [];
      this.steps = [];
      this.picked = [];
      this.renderAll();
    });

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
      if (e.key === "Escape" && this.phase === "merging" && this.picked.length) this.cancelPick();
    });

    this.renderAll();
  }

  private applyTheme(): void {
    document.documentElement.setAttribute("data-theme", this.theme);
    this.themeToggleEl.querySelectorAll<HTMLButtonElement>(".style-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === this.theme);
    });
  }

  // ---------- leaf setup ----------

  private canStart(): boolean {
    return this.leaves.length >= 2 && this.leaves.every((l) => l.category.trim() !== "" && (l.isNull || l.word.trim() !== ""));
  }

  private leafToNode(l: LeafEntry): PhraseNode {
    const word: LeafNode = { kind: "leaf", text: l.isNull ? "∅" : l.word.trim(), start: 0, end: 0, isNull: l.isNull };
    return { kind: "phrase", label: l.category.trim(), children: [word], start: 0, end: 0 };
  }

  private renderLeafSetup(): void {
    const rows = this.leaves
      .map((l, i) => {
        const hasSpace = /\s/.test(l.word.trim());
        return `
      <div class="mb-leaf-row">
        <span class="mb-leaf-order">
          <button type="button" class="mb-mini-btn" data-action="up" data-idx="${i}" title="Move up"${i === 0 ? " disabled" : ""}>↑</button>
          <button type="button" class="mb-mini-btn" data-action="down" data-idx="${i}" title="Move down"${i === this.leaves.length - 1 ? " disabled" : ""}>↓</button>
        </span>
        <input type="text" class="mb-field mb-field-cat" data-field="category" data-idx="${i}" placeholder="Category" value="${escapeHtml(l.category)}" />
        <input type="text" class="mb-field mb-field-word" data-field="word" data-idx="${i}" placeholder="${l.isNull ? "∅" : "Word"}" value="${escapeHtml(l.word)}"${l.isNull ? " disabled" : ""} />
        <button type="button" class="mb-null-toggle${l.isNull ? " active" : ""}" data-action="toggle-null" data-idx="${i}" title="Covert / null element">∅</button>
        <button type="button" class="mb-mini-btn" data-action="split" data-idx="${i}" title="Split on spaces into separate leaves"${hasSpace ? "" : " disabled"}>⎇</button>
        <button type="button" class="mb-mini-btn danger" data-action="remove" data-idx="${i}" title="Remove leaf">✕</button>
      </div>`;
      })
      .join("");
    const empty = this.leaves.length === 0 ? '<div class="mb-step-empty">Add your first leaf below.</div>' : "";
    this.leftBody.innerHTML = `
      <div class="mb-leaf-list">${empty}${rows}</div>
      <div class="mb-leaf-actions">
        <button type="button" class="reset-btn" data-action="add-leaf">+ Add leaf</button>
        <button type="button" class="reset-btn primary" data-action="start-merging"${this.canStart() ? "" : " disabled"}>Start merging →</button>
      </div>`;
  }

  // ---------- derivation (merging phase) ----------

  private glossOf(node: TreeNode): string {
    if (node.kind === "leaf") return node.text || "∅";
    const words = collectWords(node);
    const preview = words.length ? buildPreview(words) : "…";
    return `${node.label || "∅"} (${preview})`;
  }

  private startMerging(): void {
    if (!this.canStart()) return;
    this.forest = this.leaves.map((l) => this.leafToNode(l));
    this.history = [];
    this.steps = [];
    this.picked = [];
    this.phase = "merging";
    this.renderAll();
  }

  private backToSetup(): void {
    if (this.steps.length > 0) {
      const ok = window.confirm(`Discard ${this.steps.length} merge${this.steps.length === 1 ? "" : "s"} and go back to edit leaves?`);
      if (!ok) return;
    }
    this.phase = "setup";
    this.forest = [];
    this.history = [];
    this.steps = [];
    this.picked = [];
    this.renderAll();
  }

  private renderDerivationPanel(): void {
    const recap = this.leaves.map((l) => (l.isNull ? l.category || "∅" : `${l.category || "∅"}-${l.word || "∅"}`)).join(", ");
    const stepsHtml = this.steps.length
      ? this.steps
          .map(
            (s, i) =>
              `<div class="mb-step-row"><span class="mb-step-num">${i + 1}.</span><span class="mb-step-text">${escapeHtml(s.left)} + ${escapeHtml(s.right)} → <b>${escapeHtml(s.label)}</b></span></div>`,
          )
          .join("")
      : '<div class="mb-step-empty">No merges yet — click two neighboring nodes in the tree to begin.</div>';
    const banner =
      this.forest.length === 1
        ? '<div class="mb-complete-banner">Derivation complete — one node left. Export it, or Undo to keep refining.</div>'
        : "";
    this.leftBody.innerHTML = `
      <div class="mb-recap">${escapeHtml(recap)}</div>
      ${banner}
      <div class="mb-steps">${stepsHtml}</div>
      <div class="mb-leaf-actions">
        <button type="button" class="reset-btn" data-action="edit-leaves">← Edit leaves</button>
      </div>`;
  }

  // ---------- merge selection ----------

  private onRootClick(id: string): void {
    const idx = this.rootIds.indexOf(id);
    if (idx === -1) return;
    if (this.picked.length === 0) {
      this.picked = [idx];
    } else if (this.picked.length === 1) {
      if (idx === this.picked[0]) this.picked = [];
      else if (Math.abs(idx - this.picked[0]) === 1) this.picked = [Math.min(idx, this.picked[0]), Math.max(idx, this.picked[0])];
      else this.picked = [idx];
    } else {
      this.picked = [idx];
    }
    this.renderMergeState();
  }

  private renderMergeState(): void {
    this.renderCanvas(this.forest, true);
    if (this.picked.length === 2) this.showMergeBar();
    else this.mergeBar.hidden = true;
  }

  private showMergeBar(): void {
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

  private cancelPick(): void {
    this.picked = [];
    this.renderMergeState();
  }

  private confirmMerge(labelRaw: string): void {
    const label = labelRaw.trim();
    if (!label) return;
    const [i, j] = this.picked;
    const left = this.forest[i];
    const right = this.forest[j];
    const newNode: PhraseNode = { kind: "phrase", label, children: [left, right], start: 0, end: 0 };
    this.history.push({ forest: this.forest.slice(), steps: this.steps.slice() });
    this.steps.push({ left: this.glossOf(left), right: this.glossOf(right), label });
    this.forest = [...this.forest.slice(0, i), newNode, ...this.forest.slice(j + 1)];
    this.picked = [];
    this.mergeBar.hidden = true;
    this.renderAll();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.forest = prev.forest;
    this.steps = prev.steps;
    this.picked = [];
    this.mergeBar.hidden = true;
    this.renderAll();
  }

  // ---------- canvas rendering ----------

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

  private renderCanvas(forest: TreeNode[], interactive: boolean): void {
    if (!forest.length) {
      this.canvas.innerHTML = '<div class="tree-empty">Add a leaf to see it appear here.</div>';
      this.rootIds = [];
      this.nodeById = new Map();
      this.treeBadge.textContent = "";
      return;
    }

    const { width, maxLevel } = layoutForest(forest);
    const PAD = 44;
    const LEVEL_H = 70;
    const NODE_GAP = 11;
    const w = width + PAD * 2;
    const h = (maxLevel + 1) * LEVEL_H + PAD * 1.4;

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
      y: number;
      leaf: boolean;
      label: string;
      text: string;
      id: string;
      isNullLeaf: boolean;
    }
    const nodes: DrawNode[] = [];
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    this.nodeById = new Map();
    this.rootIds = [];
    let counter = 0;

    const walk = (node: TreeNode, parent: TreeNode | null): string => {
      const depth = node.depth ?? 0;
      const y = (maxLevel - depth) * LEVEL_H + PAD;
      const x = (node.x ?? 0) + PAD;
      const leaf = node.kind === "leaf";
      const id = "m" + counter++;
      this.nodeById.set(id, node);
      nodes.push({
        x,
        y,
        leaf,
        label: node.kind === "phrase" ? node.label || "∅" : "",
        text: node.kind === "leaf" ? node.text : "",
        id,
        isNullLeaf: node.kind === "leaf" && !!node.isNull,
      });
      if (parent) {
        const py = (maxLevel - (parent.depth ?? 0)) * LEVEL_H + PAD;
        const px = (parent.x ?? 0) + PAD;
        lines.push({ x1: px, y1: py + NODE_GAP, x2: x, y2: y - NODE_GAP });
      }
      if (node.kind === "phrase") for (const c of node.children) walk(c, node);
      return id;
    };
    forest.forEach((rootNode) => this.rootIds.push(walk(rootNode, null)));

    const pickedIds = this.picked.map((i) => this.rootIds[i]);

    let svg = `<svg class="tree-svg" viewBox="0 0 ${w} ${h}" width="${w * this.zoom}" height="${h * this.zoom}">`;
    for (const l of lines) {
      svg += `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="var(--ink)" stroke-width="1"/>`;
    }
    for (const n of nodes) {
      const isRoot = this.rootIds.includes(n.id);
      const cls = ["tree-node", n.leaf ? "leaf" : "label", n.leaf ? "simple-leaf" : "simple-node"];
      if (n.isNullLeaf) cls.push("null");
      if (interactive && isRoot) cls.push("mb-root");
      else cls.push("mb-fixed");
      if (n.id === pickedIds[0]) cls.push("mb-pick-a", "active");
      if (n.id === pickedIds[1]) cls.push("mb-pick-b", "active");
      if (interactive && this.picked.length === 1 && isRoot && n.id !== pickedIds[0]) {
        const thisIdx = this.rootIds.indexOf(n.id);
        cls.push(Math.abs(thisIdx - this.picked[0]) === 1 ? "mb-candidate" : "mb-dim");
      }
      const content = n.leaf ? escapeHtml(n.text) : this.renderLabelMarkup(n.label);
      svg += `<text id="${n.id}" class="${cls.join(" ")}" x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central">${content}</text>`;
    }
    svg += "</svg>";
    this.canvas.innerHTML = svg;

    const svgEl = this.canvas.querySelector<SVGSVGElement>("svg.tree-svg");
    if (svgEl) {
      this.canvas.querySelectorAll<SVGGraphicsElement>(".mb-pick-a").forEach((el) => this.addHighlightRect(svgEl, el, "tree-node-highlight"));
      this.canvas.querySelectorAll<SVGGraphicsElement>(".mb-pick-b").forEach((el) => this.addHighlightRect(svgEl, el, "tree-c-command-highlight"));
      this.canvas.querySelectorAll<SVGGraphicsElement>(".mb-candidate").forEach((el) => this.addHighlightRect(svgEl, el, "mb-candidate-rect"));
    }

    if (interactive) {
      this.canvas.querySelectorAll<SVGTextElement>(".mb-root").forEach((el) => {
        el.addEventListener("click", () => this.onRootClick(el.id));
      });
    }

    const phraseCount = nodes.filter((n) => !n.leaf).length;
    const leafCount = nodes.filter((n) => n.leaf).length;
    this.treeBadge.textContent = `${phraseCount} ${phraseCount === 1 ? "node" : "nodes"} · ${leafCount} ${leafCount === 1 ? "leaf" : "leaves"}`;
  }

  // ---------- top-level render dispatch ----------

  private renderAll(): void {
    if (this.phase === "setup") {
      this.renderLeafSetup();
      this.renderCanvas(this.leaves.map((l) => this.leafToNode(l)), false);
      this.leftLabel.textContent = "Leaves";
      this.leftBadge.textContent = `${this.leaves.length} ${this.leaves.length === 1 ? "leaf" : "leaves"}`;
      this.undoBtn.disabled = true;
      this.exportPngBtn.disabled = true;
      this.exportSvgBtn.disabled = true;
    } else {
      this.renderDerivationPanel();
      this.renderCanvas(this.forest, true);
      this.leftLabel.textContent = "Derivation";
      this.leftBadge.textContent = `${this.forest.length} ${this.forest.length === 1 ? "node left" : "nodes left"}`;
      this.undoBtn.disabled = this.history.length === 0;
      this.exportPngBtn.disabled = false;
      this.exportSvgBtn.disabled = false;
    }
  }

  // ---------- event wiring ----------

  private bindEvents(): void {
    this.leftBody.addEventListener("input", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const idx = Number(target.getAttribute("data-idx"));
      const field = target.getAttribute("data-field");
      if (Number.isNaN(idx) || !this.leaves[idx]) return;
      if (field === "category") this.leaves[idx].category = target.value;
      else if (field === "word") {
        this.leaves[idx].word = target.value;
        const splitBtn = this.leftBody.querySelector<HTMLButtonElement>(`[data-action="split"][data-idx="${idx}"]`);
        if (splitBtn) splitBtn.disabled = !/\s/.test(target.value.trim());
      }
      this.renderCanvas(this.leaves.map((l) => this.leafToNode(l)), false);
      this.leftBadge.textContent = `${this.leaves.length} ${this.leaves.length === 1 ? "leaf" : "leaves"}`;
      const startBtn = this.leftBody.querySelector<HTMLButtonElement>('[data-action="start-merging"]');
      if (startBtn) startBtn.disabled = !this.canStart();
    });

    this.leftBody.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const idx = btn.hasAttribute("data-idx") ? Number(btn.getAttribute("data-idx")) : -1;
      switch (action) {
        case "add-leaf":
          this.leaves.push({ category: "", word: "", isNull: false });
          this.renderAll();
          break;
        case "remove":
          this.leaves.splice(idx, 1);
          this.renderAll();
          break;
        case "up":
          if (idx > 0) [this.leaves[idx - 1], this.leaves[idx]] = [this.leaves[idx], this.leaves[idx - 1]];
          this.renderAll();
          break;
        case "down":
          if (idx < this.leaves.length - 1) [this.leaves[idx + 1], this.leaves[idx]] = [this.leaves[idx], this.leaves[idx + 1]];
          this.renderAll();
          break;
        case "toggle-null":
          this.leaves[idx].isNull = !this.leaves[idx].isNull;
          this.renderAll();
          break;
        case "split": {
          const parts = this.leaves[idx].word.trim().split(/\s+/);
          if (parts.length > 1) this.leaves.splice(idx, 1, ...parts.map((w) => ({ category: "", word: w, isNull: false })));
          this.renderAll();
          break;
        }
        case "start-merging":
          this.startMerging();
          break;
        case "edit-leaves":
          this.backToSetup();
          break;
      }
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

    this.undoBtn.addEventListener("click", () => this.undo());

    this.zoomOutBtn.addEventListener("click", () => this.setZoom(this.zoom / ZOOM_STEP));
    this.zoomInBtn.addEventListener("click", () => this.setZoom(this.zoom * ZOOM_STEP));
    this.zoomResetBtn.addEventListener("click", () => this.setZoom(1));
    this.zoomFitBtn.addEventListener("click", () => {
      this.fitRequested = true;
      this.renderAll();
    });

    this.exportPngBtn.addEventListener("click", () => this.exportPng());
    this.exportSvgBtn.addEventListener("click", () => this.exportSvg());
  }

  private setZoom(z: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    this.renderAll();
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
      } else if (tag === "line") {
        cloneEl.setAttribute("stroke", cs.stroke);
      } else if (tag === "rect" && (liveEl.classList.contains("tree-node-highlight") || liveEl.classList.contains("tree-c-command-highlight"))) {
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
