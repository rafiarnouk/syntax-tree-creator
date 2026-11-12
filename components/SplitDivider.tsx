"use client";

import { useEffect, useRef } from "react";

const SPLIT_KEY = "syntax-tree-creator-split";
const DEFAULT_SPLIT = 44.4;
// Keep in step with the clamp() on .workspace's grid columns.
const MIN_LEFT = 280;
const MIN_RIGHT = 320;

// The draggable line between the two panes of `container`, which sizes its
// left column from the --split custom property (a percentage).
export default function SplitDivider({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const split = useRef(DEFAULT_SPLIT);

  const apply = (pct: number) => {
    const box = container.current;
    if (!box) return;
    const w = box.clientWidth;
    const clamped = w > MIN_LEFT + MIN_RIGHT ? Math.min(Math.max(pct, (MIN_LEFT / w) * 100), 100 - (MIN_RIGHT / w) * 100) : pct;
    split.current = clamped;
    box.style.setProperty("--split", `${clamped}%`);
    ref.current?.setAttribute("aria-valuenow", String(Math.round(clamped)));
  };

  const persist = () => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split.current));
    } catch {
      /* private browsing / storage disabled */
    }
  };

  useEffect(() => {
    let saved = NaN;
    try {
      saved = parseFloat(localStorage.getItem(SPLIT_KEY) ?? "");
    } catch {
      /* private browsing / storage disabled */
    }
    if (Number.isFinite(saved)) apply(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pctAt = (clientX: number) => {
    const rect = container.current!.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 100;
  };

  return (
    <div
      ref={ref}
      className="split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the editor and tree"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(DEFAULT_SPLIT)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("resizing");
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(pctAt(e.clientX));
      }}
      onLostPointerCapture={() => {
        document.documentElement.classList.remove("resizing");
        persist();
      }}
      onDoubleClick={() => {
        apply(DEFAULT_SPLIT);
        persist();
      }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -2 : e.key === "ArrowRight" ? 2 : 0;
        if (!step) return;
        e.preventDefault();
        apply(split.current + step);
        persist();
      }}
    />
  );
}
