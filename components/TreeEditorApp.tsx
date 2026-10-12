"use client";

import { useEffect, useRef } from "react";
import { TreeEditor } from "@/lib/tree-editor/editor";

// TreeEditor is a vanilla DOM controller, not a React component — it owns
// this subtree's DOM directly (overlay/gutter/tree innerHTML, cursor
// position) the same way a charting or editor library would. This wrapper
// just mounts it once; the `mounted` guard is needed because React's Strict
// Mode runs effects twice in development, which would otherwise attach every
// event listener twice.
export default function TreeEditorApp() {
  const rootRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!rootRef.current || mounted.current) return;
    mounted.current = true;
    new TreeEditor(rootRef.current);
  }, []);

  return (
    <div className="app" ref={rootRef}>
      <header>
        <div>
          <h1>Syntax Tree Creator</h1>
          <p className="tagline">
            Build a tree top-down: type <kbd>[</kbd> to open a node, fill in its label and content, press <kbd>Tab</kbd> to move to the
            next slot.
          </p>
        </div>
        <div className="header-controls">
          <div className="style-toggle" id="themeToggle" role="group" aria-label="Color theme">
            <button type="button" className="style-btn" data-theme-choice="light">
              Light
            </button>
            <button type="button" className="style-btn" data-theme-choice="dark">
              Dark
            </button>
          </div>
          <button className="reset-btn" id="resetBtn" type="button">
            Load example
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="panel">
          <div className="panel-head">
            <span className="label">Bracket notation</span>
            <span className="badge" id="charCount" />
          </div>
          <div className="ref-row">
            <label htmlFor="refSentence" className="ref-label">
              Reference sentence
            </label>
            <input type="text" id="refSentence" className="ref-input" placeholder="e.g. The dog chased the cat." autoComplete="off" />
          </div>
          <div className="editor-wrap">
            <div className="gutter" id="gutter" />
            <div className="editor-scroll" id="editorScroll">
              <pre id="overlay" aria-hidden="true" />
              <textarea id="editor" spellCheck={false} autoCapitalize="off" autoComplete="off" />
              <div className="autocomplete" id="autocomplete" hidden />
            </div>
          </div>
          <div className="status-line" id="statusLine">
            Line 1, Col 1
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="label">Tree</span>
            <div className="tree-controls">
              <div className="style-toggle" id="styleToggle" role="group" aria-label="Tree style">
                <button type="button" className="style-btn" data-style="simple">
                  Simple
                </button>
                <button type="button" className="style-btn" data-style="fancy">
                  Fancy
                </button>
              </div>
              <div className="zoom-toggle" id="zoomControls" role="group" aria-label="Zoom">
                <button type="button" className="zoom-btn" id="zoomOutBtn" aria-label="Zoom out">
                  −
                </button>
                <button type="button" className="zoom-btn zoom-pct" id="zoomResetBtn" aria-label="Reset zoom to 100%">
                  100%
                </button>
                <button type="button" className="zoom-btn" id="zoomInBtn" aria-label="Zoom in">
                  +
                </button>
                <button type="button" className="zoom-btn" id="zoomFitBtn" aria-label="Fit tree to view">
                  Fit
                </button>
              </div>
              <span className="badge" id="treeBadge" />
            </div>
          </div>
          <div className="tree-area" id="treeArea" />
        </section>
      </div>

      <footer>
        <div className="legend" id="legend" />
        <div className="shortcuts">
          <kbd>[</kbd> opens a node · <kbd>Tab</kbd>/<kbd>Enter</kbd> advance, collapsing a finished leaf onto one line · ▾/▸ in the gutter
          folds/unfolds a branch · click a tree node to jump to it
        </div>
      </footer>
    </div>
  );
}
