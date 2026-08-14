/** Where the sheet is allowed to rest, as a fraction of viewport height. */
export type SheetDetent = "peek" | "half" | "full";

const DETENT_FRACTION: Record<SheetDetent, number> = {
  peek: 0.24,
  half: 0.56,
  full: 0.92,
};

/** A drag shorter than this is a tap that wobbled. */
const TAP_SLOP_PX = 8;
/** Past this speed the gesture's direction decides the detent, not its distance. */
const FLICK_VELOCITY = 0.5;

export interface SheetOptions {
  readonly element: HTMLElement;
  readonly handle: HTMLElement;
  readonly scroller: HTMLElement;
  readonly onHeightChange: (heightPx: number) => void;
}

/**
 * The bottom sheet.
 *
 * The whole interface lives here because the map owns the screen and a thumb
 * owns the bottom third of it. Height is driven directly rather than with a
 * transform so the content inside can scroll against a real box, and the drag
 * is written on pointer events so a mouse, a finger and a stylus are one path.
 */
export class BottomSheet {
  readonly #element: HTMLElement;
  readonly #scroller: HTMLElement;
  readonly #onHeightChange: (heightPx: number) => void;

  #detent: SheetDetent = "half";
  #heightPx = 0;
  #dragStartY = 0;
  #dragStartHeight = 0;
  #lastY = 0;
  #lastMoveAt = 0;
  #velocity = 0;
  #dragging = false;
  #pointerId: number | null = null;

  constructor(options: SheetOptions) {
    this.#element = options.element;
    this.#scroller = options.scroller;
    this.#onHeightChange = options.onHeightChange;

    this.#bindDrag(options.handle);
    // The handle is a real button: a sheet that only responds to dragging is
    // unusable with a keyboard and invisible to a screen reader.
    options.handle.addEventListener("click", () => {
      if (this.#dragging) return;
      this.snapTo(this.#detent === "full" ? "half" : this.#detent === "half" ? "peek" : "full");
    });
    options.handle.addEventListener("keydown", (event) => this.#onHandleKey(event));

    window.addEventListener("resize", () => this.snapTo(this.#detent, { animate: false }));
    this.snapTo("half", { animate: false });
  }

  get detent(): SheetDetent {
    return this.#detent;
  }

  get heightPx(): number {
    return this.#heightPx;
  }

  snapTo(detent: SheetDetent, options: { animate?: boolean } = {}): void {
    const animate = options.animate ?? true;
    this.#detent = detent;
    this.#element.dataset.detent = detent;
    this.#setHeight(DETENT_FRACTION[detent] * window.innerHeight, { animate });
    // Only the fully open sheet scrolls its own content; below that a drag on
    // the body should move the sheet, not the list inside it.
    this.#scroller.style.overflowY = detent === "peek" ? "hidden" : "auto";
    if (detent !== "full") this.#scroller.scrollTop = 0;
  }

  /** Opens far enough to show what just arrived, without covering the map. */
  revealContent(): void {
    if (this.#detent === "peek") this.snapTo("half");
  }

  #setHeight(px: number, options: { animate?: boolean } = {}): void {
    const min = DETENT_FRACTION.peek * window.innerHeight * 0.6;
    const max = DETENT_FRACTION.full * window.innerHeight;
    const height = Math.max(min, Math.min(max, px));

    this.#element.style.transition = options.animate ? "height 340ms var(--ease-sheet)" : "none";
    this.#element.style.height = `${height}px`;
    this.#heightPx = height;
    this.#onHeightChange(height);
  }

  #bindDrag(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (event) => {
      this.#pointerId = event.pointerId;
      this.#dragStartY = event.clientY;
      this.#lastY = event.clientY;
      this.#lastMoveAt = event.timeStamp;
      this.#dragStartHeight = this.#heightPx;
      this.#velocity = 0;
      this.#dragging = false;
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event) => {
      if (this.#pointerId !== event.pointerId) return;
      const travelled = this.#dragStartY - event.clientY;
      if (!this.#dragging && Math.abs(travelled) < TAP_SLOP_PX) return;
      this.#dragging = true;

      const elapsed = Math.max(1, event.timeStamp - this.#lastMoveAt);
      this.#velocity = (this.#lastY - event.clientY) / elapsed;
      this.#lastY = event.clientY;
      this.#lastMoveAt = event.timeStamp;

      this.#setHeight(this.#dragStartHeight + travelled, { animate: false });
    });

    const end = (event: PointerEvent): void => {
      if (this.#pointerId !== event.pointerId) return;
      this.#pointerId = null;
      if (!this.#dragging) return;
      this.snapTo(this.#resolveDetent());
      // Cleared after the snap so the click handler can tell a drag from a tap.
      requestAnimationFrame(() => {
        this.#dragging = false;
      });
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  /** A flick goes one detent that way; a slow drag lands on whatever is nearest. */
  #resolveDetent(): SheetDetent {
    const order: SheetDetent[] = ["peek", "half", "full"];
    if (Math.abs(this.#velocity) > FLICK_VELOCITY) {
      const index = order.indexOf(this.#detent);
      const next = index + (this.#velocity > 0 ? 1 : -1);
      return order[Math.max(0, Math.min(order.length - 1, next))] ?? this.#detent;
    }

    const fraction = this.#heightPx / window.innerHeight;
    return order.reduce((closest, detent) =>
      Math.abs(DETENT_FRACTION[detent] - fraction) < Math.abs(DETENT_FRACTION[closest] - fraction)
        ? detent
        : closest,
    );
  }

  #onHandleKey(event: KeyboardEvent): void {
    const order: SheetDetent[] = ["peek", "half", "full"];
    const index = order.indexOf(this.#detent);
    if (event.key === "ArrowUp") {
      event.preventDefault();
      this.snapTo(order[Math.min(order.length - 1, index + 1)] ?? "full");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.snapTo(order[Math.max(0, index - 1)] ?? "peek");
    }
  }
}
