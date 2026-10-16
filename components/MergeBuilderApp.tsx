"use client";

import { useEffect, useRef } from "react";
import { MergeBuilder } from "@/lib/tree-editor/merge-builder";
import { DownloadIcon, MoonIcon, SunIcon } from "@/components/icons";

// Same mounting pattern as TreeEditorApp — MergeBuilder is a vanilla DOM
// controller, not a React component, for the same reasons (see README.md).
export default function MergeBuilderApp({ hidden }: { hidden?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!rootRef.current || mounted.current) return;
    mounted.current = true;
    new MergeBuilder(rootRef.current);
  }, []);

  return (
    <div className="app" ref={rootRef} hidden={hidden}>
      <header>
        <div>
          <h1>Syntax Tree Creator</h1>
          <p className="tagline">
            Build a tree bottom-up: lay out the words as leaves, then drag each node onto its neighbor to merge them,
            again and again, until one remains.
          </p>
        </div>
        <div className="header-controls">
          <div className="style-toggle" id="mbThemeToggle" role="group" aria-label="Color theme">
            <button type="button" className="style-btn" data-theme-choice="light">
              <SunIcon /> Light
            </button>
            <button type="button" className="style-btn" data-theme-choice="dark">
              <MoonIcon /> Dark
            </button>
          </div>
          <button className="reset-btn" id="mbResetBtn" type="button">
            Load example
          </button>
        </div>
      </header>

      <section className="panel mb-tray-panel">
        <div className="panel-head">
          <span className="label">Leaves &amp; nodes</span>
          <span className="badge" id="mbTrayBadge" />
        </div>
        <div className="mb-hint" id="mbHint" />
        <div className="ref-row">
          <label htmlFor="mbRefSentence" className="ref-label">
            Reference sentence
          </label>
          <input type="text" id="mbRefSentence" className="ref-input" placeholder="e.g. The dog might chase the cat." autoComplete="off" />
          <button type="button" className="reset-btn" id="mbSplitBtn">
            Split into leaves
          </button>
        </div>
        <div className="mb-tray" id="mbTray" />
      </section>

      <section className="panel mb-tree-panel">
        <div className="panel-head">
          <span className="label">Tree</span>
          <div className="tree-controls">
            <div className="zoom-toggle" id="mbZoomControls" role="group" aria-label="Zoom">
              <button type="button" className="zoom-btn" id="mbZoomOutBtn" aria-label="Zoom out">
                −
              </button>
              <button type="button" className="zoom-btn zoom-pct" id="mbZoomResetBtn" aria-label="Reset zoom to 100%">
                100%
              </button>
              <button type="button" className="zoom-btn" id="mbZoomInBtn" aria-label="Zoom in">
                +
              </button>
              <button type="button" className="zoom-btn" id="mbZoomFitBtn" aria-label="Fit tree to view">
                Fit
              </button>
            </div>
            <div className="style-toggle" id="mbExportControls" role="group" aria-label="Save tree as an image">
              <button type="button" className="style-btn" id="mbExportPngBtn" title="Save as PNG">
                <DownloadIcon /> PNG
              </button>
              <button type="button" className="style-btn" id="mbExportSvgBtn" title="Save as SVG">
                <DownloadIcon /> SVG
              </button>
            </div>
            <span className="badge" id="mbTreeBadge" />
          </div>
        </div>
        <div className="tree-area" id="mbCanvas" />
        <div className="tree-legend" id="mbTreeLegend" hidden>
          <span className="swatch">
            <span className="dot selected" /> Selected node
          </span>
          <span className="swatch">
            <span className="dot ccommand" /> C-commanded nodes
          </span>
          <span className="swatch">
            <span className="dot dominance" /> Dominated nodes
          </span>
        </div>
      </section>

      <footer>
        <div className="shortcuts">
          Drag a node onto its neighbor to merge, or between nodes to move it · <kbd>Esc</kbd> cancels ·{" "}
          <kbd>Tab</kbd>/<kbd>Enter</kbd> move through label and content fields · click a tree node to inspect it · drag the tree to
          pan, pinch or <kbd>Ctrl</kbd>+scroll to zoom
        </div>
      </footer>
    </div>
  );
}
