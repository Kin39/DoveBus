import { clear, debounce, el } from "./dom.js";

/** Long enough to be worth asking about, short enough for "SI3". */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 180;

export interface Suggestion<T> {
  readonly value: T;
  readonly primary: string;
  readonly secondary?: string;
}

export interface AutocompleteOptions<T> {
  readonly input: HTMLInputElement;
  readonly list: HTMLElement;
  readonly fetch: (query: string, signal: AbortSignal) => Promise<readonly Suggestion<T>[]>;
  readonly onChoose: (suggestion: Suggestion<T>) => void;
  readonly emptyMessage: string;
}

/**
 * A combobox over one of the API's catalogue endpoints.
 *
 * Built on the ARIA combobox pattern rather than a `<datalist>` because the
 * options carry a second line (a line's full route, a comune's province) that a
 * native list cannot show, and because the keyboard path has to work identically
 * on a phone's software keyboard and a desktop.
 */
export class Autocomplete<T> {
  readonly #options: AutocompleteOptions<T>;
  #suggestions: readonly Suggestion<T>[] = [];
  #active = -1;
  #controller: AbortController | null = null;
  #chosen: T | null = null;

  constructor(options: AutocompleteOptions<T>) {
    this.#options = options;
    const { input, list } = options;

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", list.id);
    input.autocomplete = "off";
    list.setAttribute("role", "listbox");

    const run = debounce((value: string) => void this.#search(value), DEBOUNCE_MS);
    input.addEventListener("input", () => {
      this.#chosen = null;
      run(input.value.trim());
    });
    input.addEventListener("keydown", (event) => this.#onKeyDown(event));
    input.addEventListener("focus", () => {
      if (input.value.trim().length >= MIN_QUERY_LENGTH && this.#chosen === null) {
        run(input.value.trim());
      }
    });
    // A blur that lands on an option must not close the list before the click
    // registers, so the close is deferred by one frame.
    input.addEventListener("blur", () => {
      window.setTimeout(() => this.close(), 140);
    });
  }

  get chosen(): T | null {
    return this.#chosen;
  }

  /** Fills the field from outside — used to restore a search from the URL. */
  setValue(text: string, value: T | null): void {
    this.#options.input.value = text;
    this.#chosen = value;
    this.close();
  }

  close(): void {
    this.#suggestions = [];
    this.#active = -1;
    clear(this.#options.list);
    this.#options.list.hidden = true;
    this.#options.input.setAttribute("aria-expanded", "false");
    this.#options.input.removeAttribute("aria-activedescendant");
  }

  async #search(value: string): Promise<void> {
    if (value.length < MIN_QUERY_LENGTH) {
      this.close();
      return;
    }
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;

    try {
      const suggestions = await this.#options.fetch(value, controller.signal);
      if (controller.signal.aborted) return;
      this.#suggestions = suggestions;
      this.#active = -1;
      this.#render();
    } catch {
      // A failed suggestion lookup is not worth interrupting typing over; the
      // search button reports for real if the service is actually down.
      if (!controller.signal.aborted) this.close();
    }
  }

  #render(): void {
    const { list, input } = this.#options;
    clear(list);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");

    if (this.#suggestions.length === 0) {
      list.append(el("li", { class: "combo__empty", text: this.#options.emptyMessage }));
      return;
    }

    this.#suggestions.forEach((suggestion, index) => {
      const option = el("li", {
        class: "combo__option",
        role: "option",
        id: `${list.id}-option-${index}`,
        "aria-selected": index === this.#active,
      });
      option.append(el("span", { class: "combo__primary", text: suggestion.primary }));
      if (suggestion.secondary) {
        option.append(el("span", { class: "combo__secondary", text: suggestion.secondary }));
      }
      // `pointerdown` rather than `click`: on a phone the input blurs first and
      // a click on a list that is closing never arrives.
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.#choose(index);
      });
      list.append(option);
    });
  }

  #choose(index: number): void {
    const suggestion = this.#suggestions[index];
    if (!suggestion) return;
    this.#chosen = suggestion.value;
    this.#options.input.value = suggestion.primary;
    this.close();
    this.#options.onChoose(suggestion);
  }

  #onKeyDown(event: KeyboardEvent): void {
    if (this.#options.list.hidden) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const count = this.#suggestions.length;
      if (count === 0) return;
      this.#active = (this.#active + delta + count) % count;
      this.#highlight();
    } else if (event.key === "Enter" && this.#active >= 0) {
      event.preventDefault();
      this.#choose(this.#active);
    } else if (event.key === "Escape") {
      this.close();
    }
  }

  #highlight(): void {
    const options = this.#options.list.querySelectorAll<HTMLElement>(".combo__option");
    options.forEach((option, index) => {
      option.setAttribute("aria-selected", String(index === this.#active));
    });
    const active = options[this.#active];
    if (active) {
      this.#options.input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    }
  }
}
