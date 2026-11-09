"use client";

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import MergeBuilderApp from "@/components/MergeBuilderApp";
import NavBar, { type BuilderMode } from "@/components/NavBar";
import PromptDialog, { type PromptRequest } from "@/components/PromptDialog";
import TreeEditorApp from "@/components/TreeEditorApp";
import type { TreeEditor } from "@/lib/tree-editor/editor";
import { TreeSession } from "@/lib/tree-editor/tree-session";
import { treeStore, type SavedTree } from "@/lib/tree-editor/tree-store";

interface WorkspaceActions {
  session: TreeSession;
  ask: (request: PromptRequest) => Promise<string | null>;
  save: () => Promise<void>;
  // Resolves with the renamed tree, or null if cancelled.
  rename: (tree: SavedTree) => Promise<SavedTree | null>;
  // Each resolves false if the user chose to keep their unsaved work.
  open: (tree: SavedTree) => Promise<boolean>;
  start: (source: string, sentence: string) => Promise<boolean>;
}

const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useWorkspace(): WorkspaceActions {
  const actions = useContext(WorkspaceContext);
  if (!actions) throw new Error("useWorkspace needs a <Workspace> above it");
  return actions;
}

export function useSessionState() {
  const { session } = useWorkspace();
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}

// Lives in the root layout so both builders stay mounted, and keep their work,
// while another route such as the gallery is showing.
export default function Workspace({ children }: { children: React.ReactNode }) {
  const inBuilder = usePathname() === "/";
  const [mode, setMode] = useState<BuilderMode>("topdown");
  const [session] = useState(() => new TreeSession(treeStore));
  const [prompt, setPrompt] = useState<{ request: PromptRequest; resolve: (result: string | null) => void } | null>(null);

  const ask = useCallback(
    (request: PromptRequest) => new Promise<string | null>((resolve) => setPrompt({ request, resolve })),
    [],
  );

  const actions = useMemo<WorkspaceActions>(() => {
    const discardOk = async () =>
      !session.hasUnsavedWork ||
      (await ask({
        title: "Discard unsaved changes?",
        message: "The tree in the editor has changes that haven't been saved.",
        confirm: "Discard",
        danger: true,
      })) !== null;

    return {
      session,
      ask,
      async save() {
        if (session.getState().tree) return session.save();
        const title = await ask({ title: "Save tree", value: session.suggestedTitle(), label: "Title", confirm: "Save" });
        if (title !== null) await session.save(title.trim());
      },
      async rename(tree) {
        const title = (await ask({ title: "Rename tree", label: "Title", value: tree.title, confirm: "Rename" }))?.trim();
        if (!title || title === tree.title) return null;
        const updated = await treeStore.update(tree.id, { title });
        await session.refresh();
        return updated;
      },
      async open(tree) {
        const reopening = tree.id === session.getState().tree?.id;
        if (!reopening && !(await discardOk())) return false;
        session.open(tree);
        setMode("topdown");
        return true;
      },
      async start(source, sentence) {
        if (!(await discardOk())) return false;
        session.start(source, sentence);
        setMode("topdown");
        return true;
      },
    };
  }, [session, ask]);

  const attach = useCallback((editor: TreeEditor) => void session.attach(editor), [session]);

  return (
    <WorkspaceContext.Provider value={actions}>
      <NavBar mode={mode} onModeChange={setMode} />
      <TreeEditorApp hidden={!inBuilder || mode !== "topdown"} onReady={attach} />
      <MergeBuilderApp hidden={!inBuilder || mode !== "bottomup"} />
      {children}
      {prompt && (
        <PromptDialog
          request={prompt.request}
          onClose={(result) => {
            prompt.resolve(result);
            setPrompt(null);
          }}
        />
      )}
    </WorkspaceContext.Provider>
  );
}
