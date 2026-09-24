import { fetchComuni, fetchRoutes } from "../../api/client.js";
import type { Comune, RouteMatch } from "../../api/types.js";
import { t } from "../../i18n/index.js";
import type { MapState } from "../../map/urlstate.js";
import { Autocomplete } from "../autocomplete.js";
import { el, query } from "../dom.js";
import { titleCase, toServiceDate } from "../format.js";
import { WhenField } from "../whenfield.js";

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
  #date!: WhenField;
  #from!: WhenField;
  #to!: WhenField;

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

  /**
   * Fills the form in from a search carried in the address bar.
   *
   * Only the *question* comes from the URL — which line, or which two comuni.
   * The day and the time window keep the defaults, which is deliberate: a link
   * shared on Tuesday and opened on Friday should show Friday's buses, and a
   * link that pinned an hour would show an empty list to everyone who opened it
   * later than that. `/mappa/?linea=32` means "the 32", not "the 32 at 09:15 on
   * the day I sent this".
   *
   * The comune on a line search is not put into any field, because there is no
   * field for it: it narrows the results afterwards. See `matchesComune`.
   */
  setQuery(state: MapState): void {
    if (state.mode === "line") {
      this.setMode("line");
      // `null` for the chosen suggestion: the value came from an address, not
      // from the dropdown, and claiming otherwise would tell the autocomplete
      // a suggestion had been picked when none was.
      query<HTMLInputElement>(this.element, "#input-line").value = state.route;
      return;
    }
    this.setMode("od");
    this.#comuneA.setValue(state.comuneA, null);
    this.#comuneB.setValue(state.comuneB, null);
  }

  /**
   * Runs the search the form currently holds, as though it had been submitted.
   *
   * Exists so a search arriving in the address bar goes down the *same* path as
   * one a rider types — the same commit of the three time fields, the same
   * validation, the same callback. A second code path that assembled the query
   * itself would be the one place the two could drift, and it would drift
   * silently, on the links the line pages depend on.
   */
  submitNow(): void {
    this.#submit();
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
      emptyMessage: t.search.noLine,
    });

    this.#comuneA = this.#comuneField("#input-comune-a", "#list-comune-a");
    this.#comuneB = this.#comuneField("#input-comune-b", "#list-comune-b");

    this.#date = new WhenField({ input: query(this.element, "#input-date"), kind: "day" });
    this.#from = new WhenField({ input: query(this.element, "#input-from"), kind: "clock" });
    this.#to = new WhenField({ input: query(this.element, "#input-to"), kind: "clock" });

    // The picker buttons ask for room too: on a phone the sheet has to be open
    // before a panel drops out of a field, or it opens into the map.
    for (const control of this.element.querySelectorAll<HTMLElement>(
      ".field__input, .field__picker",
    )) {
      control.addEventListener("focus", () => this.#options.onFieldFocus());
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
      emptyMessage: t.search.noComune,
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
    this.#date.set(toServiceDate(now));
    this.#from.set(clock(now));
    const until = new Date(now.getTime() + DEFAULT_WINDOW_HOURS * 3600_000);
    // Past midnight the window would wrap to 00:xx and select nothing, so a late
    // search simply runs to the end of the service day instead.
    const wraps = until.getDate() !== now.getDate();
    this.#to.set(wraps ? "23:59" : clock(until));
  }

  #submit(): void {
    // A rider who types an hour and presses enter never leaves the field, so the
    // three fields are read into their canonical form here rather than trusting
    // the last blur to have happened.
    this.#date.commit();
    this.#from.commit();
    this.#to.commit();
    const date = this.#date.value;
    const from = this.#from.value;
    const to = this.#to.value;

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
    <div class="tabs" role="tablist" aria-label="${t.search.modes}">
      <button type="button" class="tabs__tab" role="tab" data-mode="od" aria-selected="true"
              aria-controls="form-od">${t.search.tabOd}</button>
      <button type="button" class="tabs__tab" role="tab" data-mode="line" aria-selected="false"
              aria-controls="form-line">${t.search.tabLine}</button>
    </div>

    <form id="search-form" class="form" novalidate>
      <div id="form-od" role="tabpanel" class="form__fields">
        <div class="od">
          <div class="field combo">
            <label class="field__label" for="input-comune-a">${t.search.origin}</label>
            <input class="field__input" id="input-comune-a" type="text"
                   placeholder="${t.search.originPlaceholder}"
                   enterkeyhint="search" spellcheck="false" />
            <ul class="combo__list" id="list-comune-a" hidden></ul>
          </div>
          <button type="button" class="od__swap" id="swap" aria-label="${t.search.swap}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M7.5 4.5v13m0 0 3-3m-3 3-3-3M16.5 19.5v-13m0 0 3 3m-3-3-3 3" />
            </svg>
          </button>
          <div class="field combo">
            <label class="field__label" for="input-comune-b">${t.search.destination}</label>
            <input class="field__input" id="input-comune-b" type="text"
                   placeholder="${t.search.destinationPlaceholder}"
                   enterkeyhint="search" spellcheck="false" />
            <ul class="combo__list" id="list-comune-b" hidden></ul>
          </div>
        </div>
      </div>

      <div id="form-line" role="tabpanel" class="form__fields" hidden>
        <div class="field combo">
          <label class="field__label" for="input-line">${t.search.line}</label>
          <input class="field__input field__input--code" id="input-line" type="text"
                 placeholder="${t.search.linePlaceholder}" enterkeyhint="search"
                 spellcheck="false" />
          <ul class="combo__list" id="list-line" hidden></ul>
        </div>
      </div>

      <!--
        Text fields, not the native date and time ones. Those render in the
        format of the *browser's* language rather than the page's, so an Italian
        with an English-language browser was being asked for a Tuscan departure
        in "03:13 PM" — clipped to "03:13 F" at 1280 px, because the meridiem did
        not fit the width it forced. Nothing on the page can change that; see
        ui/when.ts. WhenField gives back the keyboard stepping they had.
      -->
      <div class="when">
        <div class="field">
          <label class="field__label" for="input-date">${t.search.day}</label>
          <input class="field__input field__input--when" id="input-date" type="text"
                 enterkeyhint="search" />
        </div>
        <div class="field">
          <label class="field__label" for="input-from">${t.search.from}</label>
          <input class="field__input field__input--when" id="input-from" type="text"
                 enterkeyhint="search" />
        </div>
        <div class="field">
          <label class="field__label" for="input-to">${t.search.to}</label>
          <input class="field__input field__input--when" id="input-to" type="text"
                 enterkeyhint="search" />
        </div>
      </div>

      <button type="submit" class="cta">${t.search.submit}</button>
    </form>
  `;
}
