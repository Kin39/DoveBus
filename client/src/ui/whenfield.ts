import { t } from "../i18n/index.js";
import { el } from "./dom.js";
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

/**
 * The shape of the value, shown only when the field is empty — which is when it
 * is the one thing a rider needs. Both languages write the day the Italian way
 * round, because the timetable and the sign at the stop do; see `i18n/en.ts`.
 */
const PLACEHOLDER: Record<WhenKind, string> = {
  clock: t.search.clockPlaceholder,
  day: t.search.dayPlaceholder,
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
  /** Where a rejected entry is announced. Silent until there is one. */
  readonly #status: HTMLElement;
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

    // Two things the native controls gave a reader who cannot see the field, and
    // a text input does not. A `<input type="date">` announces its day, month
    // and year segments whether or not it holds a value; this one would announce
    // only its label and its contents, so the shape — and the arrow keys, which
    // nothing else hints at — go in a description that is always there. The
    // placeholder cannot do that job: it disappears the moment the field is
    // filled, which is nearly always.
    const hint = el("span", {
      class: "sr-only",
      id: `${this.#input.id}-hint`,
      text: t.search.whenHint(PLACEHOLDER[this.#kind]),
    });
    // And a rejected entry has to say so. The border flinch is not audible, and
    // the search that follows runs on the value that was put back — which is a
    // silent, invisible substitution for anyone not watching the field.
    this.#status = el("span", { class: "sr-only", id: `${this.#input.id}-status`, role: "status" });
    this.#input.setAttribute("aria-describedby", hint.id);
    this.#input.after(hint, this.#status);

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
      this.#status.textContent = t.search.whenReverted(this.#display(this.#value));
      this.#flinch();
      return;
    }
    this.set(parsed);
    this.#status.textContent = "";
  }

  #onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();

    // Step from what is on screen if it can be read, so an arrow after a
    // half-finished edit moves from the edit rather than from the old value.
    const from = this.#parse(this.#input.value) ?? this.#value;
    if (from === "") return;
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
