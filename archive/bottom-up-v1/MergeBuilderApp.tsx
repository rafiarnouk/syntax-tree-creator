"use client";

import { useEffect, useRef } from "react";
import { MergeBuilder } from "@/lib/tree-editor/merge-builder";
import { DownloadIcon, MoonIcon, SunIcon } from "@/components/icons";

// Same mounting pattern as TreeEditorApp — MergeBuilder is a vanilla DOM
// controller, not a React component, for the same reasons (see README.md).
export default function MergeBuilderApp({ hidden, onSwitchMode }: { hidden: boolean; onSwitchMode: () => void }) {
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
            Build a tree bottom-up: list your leaves and their categories, then click two neighboring nodes and{" "}
            <b>Merge</b> them, again and again, until one remains.
          </p>
        </div>
        <div className="header-controls">
          <div className="style-toggle" role="group" aria-label="Builder mode">
            <button type="button" className="style-btn" onClick={onSwitchMode}>
              Top-down
            </button>
            <button type="button" className="style-btn active" disabled>
              Bottom-up
            </button>
          </div>
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

      <div className="workspace">
        <section className="panel">
          <div className="panel-head">
            <span className="label" id="mbLeftLabel">
              Leaves
            </span>
            <div className="tree-controls">
              <span className="badge" id="mbLeftBadge" />
            </div>
          </div>
          <div className="mb-left-body" id="mbLeftBody" />
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="label">Tree</span>
            <div className="tree-controls">
              <button type="button" className="zoom-btn" id="mbUndoBtn" title="Undo last merge">
                Undo
              </button>
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
          <div className="mb-merge-bar" id="mbMergeBar" hidden />
          <div className="tree-area" id="mbCanvas" />
        </section>
      </div>

      <footer>
        <div className="shortcuts">
          Click a node to pick it, click its left or right neighbor to pick a pair, then type the new node&apos;s label and{" "}
          <b>Merge</b> · <kbd>Esc</kbd> clears the current pick
        </div>
      </footer>
    </div>
  );
}
