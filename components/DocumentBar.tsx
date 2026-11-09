"use client";

import { useSessionState, useWorkspace } from "@/components/Workspace";
import { FileIcon, PencilIcon, PlusIcon, SaveIcon, SparkIcon } from "@/components/icons";
import { EXAMPLE_TREE } from "@/lib/tree-editor/editor";

const STATUS = {
  blank: null,
  new: { text: "Not saved", tone: "muted" },
  edited: { text: "Unsaved changes", tone: "warn" },
  saved: { text: "Saved", tone: "ok" },
} as const;

export default function DocumentBar() {
  const { save, start, rename } = useWorkspace();
  const { tree, status, failed } = useSessionState();
  const chip = failed ? { text: "Couldn't save", tone: "danger" } : STATUS[status];
  const named = Boolean(tree);

  return (
    <header className="doc-bar">
      <div className="doc-info">
        <button
          type="button"
          className={`doc-title${named ? "" : " untitled"}`}
          disabled={!named && status === "blank"}
          title={named ? "Rename this tree" : "Save and name this tree"}
          onClick={() => (tree ? rename(tree) : save())}
        >
          <FileIcon size={16} className="doc-title-icon" />
          <span className="doc-title-text">{tree?.title || "Untitled tree"}</span>
          <PencilIcon size={13} className="doc-title-edit" />
        </button>
        <span role="status" className="doc-status">
          {chip && (
            <span className={`status-chip ${chip.tone}`}>
              <span className="status-dot" />
              {chip.text}
            </span>
          )}
        </span>
      </div>
      <div className="doc-actions">
        <button className="btn ghost" type="button" title="Start a new, empty tree" onClick={() => start("", "")}>
          <PlusIcon size={15} />
          <span>New</span>
        </button>
        <button className="btn ghost" type="button" title="Load the example tree" onClick={() => start(EXAMPLE_TREE.source, EXAMPLE_TREE.sentence)}>
          <SparkIcon size={15} />
          <span>Example</span>
        </button>
        <button
          className="btn primary"
          id="saveBtn"
          type="button"
          disabled={status === "blank" || status === "saved"}
          title="Save this tree (⌘S or Ctrl+S)"
          onClick={save}
        >
          <SaveIcon size={15} />
          <span>Save</span>
        </button>
      </div>
    </header>
  );
}
