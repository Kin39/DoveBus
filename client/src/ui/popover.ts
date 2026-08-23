import { el } from "./dom.js";

export interface PopoverOptions {
  /** The button that opens it. Focus comes back here when it closes. */
  readonly trigger: HTMLButtonElement;
  /** The element it is positioned inside — the field, which is `position: relative`. */
  readonly anchor: HTMLElement;
  readonly label: string;
}

/**
 * A small panel hung off a field, and the four behaviours one owes a reader.
 *
 * It closes on Escape, on a click outside, and on a choice; focus goes into it
 * when it opens and back to the button that opened it when it closes; the button
 * says whether it is open. That is the whole contract — there is no focus trap
 * and no backdrop, because this is a popover attached to a control and not a
 * modal: the sheet behind it stays scrollable and the map behind that stays
 * usable, which is the point of not having replaced the panel with a dialog.
 */
export class Popover {
  readonly element: HTMLElement;
  readonly #trigger: HTMLButtonElement;
  #open = false;
  readonly #onOutside: (event: Event) => void;
  readonly #onKey: (event: KeyboardEvent) => void;

  constructor(options: PopoverOptions) {
    this.#trigger = options.trigger;
    this.element = el("div", {
      class: "picker",
      role: "dialog",
      "aria-label": options.label,
      hidden: true,
    });
    options.anchor.append(this.element);

    this.#trigger.setAttribute("aria-haspopup", "dialog");
    this.#trigger.setAttribute("aria-expanded", "false");
    this.#trigger.addEventListener("click", () => this.toggle());

    // `pointerdown` rather than `click`: a click that starts inside the popover
    // and ends outside it — a scroll flick on the hour column, on a phone — must
    // not be read as a click outside.
    this.#onOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (this.element.contains(target) || this.#trigger.contains(target)) return;
      this.close({ restoreFocus: false });
    };
    this.#onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.#open) {
        event.stopPropagation();
        this.close();
      }
    };
  }

  get isOpen(): boolean {
    return this.#open;
  }

  toggle(): void {
    if (this.#open) this.close();
    else this.open();
  }

  open(): void {
    if (this.#open) return;
    this.#open = true;
    this.element.hidden = false;
    this.#trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", this.#onOutside, true);
    document.addEventListener("keydown", this.#onKey, true);

    const first = this.element.querySelector<HTMLElement>("[data-selected='true'], button");
    first?.focus();
    first?.scrollIntoView({ block: "center" });
  }

  close({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    if (!this.#open) return;
    this.#open = false;
    this.element.hidden = true;
    this.#trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.#onOutside, true);
    document.removeEventListener("keydown", this.#onKey, true);
    if (restoreFocus) this.#trigger.focus();
  }
}
