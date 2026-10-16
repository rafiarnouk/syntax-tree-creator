import type { FoldMapEntry, FoldRecord, TreeNode } from "./types";

// Carries folds across an edit. A fold whose placeholder is untouched keeps
// it: the text up to its end is unchanged (edit after it), or the text from
// its start on is (edit before it). Failing both, e.g. after indenting a
// block of lines around it, it's re-found by its exact placeholder text,
// nearest its old spot. One the edit actually cut into is dropped.
export function remapFolds(oldVal: string, newVal: string, folds: FoldRecord[]): FoldRecord[] {
  if (!folds.length || oldVal === newVal) return folds;
  const delta = newVal.length - oldVal.length;
  const kept: FoldRecord[] = [];
  const lost: FoldRecord[] = [];
  for (const f of folds) {
    if (newVal.startsWith(oldVal.slice(0, f.end))) kept.push(f);
    else if (newVal.endsWith(oldVal.slice(f.start))) kept.push({ ...f, start: f.start + delta, end: f.end + delta });
    else lost.push(f);
  }
  for (const f of lost) {
    const placeholder = oldVal.slice(f.start, f.end);
    let best = -1;
    for (let at = newVal.indexOf(placeholder); at !== -1; at = newVal.indexOf(placeholder, at + 1)) {
      const taken = kept.some((k) => at < k.end && at + placeholder.length > k.start);
      if (!taken && (best === -1 || Math.abs(at - f.start) < Math.abs(best - f.start))) best = at;
    }
    if (best !== -1) kept.push({ ...f, start: best, end: best + placeholder.length });
  }
  return kept;
}

// Drops saved folds that no longer line up with the saved text.
export function validFolds(text: string, folds: FoldRecord[]): FoldRecord[] {
  let lastEnd = 0;
  return [...folds]
    .sort((a, b) => a.start - b.start)
    .filter((f) => {
      const placeholder = text.slice(f.start, f.end);
      const ok =
        typeof f.original === "string" &&
        f.start >= lastEnd &&
        f.end <= text.length &&
        /^\[[^[\]\n]*\]$/.test(placeholder);
      if (ok) lastEnd = f.end;
      return ok;
    });
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
    if (offset < m.fullEnd) return { start: m.rawStart, end: m.rawEnd };
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
