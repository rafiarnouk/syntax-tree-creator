"use client";

import { memo, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSessionState, useWorkspace } from "@/components/Workspace";
import { ClockIcon, DownloadIcon, LogoIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from "@/components/icons";
import { drawSource } from "@/lib/tree-editor/tree-render";
import { treeStore, type SavedTree } from "@/lib/tree-editor/tree-store";

type SortKey = "updatedAt" | "createdAt";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "updatedAt", label: "Last edited" },
  { key: "createdAt", label: "Created" },
];

function formatDate(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `today at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "yesterday";
  const year = date.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year });
}

function downloadTrees(trees: SavedTree[]): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(trees, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `syntax-trees-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TreePreview = memo(function TreePreview({ id, source }: { id: string; source: string }) {
  const drawing = drawSource(source, `${id}-`);
  if (!drawing) return <span className="tree-card-empty">Unfinished tree</span>;
  return <svg className="tree-card-svg" viewBox={`0 0 ${drawing.w} ${drawing.h}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: drawing.markup }} />;
});

export default function TreeGallery() {
  const router = useRouter();
  const { session, ask, open, rename, start } = useWorkspace();
  const { tree: openTree } = useSessionState();
  const [trees, setTrees] = useState<SavedTree[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updatedAt");

  useEffect(() => {
    // Previews measure text, so they wait for the web font.
    Promise.all([treeStore.list(), document.fonts?.ready]).then(
      ([list]) => setTrees(list),
      () => setFailed(true),
    );
  }, []);

  const startNew = async () => {
    if (await start("", "")) router.push("/");
  };

  const renameTree = async (tree: SavedTree) => {
    const updated = await rename(tree);
    if (updated) setTrees((list) => list?.map((t) => (t.id === tree.id ? updated : t)) ?? null);
  };

  const remove = async (tree: SavedTree) => {
    const confirmed = await ask({
      title: "Delete this tree?",
      message: `“${tree.title}” will be permanently deleted.`,
      confirm: "Delete",
      danger: true,
    });
    if (confirmed === null) return;
    await treeStore.delete(tree.id);
    setTrees((list) => list?.filter((t) => t.id !== tree.id) ?? null);
    await session.refresh();
  };

  const search = query.trim().toLowerCase();
  const shown = (trees ?? [])
    .filter((t) => `${t.title} ${t.sentence}`.toLowerCase().includes(search))
    .sort((a, b) => b[sort] - a[sort]);
  const count = trees?.length ?? 0;

  return (
    <div className="app gallery">
      <header className="page-head">
        <div>
          <h1 className="page-title">My trees</h1>
          <p className="page-sub">
            {trees && count > 0 && `${count} ${count === 1 ? "tree" : "trees"} · `}Saved in this browser only
          </p>
        </div>
        <div className="doc-actions">
          {count > 0 && (
            <button
              className="icon-btn"
              type="button"
              aria-label="Download all trees"
              title="Download all trees (JSON backup)"
              onClick={() => trees && downloadTrees(trees)}
            >
              <DownloadIcon size={17} />
            </button>
          )}
          <button className="btn primary" type="button" onClick={startNew}>
            <PlusIcon size={15} />
            <span>New tree</span>
          </button>
        </div>
      </header>

      {failed ? (
        <div className="gallery-empty">
          <h2>Your saved trees couldn&apos;t be read</h2>
          <p>The data in this browser&apos;s storage isn&apos;t in a format this app understands.</p>
        </div>
      ) : trees === null ? null : count === 0 ? (
        <div className="gallery-empty">
          <span className="gallery-empty-mark">
            <LogoIcon size={30} />
          </span>
          <h2>No saved trees yet</h2>
          <p>
            Build a tree in the editor and press <b>Save</b>. It&apos;ll show up here.
          </p>
          <button className="btn primary" type="button" onClick={startNew}>
            <PlusIcon size={15} />
            <span>Start a tree</span>
          </button>
        </div>
      ) : (
        <>
          <div className="gallery-tools">
            <label className="search-field">
              <SearchIcon size={15} />
              <input
                type="search"
                placeholder="Search titles and sentences"
                aria-label="Search trees"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="segmented" role="group" aria-label="Sort by">
              {SORTS.map(({ key, label }) => (
                <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="gallery-empty">
              <h2>No matches</h2>
              <p>No trees match “{query.trim()}”.</p>
            </div>
          ) : (
            <ul className="gallery-grid">
              {shown.map((tree) => (
                <li className="tree-card" key={tree.id}>
                  <button
                    type="button"
                    className="tree-card-open"
                    onClick={async () => {
                      if (await open(tree)) router.push("/");
                    }}
                  >
                    <span className="tree-card-preview">
                      <TreePreview id={tree.id} source={tree.source} />
                    </span>
                    <span className="tree-card-body">
                      <span className="tree-card-title">{tree.title}</span>
                      {tree.sentence.trim() && tree.sentence !== tree.title && <span className="tree-card-sentence">{tree.sentence}</span>}
                      <span className="tree-card-meta">
                        <ClockIcon size={12} />
                        {sort === "updatedAt" ? `Edited ${formatDate(tree.updatedAt)}` : `Created ${formatDate(tree.createdAt)}`}
                      </span>
                    </span>
                  </button>
                  {tree.id === openTree?.id && <span className="tree-card-badge">In editor</span>}
                  <div className="tree-card-actions">
                    <button type="button" className="icon-btn small" aria-label={`Rename “${tree.title}”`} title="Rename" onClick={() => renameTree(tree)}>
                      <PencilIcon size={14} />
                    </button>
                    <button type="button" className="icon-btn small danger" aria-label={`Delete “${tree.title}”`} title="Delete" onClick={() => remove(tree)}>
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
