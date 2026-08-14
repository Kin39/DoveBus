import { fetchComuni, fetchRoutes } from "../../api/client.js";
import type { Comune, RouteMatch } from "../../api/types.js";
import { Autocomplete } from "../autocomplete.js";
import { el, query } from "../dom.js";
import { serviceDateToInput, titleCase, toServiceDate } from "../format.js";

export type SearchMode = "line" | "od";

export interface LineQuery {
  readonly mode: "line";
  readonly route: string;
  readonly date: string;
  readonly from: string;
  readonly to: string;
}

export interface OdQuery {
  readonly mode: "od";
  readonly comuneA: string;
  readonly comuneB: string;
  readonly date: string;
  readonly from: string;
  readonly to: string;
}

export type SearchQuery = LineQuery | OdQuery;

/** A rider asks about the next few hours, not about the whole service day. */
const DEFAULT_WINDOW_HOURS = 3;

export interface SearchPanelOptions {
  readonly onSubmit: (query: SearchQuery) => void;
  /** Asks for room: a field in use needs the sheet open, not peeking. */
  readonly onFieldFocus: () => void;
}

/**
 * The two ways a rider knows their bus: by its line, or by where they are and
 * where they are going. Both land on the same trip list, so the tabs swap the
 * question and nothing else.
 */
export class SearchPanel {
  readonly element: HTMLElement;
  readonly #options: SearchPanelOptions;
  #mode: SearchMode = "od";
  #comuneA!: Autocomplete<Comune>;
  #comuneB!: Autocomplete<Comune>;

  constructor(options: SearchPanelOptions) {
    this.#options = options;
    this.element = el("div", { class: "panel" });
    this.element.innerHTML = template();
    this.#bind();
    this.#applyDefaults();
    this.setMode("od");
  }

  setMode(mode: SearchMode): void {
    this.#mode = mode;
    for (const tab of this.element.querySelectorAll<HTMLButtonElement>(".tabs__tab")) {
      const active = tab.dataset.mode === mode;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    query(this.element, "#form-line").hidden = mode !== "line";
    query(this.element, "#form-od").hidden = mode !== "od";
  }

  /** Puts the caret where the question starts, but never on a phone's first paint. */
  focusFirstField(): void {
    const field = this.#mode === "line" ? "#input-line" : "#input-comune-a";
    query<HTMLInputElement>(this.element, field).focus();
  }

  #bind(): void {
    for (const tab of this.element.querySelectorAll<HTMLButtonElement>(".tabs__tab")) {
      tab.addEventListener("click", () => this.setMode(tab.dataset.mode as SearchMode));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        this.setMode(this.#mode === "line" ? "od" : "line");
        query<HTMLButtonElement>(this.element, `.tabs__tab[aria-selected="true"]`).focus();
      });
    }

    // Held only by its own listeners: the line field is submitted as typed text,
    // so nothing here needs to read back which suggestion was picked.
    new Autocomplete<RouteMatch>({
      input: query(this.element, "#input-line"),
      list: query(this.element, "#list-line"),
      fetch: async (value, signal) =>
        (await fetchRoutes(value, { signal })).map((route) => ({
          value: route,
          primary: route.shortName,
          ...(route.longName ? { secondary: titleCase(route.longName) } : {}),
        })),
      onChoose: () => undefined,
      emptyMessage: "Nessuna linea con questo nome.",
    });

    this.#comuneA = this.#comuneField("#input-comune-a", "#list-comune-a");
    this.#comuneB = this.#comuneField("#input-comune-b", "#list-comune-b");

    for (const input of this.element.querySelectorAll<HTMLInputElement>(".field__input")) {
      input.addEventListener("focus", () => this.#options.onFieldFocus());
    }

    query(this.element, "#swap").addEventListener("click", () => this.#swapComuni());

    query<HTMLFormElement>(this.element, "#search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit();
    });
  }

  #comuneField(inputSelector: string, listSelector: string): Autocomplete<Comune> {
    return new Autocomplete<Comune>({
      input: query(this.element, inputSelector),
      list: query(this.element, listSelector),
      fetch: async (value, signal) =>
        (await fetchComuni(value, { signal })).map((comune) => ({
          value: comune,
          primary: comune.name,
        })),
      onChoose: () => undefined,
      emptyMessage: "Nessun comune con questo nome.",
    });
  }

  #swapComuni(): void {
    const a = query<HTMLInputElement>(this.element, "#input-comune-a");
    const b = query<HTMLInputElement>(this.element, "#input-comune-b");
    const chosenA = this.#comuneA.chosen;
    const chosenB = this.#comuneB.chosen;
    const textA = a.value;
    this.#comuneA.setValue(b.value, chosenB);
    this.#comuneB.setValue(textA, chosenA);
  }

  #applyDefaults(): void {
    const now = new Date();
    query<HTMLInputElement>(this.element, "#input-date").value = serviceDateToInput(
      toServiceDate(now),
    );
    query<HTMLInputElement>(this.element, "#input-from").value = clock(now);
    const until = new Date(now.getTime() + DEFAULT_WINDOW_HOURS * 3600_000);
    // Past midnight the window would wrap to 00:xx and select nothing, so a late
    // search simply runs to the end of the service day instead.
    const wraps = until.getDate() !== now.getDate();
    query<HTMLInputElement>(this.element, "#input-to").value = wraps ? "23:59" : clock(until);
  }

  #submit(): void {
    const date = query<HTMLInputElement>(this.element, "#input-date").value.replaceAll("-", "");
    const from = query<HTMLInputElement>(this.element, "#input-from").value;
    const to = query<HTMLInputElement>(this.element, "#input-to").value;

    if (this.#mode === "line") {
      const route = query<HTMLInputElement>(this.element, "#input-line").value.trim();
      if (!route) {
        this.#flag("#input-line");
        return;
      }
      this.#options.onSubmit({ mode: "line", route, date, from, to });
      return;
    }

    const comuneA = query<HTMLInputElement>(this.element, "#input-comune-a").value.trim();
    const comuneB = query<HTMLInputElement>(this.element, "#input-comune-b").value.trim();
    if (!comuneA) {
      this.#flag("#input-comune-a");
      return;
    }
    if (!comuneB) {
      this.#flag("#input-comune-b");
      return;
    }
    this.#options.onSubmit({ mode: "od", comuneA, comuneB, date, from, to });
  }

  /** An empty required field is answered by putting the caret in it, not by an alert. */
  #flag(selector: string): void {
    const input = query<HTMLInputElement>(this.element, selector);
    input.focus();
    input.classList.remove("field__input--flag");
    void input.offsetWidth;
    input.classList.add("field__input--flag");
  }
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * One form, two questions.
 *
 * The tabs swap which set of fields is shown; the day and the time window belong
 * to both and are written once, so switching tabs never silently discards the
 * window a rider just set.
 */
function template(): string {
  return `
    <div class="tabs" role="tablist" aria-label="Modo di ricerca">
      <button type="button" class="tabs__tab" role="tab" data-mode="od" aria-selected="true"
              aria-controls="form-od">Tra comuni</button>
      <button type="button" class="tabs__tab" role="tab" data-mode="line" aria-selected="false"
              aria-controls="form-line">Per linea</button>
    </div>

    <form id="search-form" class="form" novalidate>
      <div id="form-od" role="tabpanel" class="form__fields">
        <div class="od">
          <div class="field combo">
            <label class="field__label" for="input-comune-a">Parto da</label>
            <input class="field__input" id="input-comune-a" type="text" placeholder="Arezzo"
                   enterkeyhint="search" spellcheck="false" />
            <ul class="combo__list" id="list-comune-a" hidden></ul>
          </div>
          <button type="button" class="od__swap" id="swap" aria-label="Inverti partenza e arrivo">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7.5 4.5v13m0 0 3-3m-3 3-3-3M16.5 19.5v-13m0 0 3 3m-3-3-3 3" />
            </svg>
          </button>
          <div class="field combo">
            <label class="field__label" for="input-comune-b">Arrivo a</label>
            <input class="field__input" id="input-comune-b" type="text" placeholder="Anghiari"
                   enterkeyhint="search" spellcheck="false" />
            <ul class="combo__list" id="list-comune-b" hidden></ul>
          </div>
        </div>
      </div>

      <div id="form-line" role="tabpanel" class="form__fields" hidden>
        <div class="field combo">
          <label class="field__label" for="input-line">Linea</label>
          <input class="field__input field__input--code" id="input-line" type="text"
                 placeholder="SI381, BAAS, 30…" enterkeyhint="search" spellcheck="false" />
          <ul class="combo__list" id="list-line" hidden></ul>
        </div>
      </div>

      <div class="when">
        <div class="field">
          <label class="field__label" for="input-date">Giorno</label>
          <input class="field__input" id="input-date" type="date" />
        </div>
        <div class="field">
          <label class="field__label" for="input-from">Dalle</label>
          <input class="field__input field__input--time" id="input-from" type="time" />
        </div>
        <div class="field">
          <label class="field__label" for="input-to">Alle</label>
          <input class="field__input field__input--time" id="input-to" type="time" />
        </div>
      </div>

      <button type="submit" class="cta">Cerca corse</button>
    </form>
  `;
}
