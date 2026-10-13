// Turns a live tree SVG into a standalone copy for PNG/SVG export: colors
// and fonts currently come from CSS custom properties and next/font's
// self-hosted stylesheets, neither of which exist once the SVG leaves this
// page (a downloaded .svg opened elsewhere, or the isolated <img> context
// used to rasterize the PNG) — so every value gets resolved and baked in,
// and any web font actually used gets embedded as base64 @font-face data.
// Without that last part the exported file references a font name nothing
// else can resolve and silently falls back to the system default.

export async function buildExportSvg(live: SVGSVGElement): Promise<SVGSVGElement> {
  const clone = live.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const liveEls = Array.from(live.querySelectorAll<SVGElement>("*"));
  const cloneEls = Array.from(clone.querySelectorAll<SVGElement>("*"));
  const fontFamilies = new Set<string>();
  liveEls.forEach((liveEl, i) => {
    const cloneEl = cloneEls[i];
    const cs = getComputedStyle(liveEl);
    const tag = liveEl.tagName.toLowerCase();
    if (tag === "text") {
      cloneEl.setAttribute("fill", cs.fill);
      cloneEl.setAttribute("font-family", cs.fontFamily);
      cloneEl.setAttribute("font-style", cs.fontStyle);
      cloneEl.setAttribute("font-weight", cs.fontWeight);
      cloneEl.setAttribute("font-size", cs.fontSize);
      cloneEl.removeAttribute("class");
      cloneEl.removeAttribute("id");
      cloneEl.removeAttribute("data-start");
      cloneEl.removeAttribute("data-end");
      fontFamilies.add(cs.fontFamily);
    } else if (tag === "line" || tag === "path" || tag === "polygon") {
      cloneEl.setAttribute("stroke", cs.stroke);
    } else if (
      tag === "rect" &&
      (liveEl.classList.contains("tree-node-highlight") ||
        liveEl.classList.contains("tree-c-command-highlight") ||
        liveEl.classList.contains("tree-dominance-highlight"))
    ) {
      cloneEl.setAttribute("fill", cs.fill);
      cloneEl.removeAttribute("class");
    }
  });

  const viewBox = (clone.getAttribute("viewBox") || "0 0 0 0").split(" ").map(Number);
  const w = viewBox[2] || 0;
  const h = viewBox[3] || 0;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", String(w));
  bgRect.setAttribute("height", String(h));
  bgRect.setAttribute("fill", bg);
  clone.insertBefore(bgRect, clone.firstChild);

  const fontCss = await buildEmbeddedFontCss(fontFamilies);
  if (fontCss) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = fontCss;
    clone.insertBefore(style, clone.firstChild);
  }

  return clone;
}

// Finds every @font-face rule (across same-origin stylesheets — next/font
// self-hosts its files, so this is always same-origin) whose family is
// actually used in the SVG, fetches the font file it points to, and
// re-declares it inline as a base64 data URL.
async function buildEmbeddedFontCss(families: Set<string>): Promise<string> {
  if (!families.size) return "";
  const wanted = new Set(Array.from(families).flatMap((f) => f.split(",").map((n) => n.trim().replace(/^["']|["']$/g, ""))));

  // A rule's `src: url(...)` is relative to the stylesheet it came from
  // (often something like "../media/xyz.woff2"), not to the page — so each
  // rule is paired with its sheet's own href to resolve that correctly.
  const faceRules: { rule: CSSFontFaceRule; baseHref: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet — can't inspect, skip it
    }
    const baseHref = sheet.href || document.baseURI;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) {
        const family = rule.style.getPropertyValue("font-family").replace(/^["']|["']$/g, "").trim();
        if (wanted.has(family)) faceRules.push({ rule, baseHref });
      }
    }
  }

  const declarations = await Promise.all(faceRules.map(({ rule, baseHref }) => embedFontFace(rule, baseHref)));
  return declarations.filter((d): d is string => !!d).join("\n");
}

async function embedFontFace(rule: CSSFontFaceRule, baseHref: string): Promise<string | null> {
  const src = rule.style.getPropertyValue("src");
  const match = /url\(["']?([^"')]+)["']?\)/.exec(src);
  if (!match) return null;
  try {
    const absoluteUrl = new URL(match[1], baseHref).href;
    const res = await fetch(absoluteUrl);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    const format = /\.woff2(\?|$)/.test(match[1]) ? "woff2" : /\.woff(\?|$)/.test(match[1]) ? "woff" : "truetype";
    const family = rule.style.getPropertyValue("font-family");
    const weight = rule.style.getPropertyValue("font-weight") || "normal";
    const style = rule.style.getPropertyValue("font-style") || "normal";
    const unicodeRange = rule.style.getPropertyValue("unicode-range");
    return (
      `@font-face{font-family:${family};font-weight:${weight};font-style:${style};` +
      (unicodeRange ? `unicode-range:${unicodeRange};` : "") +
      `src:url(data:font/${format};base64,${b64}) format('${format}');}`
    );
  } catch {
    return null; // export still works, just without that weight/subset embedded
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
