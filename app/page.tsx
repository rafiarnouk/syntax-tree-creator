"use client";

import { useState } from "react";
import TreeEditorApp from "@/components/TreeEditorApp";
import MergeBuilderApp from "@/components/MergeBuilderApp";
import ModeSwitch, { type BuilderMode } from "@/components/ModeSwitch";

export default function Home() {
  const [mode, setMode] = useState<BuilderMode>("topdown");

  return (
    <>
      <ModeSwitch mode={mode} onChange={setMode} />
      <TreeEditorApp hidden={mode !== "topdown"} />
      <MergeBuilderApp hidden={mode !== "bottomup"} />
    </>
  );
}
