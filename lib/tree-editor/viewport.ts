// Zoom and panning for a tree panel: drag to pan, pinch (or Ctrl+scroll) to
// zoom around the pointer, plus the -/100%/+/Fit buttons. While the whole
// tree is in view it stays in view as the tree grows, zooming out on its own
// (and back in when it shrinks, never past the zoom the user last picked).

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
const PAN_THRESHOLD = 4;
const AREA_PAD = 20; // .tree-area's own padding, both sides

export interface ZoomControls {
  out: HTMLButtonElement;
  in: HTMLButtonElement;
  reset: HTMLButtonElement;
  fit: HTMLButtonElement;
}

interface Point {
  x: number;
  y: number;
}

// Safari's trackpad pinch; not in lib.dom.
interface GestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export class TreeViewport {
  private zoom = 1;
  private preferred = 1;
  private following = true;
  private svg: SVGSVGElement | null = null;
  private w = 0;
  private h = 0;

  private pan: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  private suppressClick = false;
  private gestureZoom: number | null = null;
  private pinch: { dist: number; zoom: number } | null = null;

  constructor(
    private area: HTMLElement,
    private controls: ZoomControls,
  ) {
    controls.out.addEventListener("click", () => this.setZoom(this.zoom / ZOOM_STEP));
    controls.in.addEventListener("click", () => this.setZoom(this.zoom * ZOOM_STEP));
    controls.reset.addEventListener("click", () => this.setZoom(1));
    controls.fit.addEventListener("click", () => this.fit());
    this.bindGestures();
    new ResizeObserver(() => this.syncPannable()).observe(area);
    this.syncButtons();
  }

  get scale(): number {
    return this.zoom;
  }

  // Called after every render, with the tree's size at 100%.
  show(svg: SVGSVGElement, w: number, h: number): void {
    this.svg = svg;
    this.w = w;
    this.h = h;
    const fit = this.fitZoom();
    if (this.following && fit !== null) this.zoom = clamp(Math.min(this.preferred, fit));
    this.apply();
  }

  clear(): void {
    this.svg = null;
    this.syncPannable();
  }

  private fitZoom(): number | null {
    const availW = this.area.clientWidth - AREA_PAD;
    const availH = this.area.clientHeight - AREA_PAD;
    if (availW <= 0 || availH <= 0 || !this.w || !this.h) return null;
    return Math.min(availW / this.w, availH / this.h);
  }

  private fit(): void {
    const fit = this.fitZoom();
    if (fit === null) return;
    this.zoom = this.preferred = clamp(fit);
    this.following = true;
    this.apply();
  }

  private setZoom(z: number, anchor?: Point): void {
    const next = clamp(z);
    if (next === this.zoom) return;
    const svg = this.svg;
    if (!svg) {
      this.zoom = this.preferred = next;
      this.syncButtons();
      return;
    }
    const areaRect = this.area.getBoundingClientRect();
    const at = anchor ?? { x: areaRect.left + areaRect.width / 2, y: areaRect.top + areaRect.height / 2 };
    const before = svg.getBoundingClientRect();
    const px = (at.x - before.left) / this.zoom;
    const py = (at.y - before.top) / this.zoom;

    this.zoom = this.preferred = next;
    const fit = this.fitZoom();
    this.following = fit === null || next <= fit + 1e-3;
    this.apply();

    const after = svg.getBoundingClientRect();
    this.area.scrollLeft += after.left + px * next - at.x;
    this.area.scrollTop += after.top + py * next - at.y;
  }

  private apply(): void {
    if (this.svg) {
      this.svg.setAttribute("width", String(this.w * this.zoom));
      this.svg.setAttribute("height", String(this.h * this.zoom));
    }
    this.syncButtons();
    this.syncPannable();
  }

  private syncButtons(): void {
    this.controls.reset.textContent = Math.round(this.zoom * 100) + "%";
    this.controls.out.disabled = this.zoom <= ZOOM_MIN;
    this.controls.in.disabled = this.zoom >= ZOOM_MAX;
  }

  private syncPannable(): void {
    const a = this.area;
    a.classList.toggle("pannable", !!this.svg && (a.scrollWidth > a.clientWidth + 1 || a.scrollHeight > a.clientHeight + 1));
  }

  private bindGestures(): void {
    const a = this.area;

    a.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey || this.gestureZoom !== null) return;
        e.preventDefault();
        const dy = Math.max(-25, Math.min(25, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
        this.setZoom(this.zoom * Math.exp(-dy * 0.01), { x: e.clientX, y: e.clientY });
      },
      { passive: false },
    );

    a.addEventListener("gesturestart", (e) => {
      e.preventDefault();
      this.gestureZoom = this.zoom;
    });
    a.addEventListener("gesturechange", (e) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (this.gestureZoom !== null) this.setZoom(this.gestureZoom * g.scale, { x: g.clientX, y: g.clientY });
    });
    a.addEventListener("gestureend", (e) => {
      e.preventDefault();
      this.gestureZoom = null;
    });

    // Touch already scrolls natively; only mouse/pen drags are turned into pans.
    a.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0 || !this.svg) return;
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: a.scrollLeft, top: a.scrollTop, moved: false };
      window.addEventListener("pointermove", this.onPanMove);
      window.addEventListener("pointerup", this.onPanEnd);
      window.addEventListener("pointercancel", this.onPanEnd);
    });

    a.addEventListener(
      "click",
      (e) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true,
    );

    a.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 2) {
          this.pinch = null;
          return;
        }
        e.preventDefault();
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        if (!this.pinch) this.pinch = { dist, zoom: this.zoom };
        else this.setZoom((this.pinch.zoom * dist) / this.pinch.dist, { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });
      },
      { passive: false },
    );
    a.addEventListener("touchend", () => (this.pinch = null));
  }

  private onPanMove = (e: PointerEvent): void => {
    const p = this.pan;
    if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      p.moved = true;
      this.area.classList.add("panning");
    }
    this.area.scrollLeft = p.left - dx;
    this.area.scrollTop = p.top - dy;
  };

  private onPanEnd = (e: PointerEvent): void => {
    const p = this.pan;
    if (!p || e.pointerId !== p.id) return;
    this.pan = null;
    window.removeEventListener("pointermove", this.onPanMove);
    window.removeEventListener("pointerup", this.onPanEnd);
    window.removeEventListener("pointercancel", this.onPanEnd);
    this.area.classList.remove("panning");
    if (p.moved) {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
    }
  };
}
