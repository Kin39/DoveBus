import { formatDay, parseClock, parseDay, stepClock, stepDay } from "./when.js";

export type WhenKind = "clock" | "day";

export interface WhenFieldOptions {
  readonly input: HTMLInputElement;
  readonly kind: WhenKind;
}

/** What one arrow press is worth, and what it is worth with shift held. */
const STEP = {
  clock: { small: 5, large: 60 },
  day: { small: 1, large: 7 },
} as const;

const PLACEHOLDER: Record<WhenKind, string> = {
  clock: "hh:mm",
  day: "gg/mm/aaaa",
};

/**
 * A day or an hour, typed as text and always shown the same way round.
 *
 * It replaces `<input type="time">` and `<input type="date">`, whose format is
 * chosen by the browser's language rather than the page's — see `when.ts` for
 * what that cost. Everything those controls gave a keyboard is kept: arrows step
 * the value, shift steps it further, and what is typed is normalised when the
 * field is left, so `9`, `930` and `9.30` all settle into `09:30`.
 *
 * The field is never left holding something it cannot mean. An unreadable entry
 * is put back to the last value that worked and the border flinches once —
 * silently searching a time nobody asked for is the failure worth preventing,
 * and a validation message under a field in a scrolling sheet is a message
 * nobody sees.
 */
export class WhenField {
  readonly #input: HTMLInputElement;
  readonly #kind: WhenKind;
  #value: string;

  constructor(options: WhenFieldOptions) {
    this.#input = options.input;
    this.#kind = options.kind;
    this.#value = "";

    // The element is declared as text in the markup; these are the properties a
    // number-shaped text field needs and that the markup should not have to
    // repeat three times.
    this.#input.autocomplete = "off";
    this.#input.spellcheck = false;
    this.#input.inputMode = "numeric";
    this.#input.placeholder = PLACEHOLDER[this.#kind];

    this.#input.addEventListener("blur", () => this.commit());
    this.#input.addEventListener("keydown", (event) => this.#onKeydown(event));
  }

  /** The value in the form the rest of the app speaks: `HH:MM` or `YYYYMMDD`. */
  get value(): string {
    return this.#value;
  }

  set(value: string): void {
    this.#value = value;
    this.#input.value = this.#display(value);
  }

  /**
   * Reads what is in the box, or puts back what was.
   *
   * Called on blur and again before the form is submitted: a rider who types an
   * hour and presses enter never leaves the field, so a value committed only on
   * blur would search the hour they replaced.
   */
  commit(): void {
    const parsed = this.#parse(this.#input.value);
    if (parsed === null) {
      this.set(this.#value);
      this.#flinch();
      return;
    }
    this.set(parsed);
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();

    // Step from what is on screen if it can be read, so an arrow after a
    // half-finished edit moves from the edit rather than from the old value.
    const from = this.#parse(this.#input.value) ?? this.#value;
    const step = event.shiftKey ? STEP[this.#kind].large : STEP[this.#kind].small;
    const delta = event.key === "ArrowUp" ? step : -step;

    this.set(this.#kind === "clock" ? stepClock(from, delta) : stepDay(from, delta));
  }

  #parse(text: string): string | null {
    return this.#kind === "clock" ? parseClock(text) : parseDay(text);
  }

  #display(value: string): string {
    return this.#kind === "clock" ? value : formatDay(value);
  }

  /** The same single flinch an empty required field gets, for the same reason. */
  #flinch(): void {
    this.#input.classList.remove("field__input--flag");
    void this.#input.offsetWidth;
    this.#input.classList.add("field__input--flag");
  }
}
