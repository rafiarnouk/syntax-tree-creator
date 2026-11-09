import type { Metadata } from "next";
import TreeGallery from "@/components/TreeGallery";

export const metadata: Metadata = { title: "My trees · Syntax Tree Creator" };

export default function TreesPage() {
  return <TreeGallery />;
}
