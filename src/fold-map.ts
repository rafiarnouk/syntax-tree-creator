import type { FoldMapEntry, FoldRecord, TreeNode } from "./types";

export interface DiffResult {
  prefixLen: number;
  oldSuffixStart: number;
}

// Common prefix/suffix length between two strings, describing one edit.
export function diffEdit(oldVal: string, newVal: string): DiffResult {
  const len = Math.min(oldVal.length, newVal.length);
  let p = 0;
  while (p < len && oldVal.charAt(p) === newVal.charAt(p)) p++;
  const maxSuffix = len - p;
  let s = 0;
  while (s < maxSuffix && oldVal.charAt(oldVal.length - 1 - s) === newVal.charAt(newVal.length - 1 - s)) s++;
  return { prefixLen: p, oldSuffixStart: oldVal.length - s };
}

export function remapFolds(oldVal: string, newVal: string, folds: FoldRecord[]): FoldRecord[] {
  if (!folds.length || oldVal === newVal) return folds;
  const d = diffEdit(oldVal, newVal);
  const delta = newVal.length - oldVal.length;
  const kept: FoldRecord[] = [];
  for (const f of folds) {
    if (f.end <= d.prefixLen) {
      kept.push(f);
    } else if (f.start >= d.oldSuffixStart) {
      kept.push({ ...f, start: f.start + delta, end: f.end + delta });
    }
    // else: edit overlaps this placeholder — drop it, position unrecoverable.
  }
  return kept;
}

export function buildFoldMap(rawText: string, folds: FoldRecord[]): { text: string; map: FoldMapEntry[] } {
  if (!folds.length) return { text: rawText, map: [] };
  const sorted = [...folds].sort((a, b) => a.start - b.start);
  let text = "";
  let rawPos = 0;
  const map: FoldMapEntry[] = [];
  for (const f of sorted) {
    if (f.start < rawPos) continue;
    text += rawText.slice(rawPos, f.start);
    const fullStart = text.length;
    text += f.original;
    map.push({ fullStart, fullEnd: text.length, rawStart: f.start, rawEnd: f.end });
    rawPos = f.end;
  }
  text += rawText.slice(rawPos);
  return { text, map };
}

// A point inside a fold maps to that fold's whole placeholder span, not a
// single offset — there's no finer-grained position to point to.
export function fullToRaw(offset: number, map: FoldMapEntry[]): { start: number; end: number } {
  let shift = 0;
  for (const m of map) {
    if (offset < m.fullStart) break;
    if (offset <= m.fullEnd) return { start: m.rawStart, end: m.rawEnd };
    shift += (m.fullEnd - m.fullStart) - (m.rawEnd - m.rawStart);
  }
  const raw = offset - shift;
  return { start: raw, end: raw };
}

export function mapNodeToRaw(node: TreeNode, map: FoldMapEntry[]): { start: number; end: number } {
  const s = fullToRaw(node.start, map);
  if (s.start !== s.end) return s; // the whole node sits inside one fold
  const e = fullToRaw(node.end, map);
  return { start: s.start, end: e.start };
}
