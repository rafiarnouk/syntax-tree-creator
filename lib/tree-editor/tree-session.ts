// Ties the editor to the saved tree it has open, if any, and tracks whether
// the two still match. The editor's own draft is separate and always kept, so
// unsaved work survives a reload either way.

import type { TreeEditor } from "./editor";
import { collectWords, isArrowToken, parseTree, scanBrackets, stripQuotes, tokenize } from "./notation";
import type { SavedTree, TreeStore } from "./tree-store";

const OPEN_TREE_KEY = "syntax-tree-creator-open-tree";

// blank: nothing to save. new: text that was never saved. edited: differs from
// the open tree. saved: matches it.
export type SaveStatus = "blank" | "new" | "edited" | "saved";

export interface SessionState {
  tree: SavedTree | null;
  status: SaveStatus;
  failed: boolean;
}

export class TreeSession {
  private editor: TreeEditor | null = null;
  private state: SessionState = { tree: null, status: "blank", failed: false };
  private listeners = new Set<() => void>();

  constructor(private store: TreeStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SessionState => this.state;

  get hasUnsavedWork(): boolean {
    return this.state.status === "new" || this.state.status === "edited";
  }

  async attach(editor: TreeEditor): Promise<void> {
    this.editor = editor;
    editor.onChange = () => this.publish(this.state.tree);
    let id: string | null = null;
    try {
      id = localStorage.getItem(OPEN_TREE_KEY);
    } catch {
      /* private browsing / storage disabled */
    }
    this.link(id ? await this.store.get(id).catch(() => null) : null);
  }

  // What to offer as the title of a tree being saved for the first time.
  suggestedTitle(): string {
    if (!this.editor) return "";
    const { source, sentence } = this.editor;
    if (sentence.trim()) return sentence.trim();
    const tree = scanBrackets(source).balanced ? parseTree(tokenize(source)) : null;
    return tree
      ? collectWords(tree)
          .filter((w) => !isArrowToken(w))
          .map(stripQuotes)
          .join(" ")
      : "";
  }

  // `title` names a tree saved for the first time; an open tree keeps its own.
  async save(title = ""): Promise<void> {
    if (!this.editor) return;
    const { source, sentence } = this.editor;
    const { tree } = this.state;
    try {
      if (tree) {
        const followsSentence = tree.title === tree.sentence && sentence.trim();
        this.link(await this.store.update(tree.id, { source, sentence, title: followsSentence ? sentence : tree.title }));
      } else {
        this.link(await this.store.create({ title, sentence, source }));
      }
    } catch {
      this.publish(tree, true);
    }
  }

  open(tree: SavedTree): void {
    if (tree.id === this.state.tree?.id) return;
    this.editor?.load(tree.source, tree.sentence);
    this.link(tree);
  }

  // Starts a document that isn't tied to any saved tree.
  start(source: string, sentence: string): void {
    this.editor?.load(source, sentence);
    this.link(null);
  }

  // Call after the open tree may have been renamed or deleted elsewhere.
  async refresh(): Promise<void> {
    const { tree } = this.state;
    if (tree) this.link(await this.store.get(tree.id));
  }

  private link(tree: SavedTree | null): void {
    try {
      if (tree) localStorage.setItem(OPEN_TREE_KEY, tree.id);
      else localStorage.removeItem(OPEN_TREE_KEY);
    } catch {
      /* private browsing / storage disabled */
    }
    this.publish(tree);
  }

  private statusFor(tree: SavedTree | null): SaveStatus {
    if (!this.editor) return "blank";
    const { source, sentence } = this.editor;
    if (tree) return source === tree.source && sentence === tree.sentence ? "saved" : "edited";
    return source.trim() ? "new" : "blank";
  }

  private publish(tree: SavedTree | null, failed = false): void {
    const status = this.statusFor(tree);
    const prev = this.state;
    if (prev.tree === tree && prev.status === status && prev.failed === failed) return;
    this.state = { tree, status, failed };
    this.listeners.forEach((listener) => listener());
  }
}
