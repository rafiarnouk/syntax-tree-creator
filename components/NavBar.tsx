"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BracketsIcon, GridIcon, LogoIcon, MergeIcon } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";

export type BuilderMode = "topdown" | "bottomup";

const MODES = [
  { mode: "topdown", label: "Top-down", hint: "Type bracket notation, guided slot by slot", Icon: BracketsIcon },
  { mode: "bottomup", label: "Bottom-up", hint: "Merge leaf nodes into bigger ones", Icon: MergeIcon },
] as const;

export default function NavBar({ mode, onModeChange }: { mode: BuilderMode; onModeChange: (mode: BuilderMode) => void }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="navbar" aria-label="Main">
      <div className="navbar-inner">
        <Link href="/" className="brand" aria-label="Syntax Tree Creator">
          <LogoIcon className="brand-mark" />
          <span className="brand-name">Syntax Tree Creator</span>
        </Link>
        <div className="nav-tabs">
          {MODES.map(({ mode: key, label, hint, Icon }) => (
            <button
              key={key}
              type="button"
              className="nav-tab"
              title={hint}
              aria-current={pathname === "/" && mode === key ? "page" : undefined}
              onClick={() => {
                onModeChange(key);
                if (pathname !== "/") router.push("/");
              }}
            >
              <Icon size={15} />
              <span className="nav-tab-label">{label}</span>
            </button>
          ))}
          <span className="nav-sep" aria-hidden="true" />
          <Link href="/trees" className="nav-tab" title="Your saved trees" aria-current={pathname === "/trees" ? "page" : undefined}>
            <GridIcon size={15} />
            <span className="nav-tab-label">My trees</span>
          </Link>
        </div>
        <div className="navbar-end">
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
