export const THEME_KEY = "syntax-tree-creator-theme";

// Each builder has its own Light/Dark toggle but the theme is page-wide, so
// every toggle mirrors the root's data-theme rather than keeping its own copy.
export function bindThemeToggle(toggleEl: HTMLElement): void {
  const root = document.documentElement;
  if (!root.hasAttribute("data-theme")) {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* private browsing / storage disabled */
    }
    root.setAttribute("data-theme", saved === "dark" ? "dark" : "light");
  }

  const sync = () => {
    const current = root.getAttribute("data-theme");
    toggleEl.querySelectorAll<HTMLButtonElement>(".style-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-theme-choice") === current);
    });
  };
  sync();
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  toggleEl.addEventListener("click", (e) => {
    const choice = (e.target as HTMLElement).closest<HTMLButtonElement>(".style-btn")?.getAttribute("data-theme-choice");
    if (choice !== "light" && choice !== "dark") return;
    root.setAttribute("data-theme", choice);
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* private browsing / storage disabled */
    }
  });
}
