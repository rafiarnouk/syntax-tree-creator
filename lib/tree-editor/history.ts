// Undo/redo for the bracket editor. The textarea's native stack is wiped
// whenever its value is set from code, which most structural edits here do,
// so every change (typed or not) is recorded in this stack instead.

import type { FoldRecord } from "./types";

export interface EditState {
  value: string;
  selStart: number;
  selEnd: number;
  folds: FoldRecord[];
}

// "word"/"space" are typed characters and "delete" is Backspace/Delete; runs
// of the same kind merge into one step. Anything else is its own step.
export type EditKind = "word" | "space" | "delete" | null;

const LIMIT = 500;
const GROUP_MS = 1200;

const clone = (s: EditState): EditState => ({ ...s, folds: s.folds.map((f) => ({ ...f })) });

export class EditHistory {
  private undoStack: EditState[] = [];
  private redoStack: EditState[] = [];
  private current: EditState;
  private lastKind: EditKind = null;
  private lastAt = 0;

  constructor(initial: EditState) {
    this.current = clone(initial);
  }

  // Called after every update. With the value unchanged this only tracks the
  // selection, so an undo puts the caret back where it was before the edit.
  record(state: EditState, kind: EditKind): void {
    if (state.value === this.current.value) {
      if (state.selStart !== this.current.selStart || state.selEnd !== this.current.selEnd) this.lastKind = null;
      this.current = clone(state);
      return;
    }
    const now = Date.now();
    const continues = kind === this.lastKind || (this.lastKind === "word" && kind === "space");
    if (!(kind && continues && now - this.lastAt < GROUP_MS)) {
      this.undoStack.push(this.current);
      if (this.undoStack.length > LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastKind = kind;
    this.lastAt = now;
    this.current = clone(state);
  }

  undo(): EditState | null {
    return this.step(this.undoStack, this.redoStack);
  }

  redo(): EditState | null {
    return this.step(this.redoStack, this.undoStack);
  }

  private step(from: EditState[], to: EditState[]): EditState | null {
    const next = from.pop();
    if (!next) return null;
    to.push(this.current);
    this.current = next;
    this.lastKind = null;
    return clone(next);
  }
}
