"use client";

export type BuilderMode = "topdown" | "bottomup";

export default function ModeSwitch({ mode, onChange }: { mode: BuilderMode; onChange: (mode: BuilderMode) => void }) {
  return (
    <div className="mode-switch-wrap">
      <div className="mode-switch" role="tablist" aria-label="Builder mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "topdown"}
          className={`mode-switch-tab${mode === "topdown" ? " active" : ""}`}
          onClick={() => onChange("topdown")}
        >
          <span className="mode-switch-title">Top-down</span>
          <span className="mode-switch-desc">Type bracket notation, guided slot by slot</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "bottomup"}
          className={`mode-switch-tab${mode === "bottomup" ? " active" : ""}`}
          onClick={() => onChange("bottomup")}
        >
          <span className="mode-switch-title">Bottom-up</span>
          <span className="mode-switch-desc">Merge leaf chips into bigger nodes</span>
        </button>
      </div>
    </div>
  );
}
