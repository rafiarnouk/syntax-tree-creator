// Bottom-up tree builder: a single horizontal row of nodes, merged by
// dragging one onto its neighbor (or clicking both). A merged node is drawn
// as a frame physically wrapping the two nodes it was made from, so the
// tray reads as nested boxes of the same tree drawn below. The tree itself
// is a pure, view-only mirror of the same forest. A vanilla DOM controller,
// same architectural pattern as TreeEditor (see the "Why TreeEditor isn't a
// React component" note in README.md).

import { layoutForest } from "./merge-layout";
import { collectWords, isLeaf, isTriangleNode, stripQuotes } from "./notation";
import { buildExportSvg } from "./svg-export";
import { bindThemeToggle } from "./theme";
import { TreeViewport } from "./viewport";
import type { LeafNode, PhraseNode, TreeNode } from "./types";
import { escapeHtml } from "./utils";

type TreeStyle = "simple" | "fancy";
type DropTarget = { kind: "merge"; with: number } | { kind: "move"; at: number } | null;

interface DragState {
  pointerId: number;
  srcIdx: number;
  srcEl: HTMLElement;
  ghost: HTMLElement | null;
  startX: number;
  startY: number;
  grabDX: number;
  grabDY: number;
  lastX: number;
  lastY: number;
  target: DropTarget;
}

const SAMPLE_SENTENCE = "The dog might chase the cat.";
const SAMPLE_WORDS: { label: string; content: string }[] = [
  { label: "D", content: "The" },
  { label: "N", content: "dog" },
  { label: "T", content: "might" },
  { label: "V", content: "chase" },
  { label: "D", content: "the" },
  { label: "N", content: "cat" },
];

const FLIP_MS = 300;
const FLIP_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

// Inlined rather than imported from components/icons.tsx since this markup
// is built as an HTML string, not JSX.
const GRIP_SVG =
  '<svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true">' +
  '<circle cx="1.5" cy="1.5" r="1.2"/><circle cx="6.5" cy="1.5" r="1.2"/>' +
  '<circle cx="1.5" cy="6" r="1.2"/><circle cx="6.5" cy="6" r="1.2"/>' +
  '<circle cx="1.5" cy="10.5" r="1.2"/><circle cx="6.5" cy="10.5" r="1.2"/></svg>';
const MERGE_SVG =
  '<svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1 L6 6 L11 1"/><path d="M6 6 L6 9.5"/></svg>';
const UNLINK_SVG =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 1 V5.5"/><path d="M6 5.5 L1.5 11"/><path d="M6 5.5 L10.5 11"/></svg>';
const REMOVE_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" aria-hidden="true"><path d="M2 2 L8 8"/><path d="M8 2 L2 8"/></svg>';

export class MergeBuilder {
  private themeToggleEl: HTMLElement;
  private resetBtn: HTMLButtonElement;
  private refInput: HTMLInputElement;
  private splitBtn: HTMLButtonElement;
  private hintEl: HTMLElement;
  private trayBadge: HTMLElement;
  private tray: HTMLElement;
  private viewport: TreeViewport;
  private exportPngBtn: HTMLButtonElement;
  private exportSvgBtn: HTMLButtonElement;
  private treeBadge: HTMLElement;
  private treeLegendEl: HTMLElement;
  private canvas: HTMLElement;

  private treeStyle: TreeStyle = "simple";

  // Every entry is either a basic leaf — a phrase with exactly one leaf
  // child, e.g. [D the] — or the result of a merge, with exactly two
  // children. That shape alone distinguishes the two; no separate flag.
  private forest: TreeNode[] = [];
  private pickedIdx: number | null = null;
  private drag: DragState | null = null;
  private suppressClick = false;

  // Stable per-node keys, so a node's chip can be found again after the
  // tray is rebuilt — that's what lets moves and merges animate.
  private keyOf = new WeakMap<TreeNode, number>();
  private nodeByKey = new Map<number, TreeNode>();
  private nextKey = 1;

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
    this.exportPngBtn = root.querySelector<HTMLButtonElement>("#mbExportPngBtn")!;
    this.exportSvgBtn = root.querySelector<HTMLButtonElement>("#mbExportSvgBtn")!;
    this.treeBadge = root.querySelector<HTMLElement>("#mbTreeBadge")!;
    this.treeLegendEl = root.querySelector<HTMLElement>("#mbTreeLegend")!;
    this.canvas = root.querySelector<HTMLElement>("#mbCanvas")!;
    this.viewport = new TreeViewport(this.canvas, {
      out: root.querySelector<HTMLButtonElement>("#mbZoomOutBtn")!,
      in: root.querySelector<HTMLButtonElement>("#mbZoomInBtn")!,
      reset: root.querySelector<HTMLButtonElement>("#mbZoomResetBtn")!,
      fit: root.querySelector<HTMLButtonElement>("#mbZoomFitBtn")!,
    });

    this.bindEvents();
    this.boot();
  }

  // ---------- boot ----------

  private boot(): void {
    bindThemeToggle(this.themeToggleEl);
    this.renderAll();

    this.resetBtn.addEventListener("click", () => {
      this.refInput.value = SAMPLE_SENTENCE;
      this.mutate(() => {
        this.forest = SAMPLE_WORDS.map((w) => this.makeLeaf(w.label, w.content));
      });
    });

    this.splitBtn.addEventListener("click", () => this.splitReference());
    this.refInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.splitReference();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.drag) this.endDrag(true);
      else if (this.pickedIdx !== null) this.setPicked(null);
    });
  }

  private get motionOk(): boolean {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  // 0 for a still-basic leaf, +1 per level of merging above it.
  private mergeHeight(node: TreeNode): number {
    if (this.isBasic(node) || node.kind !== "phrase") return 0;
    return 1 + Math.max(...node.children.map((c) => this.mergeHeight(c)));
  }

  private keyFor(node: TreeNode): number {
    let key = this.keyOf.get(node);
    if (key === undefined) {
      key = this.nextKey++;
      this.keyOf.set(node, key);
    }
    this.nodeByKey.set(key, node);
    return key;
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
    this.mutate(() => {
      this.forest = words.map((w) => this.makeLeaf("", w));
    });
    this.focusField(this.forest[0], "label");
  }

  // ---------- structural changes ----------

  // Every change to the forest goes through here: measure where each chip
  // is now, apply the change, rebuild, then slide every chip from its old
  // spot to its new one. `from` overrides the measured start rect of
  // particular chips (a dragged chip starts from where it was dropped).
  private mutate(change: () => void, from?: Map<number, DOMRect>): void {
    const before = this.snapshotRects();
    from?.forEach((rect, key) => before.set(key, rect));
    change();
    this.pickedIdx = null;
    this.clearActive();
    this.renderAll();
    this.playFlip(before);
  }

  private mergeAt(i: number, from?: Map<number, DOMRect>): void {
    if (i < 0 || i + 1 >= this.forest.length) return;
    const merged: PhraseNode = { kind: "phrase", label: "", children: [this.forest[i], this.forest[i + 1]], start: 0, end: 0 };
    this.mutate(() => this.forest.splice(i, 2, merged), from);
    this.focusField(merged, "label");
  }

  private unlink(idx: number): void {
    const node = this.forest[idx];
    if (node?.kind !== "phrase" || node.children.length !== 2) return;
    this.mutate(() => this.forest.splice(idx, 1, ...node.children));
  }

  private insertAt(at: number): void {
    const leaf = this.blankLeaf();
    this.mutate(() => this.forest.splice(at, 0, leaf));
    this.focusField(leaf, "label");
  }

  private removeAt(idx: number): void {
    const node = this.forest[idx];
    const el = this.topChip(idx);
    const commit = () => {
      const at = this.forest.indexOf(node);
      if (at !== -1) this.mutate(() => this.forest.splice(at, 1));
    };
    if (!el || !this.motionOk) return commit();
    el.style.pointerEvents = "none";
    el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.85)" }], {
      duration: 140,
      easing: "ease-in",
      fill: "forwards",
    }).onfinish = commit;
  }

  // ---------- picking (click a node, then its neighbor) ----------

  private setPicked(idx: number | null): void {
    this.pickedIdx = idx;
    this.syncPickClasses();
    this.updateHint();
  }

  private onPickChip(idx: number): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.tray.contains(active)) active.blur();
    const p = this.pickedIdx;
    if (p === null || p === idx) this.setPicked(p === idx ? null : idx);
    else if (Math.abs(idx - p) === 1) this.mergeAt(Math.min(idx, p));
    else this.setPicked(idx);
  }

  // Toggles classes on the existing chips instead of rebuilding them, so
  // the outline/dim changes can transition smoothly.
  private syncPickClasses(): void {
    const p = this.pickedIdx;
    this.tray.querySelectorAll<HTMLElement>(".mb-top").forEach((el) => {
      const i = Number(el.dataset.idx);
      const near = p !== null && Math.abs(i - p) === 1;
      el.classList.toggle("picked", p === i);
      el.classList.toggle("candidate", near);
      el.classList.toggle("dim", p !== null && p !== i && !near);
    });
  }

  // ---------- tray rendering ----------

  private updateHint(): void {
    let text: string;
    if (this.drag?.ghost) text = "Drop onto a neighbor to merge with it, or between two nodes to move it there.";
    else if (this.pickedIdx !== null) text = "Now click a dashed neighbor to merge with it, or press Esc to cancel.";
    else if (!this.forest.length) text = "Start by adding a leaf, or type a sentence above and split it into leaves.";
    else if (this.forest.length === 1 && !this.isBasic(this.forest[0])) text = "Everything is merged into one tree. Use the unlink button on a node to take it apart again.";
    else if (this.forest.length === 1) text = "Add another leaf with +, then merge neighbors together.";
    else text = "Drag a node onto its neighbor to merge them, or click one and then the other. Drag it between two nodes to move it.";
    this.hintEl.textContent = text;
  }

  private renderTray(): void {
    this.nodeByKey = new Map();
    if (!this.forest.length) {
      this.tray.innerHTML = `
        <button type="button" class="mb-add-first" data-action="insert-leaf" data-at="0">
          <span class="mb-add-first-plus">+</span>
          <span class="mb-add-first-text"><b>Add a leaf</b><span>or split the sentence above</span></span>
        </button>`;
    } else {
      const parts: string[] = [
        `<button type="button" class="mb-insert-btn" data-action="insert-leaf" data-at="0" title="Add a leaf here" aria-label="Add a leaf at the start" tabindex="-1">+</button>`,
      ];
      this.forest.forEach((node, i) => {
        parts.push(this.renderChip(node, i, this.maxHeight() - this.mergeHeight(node)));
        if (i < this.forest.length - 1) parts.push(this.renderGapControl(i));
      });
      parts.push(
        `<button type="button" class="mb-add-end" data-action="insert-leaf" data-at="${this.forest.length}" title="Add a leaf at the end" aria-label="Add a leaf at the end">+</button>`,
        '<div class="mb-drop-marker" hidden></div>',
      );
      this.tray.innerHTML = parts.join("");
    }
    this.tray.style.setProperty("--mb-max", String(this.maxHeight()));
    this.trayBadge.textContent = this.forest.length ? `${this.forest.length} ${this.forest.length === 1 ? "node" : "nodes"}` : "";
    this.syncPickClasses();
    this.updateHint();
    this.syncScrollFades();
  }

  // Fades whichever edge has more nodes past it — scrollbars are often
  // hidden until scrolled, so nothing else hints the row continues.
  private syncScrollFades(): void {
    const { scrollLeft, scrollWidth, clientWidth } = this.tray;
    this.tray.classList.toggle("fade-left", scrollLeft > 1);
    this.tray.classList.toggle("fade-right", scrollLeft + clientWidth < scrollWidth - 1);
  }

  private renderGapControl(leftIdx: number): string {
    return `
      <span class="mb-gap">
        <button type="button" class="mb-gap-merge" data-action="merge-pair" data-idx="${leftIdx}" title="Merge these two nodes" aria-label="Merge these two nodes" tabindex="-1">${MERGE_SVG}</button>
        <button type="button" class="mb-gap-insert" data-action="insert-leaf" data-at="${leftIdx + 1}" title="Add a leaf here" aria-label="Add a leaf here" tabindex="-1">+</button>
      </span>`;
  }

  // A leaf is its label over its word. A merge is a frame around its two
  // nodes with its own label between them, so each level of merging only
  // adds a frame's padding, not another row. Top-level nodes also get a grip
  // and buttons: beside the label for a leaf, in a slim bar for a merge.
  // Each frame adds a little padding under what it wraps, so a node beside
  // a taller sibling gets lifted by the difference (`lift`, in frame steps).
  // That keeps every word on one shared line while each frame stays snug.
  private renderChip(node: TreeNode, idx: number | null, lift: number): string {
    const phrase = node as PhraseNode;
    const key = this.keyFor(node);
    const top = idx !== null;
    const basic = this.isBasic(node);
    const height = this.mergeHeight(node);
    const style = `--node-color: var(--depth-${height % 5}); --lift: ${lift}`;
    const cls = ["mb-chip", top ? "mb-top" : "mb-sub", basic ? "mb-leaf" : "mb-merged"].join(" ");
    const idxAttr = top ? ` data-idx="${idx}"` : "";

    const grip = top ? `<span class="mb-chip-grip" title="Drag to merge or move">${GRIP_SVG}</span>` : "";
    let actions = "";
    if (top) {
      if (!basic) actions += `<button type="button" class="mb-icon-btn" data-action="unlink" data-idx="${idx}" title="Unlink (undo this merge)" aria-label="Unlink" tabindex="-1">${UNLINK_SVG}</button>`;
      actions += `<button type="button" class="mb-icon-btn danger" data-action="remove" data-idx="${idx}" title="${basic ? "Remove" : "Remove this node and everything in it"}" aria-label="Remove" tabindex="-1">${REMOVE_SVG}</button>`;
    }
    const label = this.fieldHtml(key, "label", phrase.label);

    let inner: string;
    if (basic) {
      inner = `
        <div class="mb-chip-head">
          <span class="mb-head-side">${grip}</span>
          ${label}
          <span class="mb-head-side end">${actions}</span>
        </div>
        ${this.fieldHtml(key, "content", (phrase.children[0] as LeafNode).text)}`;
    } else {
      const [left, right] = phrase.children.map((c) => this.renderChip(c, null, height - 1 - this.mergeHeight(c)));
      const bar = top ? `<div class="mb-chip-bar">${grip}<span class="mb-head-side end">${actions}</span></div>` : "";
      inner = `${bar}<div class="mb-chip-kids">${left}<div class="mb-chip-mid">${label}</div>${right}</div>`;
    }
    return `<div class="${cls}" data-key="${key}"${idxAttr} style="${style}">${inner}</div>`;
  }

  private fieldHtml(key: number, field: "label" | "content", value: string): string {
    const placeholder = field === "label" ? "Label" : "Content";
    return (
      `<input type="text" class="mb-field mb-field-${field}" data-node="${key}" data-field="${field}" size="1" ` +
      `placeholder="${placeholder}" value="${escapeHtml(value)}" style="min-width: ${this.fieldWidth(field, value)}" ` +
      `spellcheck="false" autocomplete="off" />`
    );
  }

  private fieldWidth(field: string, value: string): string {
    const placeholderLen = field === "label" ? 5 : 7;
    return `${Math.max(value.length, value ? 1 : placeholderLen) + 2}ch`;
  }

  private maxHeight(): number {
    return Math.max(0, ...this.forest.map((n) => this.mergeHeight(n)));
  }

  private topChip(idx: number): HTMLElement | null {
    return this.tray.querySelector<HTMLElement>(`.mb-top[data-idx="${idx}"]`);
  }

  // ---------- animation ----------

  private snapshotRects(): Map<number, DOMRect> {
    const rects = new Map<number, DOMRect>();
    this.tray.querySelectorAll<HTMLElement>(".mb-chip").forEach((el) => rects.set(Number(el.dataset.key), el.getBoundingClientRect()));
    return rects;
  }

  // FLIP: each chip that existed before is shifted back to where it was and
  // animated home. A chip nested inside another moving chip already gets
  // carried along by its parent, so only its own extra offset is applied.
  // A brand-new merge frame fades in around its (sliding) children; a
  // brand-new chip pops in.
  private playFlip(before: Map<number, DOMRect>): void {
    if (!this.motionOk) return;
    const offsets = new Map<Element, { dx: number; dy: number }>();
    const fresh = new Set<Element>();
    let entering = 0;
    this.tray.querySelectorAll<HTMLElement>(".mb-chip").forEach((el) => {
      const parentChip = el.parentElement?.closest(".mb-chip") ?? null;
      const inherited = (parentChip && offsets.get(parentChip)) || { dx: 0, dy: 0 };
      const prev = before.get(Number(el.dataset.key));

      if (!prev) {
        offsets.set(el, inherited);
        fresh.add(el);
        const wrapsExisting = Array.from(el.querySelectorAll<HTMLElement>(".mb-chip")).some((k) => before.has(Number(k.dataset.key)));
        if (wrapsExisting) {
          el.animate([{ backgroundColor: "transparent", borderColor: "transparent", boxShadow: "none" }, {}], { duration: 360, easing: "ease-out" });
          el.querySelectorAll(":scope > .mb-chip-bar, :scope > .mb-chip-kids > .mb-chip-mid").forEach((part) =>
            part.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
              duration: 260,
              delay: 140,
              easing: "ease-out",
              fill: "backwards",
            }),
          );
        } else if (!parentChip || !fresh.has(parentChip)) {
          el.animate([{ opacity: 0, transform: "translateY(8px) scale(0.85)" }, { opacity: 1, transform: "none" }], {
            duration: 240,
            delay: Math.min(entering++ * 35, 280),
            easing: "cubic-bezier(0.2, 0.9, 0.3, 1.15)",
            fill: "backwards",
          });
        }
        return;
      }

      const now = el.getBoundingClientRect();
      const dx = prev.left - now.left;
      const dy = prev.top - now.top;
      offsets.set(el, { dx, dy });
      const ownX = dx - inherited.dx;
      const ownY = dy - inherited.dy;
      if (Math.abs(ownX) < 0.5 && Math.abs(ownY) < 0.5) return;
      el.animate([{ transform: `translate(${ownX}px, ${ownY}px)` }, { transform: "none" }], { duration: FLIP_MS, easing: FLIP_EASE });
    });
  }

  // ---------- drag to merge / move ----------

  private startGhost(d: DragState): void {
    const rect = d.srcEl.getBoundingClientRect();
    const ghost = d.srcEl.cloneNode(true) as HTMLElement;
    // cloneNode copies the value attribute from the last render, not what's
    // been typed since
    const liveInputs = d.srcEl.querySelectorAll("input");
    ghost.querySelectorAll("input").forEach((input, i) => (input.value = liveInputs[i]?.value ?? ""));
    ghost.classList.remove("picked", "candidate", "dim");
    ghost.classList.add("mb-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);
    d.ghost = ghost;

    const active = document.activeElement;
    if (active instanceof HTMLElement && this.tray.contains(active)) active.blur();
    window.getSelection()?.removeAllRanges();
    document.body.classList.add("mb-no-select");

    this.pickedIdx = null;
    this.syncPickClasses();
    d.srcEl.classList.add("drag-source");
    this.tray.classList.add("is-dragging");
    this.updateHint();
  }

  private onDragMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
      this.startGhost(d);
    }
    d.ghost!.style.transform = `translate(${e.clientX - d.grabDX}px, ${e.clientY - d.grabDY}px)`;
    this.autoScroll(e.clientX);
    this.updateDropTarget(e.clientX);
  };

  private onDragUp = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(e.type === "pointercancel");
  };

  private autoScroll(x: number): void {
    const r = this.tray.getBoundingClientRect();
    const EDGE = 56;
    if (x < r.left + EDGE) this.tray.scrollLeft -= (r.left + EDGE - x) / 3;
    else if (x > r.right - EDGE) this.tray.scrollLeft += (x - (r.right - EDGE)) / 3;
  }

  // Over the middle of an immediate neighbor = merge with it. Anywhere else
  // (a non-neighbor, a neighbor's far edge, a gap) = move to the nearest
  // slot between nodes.
  private updateDropTarget(x: number): void {
    const d = this.drag!;
    const tops = Array.from(this.tray.querySelectorAll<HTMLElement>(".mb-top"));
    let target: DropTarget = null;
    const over = tops.find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right;
    });
    if (over) {
      const i = Number(over.dataset.idx);
      const r = over.getBoundingClientRect();
      const rel = (x - r.left) / r.width;
      const farEdge = i < d.srcIdx ? rel < 0.15 : rel > 0.85;
      if (i === d.srcIdx) target = null;
      else if (Math.abs(i - d.srcIdx) === 1 && !farEdge) target = { kind: "merge", with: i };
      else target = { kind: "move", at: rel < 0.5 ? i : i + 1 };
    } else {
      const at = tops.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2 < x;
      }).length;
      target = { kind: "move", at };
    }
    if (target?.kind === "move" && (target.at === d.srcIdx || target.at === d.srcIdx + 1)) target = null;
    d.target = target;

    tops.forEach((el) => el.classList.toggle("merge-target", target?.kind === "merge" && Number(el.dataset.idx) === target.with));
    d.ghost?.classList.toggle("will-merge", target?.kind === "merge");

    const marker = this.tray.querySelector<HTMLElement>(".mb-drop-marker");
    if (!marker) return;
    if (target?.kind !== "move") {
      marker.hidden = true;
      return;
    }
    const trayRect = this.tray.getBoundingClientRect();
    const before = tops[target.at - 1]?.getBoundingClientRect();
    const after = tops[target.at]?.getBoundingClientRect();
    const GAP = 36;
    const markerX = before && after ? (before.right + after.left) / 2 : after ? after.left - GAP / 2 : before!.right + GAP / 2;
    marker.style.left = `${markerX - trayRect.left + this.tray.scrollLeft - 1.5}px`;
    marker.hidden = false;
  }

  private endDrag(cancel: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragUp);
    window.removeEventListener("pointercancel", this.onDragUp);
    if (!d.ghost) return;

    this.suppressClick = true;
    setTimeout(() => (this.suppressClick = false), 0);

    // Every chip in the dragged subtree starts its settle animation from
    // where the ghost was let go, not from the faded placeholder.
    const srcRect = d.srcEl.getBoundingClientRect();
    const shiftX = d.lastX - d.grabDX - srcRect.left;
    const shiftY = d.lastY - d.grabDY - srcRect.top;
    const from = new Map<number, DOMRect>();
    [d.srcEl, ...Array.from(d.srcEl.querySelectorAll<HTMLElement>(".mb-chip"))].forEach((el) => {
      const r = el.getBoundingClientRect();
      from.set(Number(el.dataset.key), new DOMRect(r.left + shiftX, r.top + shiftY, r.width, r.height));
    });

    d.ghost.remove();
    document.body.classList.remove("mb-no-select");
    d.srcEl.classList.remove("drag-source");
    this.tray.classList.remove("is-dragging");

    const target = cancel ? null : d.target;
    if (target?.kind === "merge") {
      this.mergeAt(Math.min(d.srcIdx, target.with), from);
    } else if (target?.kind === "move") {
      this.mutate(() => {
        const [moved] = this.forest.splice(d.srcIdx, 1);
        this.forest.splice(d.srcIdx < target.at ? target.at - 1 : target.at, 0, moved);
      }, from);
    } else {
      this.mutate(() => {}, from);
    }
  }

  // ---------- keyboard-driven field entry ----------

  private focusField(node: TreeNode | undefined, field: "label" | "content"): void {
    if (!node) return;
    this.tray.querySelector<HTMLInputElement>(`input[data-node="${this.keyFor(node)}"][data-field="${field}"]`)?.focus();
  }

  // From a content field, Enter moves to the next top-level leaf's label,
  // or appends a fresh leaf and focuses that — so a whole sentence can be
  // typed without reaching for the mouse.
  private focusNextLabelOrCreate(fromTopIdx: number): void {
    for (let j = fromTopIdx + 1; j < this.forest.length; j++) {
      if (this.isBasic(this.forest[j])) {
        this.focusField(this.forest[j], "label");
        return;
      }
    }
    this.insertAt(this.forest.length);
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
  // leaf is skipped entirely; a blank label or word shows "…" rather than
  // "∅", which would be confusable with an actual null word.
  private renderCanvas(): void {
    this.nodeById = new Map();
    this.idsByNode = new Map();
    this.parentByNode = new Map();

    const visibleForest = this.forest.filter((n) => !this.isBlank(n));
    if (!visibleForest.length) {
      this.canvas.innerHTML = '<div class="tree-empty">Add a leaf to see it appear here.</div>';
      this.treeBadge.textContent = "";
      this.treeLegendEl.hidden = true;
      this.viewport.clear();
      return;
    }

    const { width, maxDepth } = layoutForest(visibleForest);
    const PAD = 44;
    const LEVEL_H = 70;
    const NODE_GAP = 11;
    const w = width + PAD * 2;
    const h = (maxDepth + 1) * LEVEL_H + PAD * 1.4;

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
      const basic = this.isBasic(node);
      if (parent) {
        lines.push({ x1: parent.x ?? 0, y1: parent.depth ?? 0, x2: x, y2: depth, depth });
        this.parentByNode.set(node, parent);
      }
      const id = "m" + counter++;
      addId(node, id);

      let displayLabel = node.kind === "phrase" ? node.label : "";
      if (node.kind === "phrase" && !displayLabel.trim()) displayLabel = "…";
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
    const zoom = this.viewport.scale;
    let svg = `<svg class="tree-svg" viewBox="0 0 ${w} ${h}" width="${w * zoom}" height="${h * zoom}">`;
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
      this.viewport.show(svgEl, w, h);
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
    this.renderCanvas();
  }

  // ---------- event wiring ----------

  private bindEvents(): void {
    this.tray.addEventListener("input", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const node = this.nodeByKey.get(Number(target.dataset.node));
      if (!node || node.kind !== "phrase") return;
      if (target.dataset.field === "label") node.label = target.value;
      else if (node.children[0]?.kind === "leaf") node.children[0].text = target.value;
      target.style.minWidth = this.fieldWidth(target.dataset.field ?? "", target.value);
      this.syncScrollFades();
      this.renderCanvas();
    });

    this.tray.addEventListener("scroll", () => this.syncScrollFades(), { passive: true });
    new ResizeObserver(() => this.syncScrollFades()).observe(this.tray);

    this.tray.addEventListener("focusin", (e) => {
      if (e.target instanceof HTMLInputElement) e.target.select();
    });

    this.tray.addEventListener("keydown", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (e.key === "Escape") {
        target.blur();
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const node = this.nodeByKey.get(Number(target.dataset.node));
      const topIdx = Number(target.closest<HTMLElement>(".mb-top")?.dataset.idx ?? -1);
      if (target.dataset.field === "label" && node && this.isBasic(node)) this.focusField(node, "content");
      else if (target.dataset.field === "content") this.focusNextLabelOrCreate(topIdx);
      else target.blur();
    });

    this.tray.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.drag) return;
      const t = e.target as HTMLElement;
      if (t.closest("button")) return;
      const chip = t.closest<HTMLElement>(".mb-top");
      if (!chip) return;
      // touch scrolls the tray unless the drag starts on the grip
      if (e.pointerType !== "mouse" && !t.closest(".mb-chip-grip")) return;
      // a press on a field still focuses it — it only turns into a drag
      // once the pointer actually moves
      if (!(t instanceof HTMLInputElement)) e.preventDefault();
      const rect = chip.getBoundingClientRect();
      this.drag = {
        pointerId: e.pointerId,
        srcIdx: Number(chip.dataset.idx),
        srcEl: chip,
        ghost: null,
        startX: e.clientX,
        startY: e.clientY,
        grabDX: e.clientX - rect.left,
        grabDY: e.clientY - rect.top,
        lastX: e.clientX,
        lastY: e.clientY,
        target: null,
      };
      window.addEventListener("pointermove", this.onDragMove);
      window.addEventListener("pointerup", this.onDragUp);
      window.addEventListener("pointercancel", this.onDragUp);
    });

    this.tray.addEventListener("click", (e) => {
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input")) return;
      const actionBtn = target.closest<HTMLButtonElement>("button[data-action]");
      if (actionBtn) {
        const idx = Number(actionBtn.dataset.idx ?? -1);
        switch (actionBtn.dataset.action) {
          case "insert-leaf":
            this.insertAt(Number(actionBtn.dataset.at));
            break;
          case "remove":
            this.removeAt(idx);
            break;
          case "unlink":
            this.unlink(idx);
            break;
          case "merge-pair":
            this.mergeAt(idx);
            break;
        }
        return;
      }
      const chip = target.closest<HTMLElement>(".mb-top");
      if (chip) this.onPickChip(Number(chip.dataset.idx));
      else if (this.pickedIdx !== null) this.setPicked(null);
    });

    this.exportPngBtn.addEventListener("click", () => this.exportPng());
    this.exportSvgBtn.addEventListener("click", () => this.exportSvg());
  }

  // ---------- export (mirrors TreeEditor's, against this.canvas) ----------

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
    const live = this.canvas.querySelector<SVGSVGElement>(".tree-svg");
    if (!live) return;
    const svg = await buildExportSvg(live);
    const markup = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
    this.triggerDownload(new Blob([markup], { type: "image/svg+xml" }), "syntax-tree-merge.svg");
  }

  private async exportPng(): Promise<void> {
    const live = this.canvas.querySelector<SVGSVGElement>(".tree-svg");
    if (!live) return;
    const svg = await buildExportSvg(live);
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
