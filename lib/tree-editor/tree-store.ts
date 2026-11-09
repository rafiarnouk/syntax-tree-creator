// Where saved trees live. Everything else talks to the TreeStore interface,
// so moving them to a database means replacing only `treeStore` below.

export interface SavedTree {
  id: string;
  title: string;
  sentence: string;
  source: string; // full bracket text, never folded
  createdAt: number;
  updatedAt: number;
}

export type TreeFields = Pick<SavedTree, "title" | "sentence" | "source">;

export interface TreeStore {
  list(): Promise<SavedTree[]>;
  get(id: string): Promise<SavedTree | null>;
  create(fields: TreeFields): Promise<SavedTree>;
  update(id: string, fields: Partial<TreeFields>): Promise<SavedTree | null>; // null if it no longer exists
  delete(id: string): Promise<void>;
}

const TREES_KEY = "syntax-tree-creator-trees";

class LocalTreeStore implements TreeStore {
  // Throws on unreadable data, so a later write can't replace it with a fresh list.
  private read(): SavedTree[] {
    const trees: unknown = JSON.parse(localStorage.getItem(TREES_KEY) ?? "[]");
    if (!Array.isArray(trees)) throw new Error("Saved trees are unreadable");
    return trees;
  }

  private write(trees: SavedTree[]): void {
    localStorage.setItem(TREES_KEY, JSON.stringify(trees));
  }

  async list(): Promise<SavedTree[]> {
    return this.read();
  }

  async get(id: string): Promise<SavedTree | null> {
    return this.read().find((t) => t.id === id) ?? null;
  }

  async create(fields: TreeFields): Promise<SavedTree> {
    const now = Date.now();
    const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const tree = { ...fields, id, createdAt: now, updatedAt: now };
    this.write([...this.read(), tree]);
    return tree;
  }

  async update(id: string, fields: Partial<TreeFields>): Promise<SavedTree | null> {
    const trees = this.read();
    const i = trees.findIndex((t) => t.id === id);
    if (i < 0) return null;
    trees[i] = { ...trees[i], ...fields, updatedAt: Date.now() };
    this.write(trees);
    return trees[i];
  }

  async delete(id: string): Promise<void> {
    this.write(this.read().filter((t) => t.id !== id));
  }
}

export const treeStore: TreeStore = new LocalTreeStore();
