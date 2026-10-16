// depth/x are unset until layout() (layout.ts) assigns them.
export interface LeafNode {
  kind: "leaf";
  text: string;
  start: number;
  end: number;
  depth?: number;
  x?: number;
}

export interface PhraseNode {
  kind: "phrase";
  label: string;
  children: TreeNode[];
  start: number;
  end: number;
  depth?: number;
  x?: number;
  triangleWidth?: number; // set by layout() when this renders as a triangle
}

export type TreeNode = LeafNode | PhraseNode;

export interface Token {
  type: "open" | "close" | "word";
  text: string;
  start: number;
  end: number;
}

export interface BracketInfo {
  index: number;
  type: "open" | "close";
  pairIndex?: number;
}

export interface ScanError {
  index: number;
  message: string;
}

export interface BracketScan {
  brackets: BracketInfo[];
  errors: ScanError[];
  balanced: boolean;
}

export interface MatchSet {
  a: number;
  b: number;
}

export interface EmptySlot {
  type: "label" | "content";
  at: number;
}

// start/end bound the placeholder in the real text, not the hidden content.
export interface FoldRecord {
  start: number;
  end: number;
  original: string;
}

export interface FoldMapEntry {
  fullStart: number;
  fullEnd: number;
  rawStart: number;
  rawEnd: number;
}

export interface FoldableNode {
  start: number;
  end: number;
}

export interface LabelOption {
  key: string;
  desc: string;
}
