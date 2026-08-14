import type { LineSearchResponse, OdSearchResponse } from "../../api/types.js";
import { clear, el } from "../dom.js";
import { clockTime, durationLabel, secondsToClock, titleCase, toServiceDate } from "../format.js";

export interface ResultRow {
  readonly tripId: string;
  readonly line: string;
  readonly departure: string;
  readonly arrival: string;
  readonly duration: string | null;
  readonly origin: string;
  readonly destination: string;
  /** Only set when we can see the bus: absence never means "not running". */
  readonly running: boolean;
}

export interface ResultsViewOptions {
  readonly onSelect: (tripId: string) => void;
  readonly onBack: () => void;
}

/**
 * The trip list.
 *
 * Rows are led by the line's own code — the plate a rider actually looks for on
 * the front of the bus — rather than by a position number, because the order of
 * a departure list carries no meaning worth numbering.
 */
export class ResultsView {
  readonly element: HTMLElement;
  readonly #title: HTMLElement;
  readonly #subtitle: HTMLElement;
  readonly #list: HTMLElement;
  readonly #options: ResultsViewOptions;
  /** The day and time window that produced this list, restated back to the rider. */
  #window = "";

  constructor(options: ResultsViewOptions) {
    this.#options = options;
    this.element = el("div", { class: "results" });
    this.element.innerHTML = `
      <div class="viewhead">
        <button type="button" class="viewhead__back" id="results-back">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M14.5 5.5 8 12l6.5 6.5" />
          </svg>
          <span>Ricerca</span>
        </button>
        <div class="viewhead__text">
          <h2 class="viewhead__title" id="results-title"></h2>
          <p class="viewhead__sub" id="results-sub"></p>
        </div>
      </div>
      <ol class="triplist" id="results-list"></ol>
    `;
    this.#title = this.element.querySelector("#results-title") as HTMLElement;
    this.#subtitle = this.element.querySelector("#results-sub") as HTMLElement;
    this.#list = this.element.querySelector("#results-list") as HTMLElement;
    (this.element.querySelector("#results-back") as HTMLElement).addEventListener("click", () =>
      options.onBack(),
    );
  }

  /** True when the list has rows — the caller sizes the sheet from this. */
  get hasRows(): boolean {
    return this.#list.querySelector(".trip") !== null;
  }

  renderLine(response: LineSearchResponse, route: string, runningTrips: ReadonlySet<string>): void {
    this.#title.textContent = route.toLocaleUpperCase("it-IT");
    this.#window = windowLabel(response);
    this.#render(
      response.trips.map((trip) => ({
        tripId: trip.tripId,
        line: trip.line,
        departure: clockTime(trip.departureTime),
        arrival: clockTime(trip.arrivalTime),
        duration: durationLabel(trip.departureSeconds, trip.arrivalSeconds),
        origin: titleCase(trip.origin.name),
        destination: titleCase(trip.destination.name),
        running: runningTrips.has(trip.tripId),
      })),
      response.trips.length,
      response.truncated,
    );
  }

  renderOd(response: OdSearchResponse, runningTrips: ReadonlySet<string>): void {
    this.#title.textContent = `${response.from.name} → ${response.to.name}`;
    this.#window = windowLabel(response);
    this.#render(
      response.trips.map((trip) => ({
        tripId: trip.tripId,
        line: trip.line,
        departure: clockTime(trip.boarding.departureTime),
        arrival: clockTime(trip.alighting.arrivalTime),
        duration: durationLabel(
          secondsOf(trip.boarding.departureTime),
          secondsOf(trip.alighting.arrivalTime),
        ),
        origin: titleCase(trip.boarding.name),
        destination: titleCase(trip.alighting.name),
        running: runningTrips.has(trip.tripId),
      })),
      response.trips.length,
      response.truncated,
    );
  }

  #render(rows: readonly ResultRow[], total: number, truncated: boolean): void {
    clear(this.#list);

    if (rows.length === 0) {
      // The window is the whole answer here: nine times out of ten the search
      // found nothing because it asked about the wrong hours or the wrong day.
      this.#subtitle.textContent = this.#window;
      this.#list.append(
        el("li", { class: "empty" }, [
          el("p", { class: "empty__title", text: "Nessuna corsa in questa fascia oraria." }),
          el("p", {
            class: "empty__hint",
            text: "Allarga l’orario o controlla il giorno: molte linee extraurbane non viaggiano la domenica.",
          }),
        ]),
      );
      return;
    }

    const count = truncated
      ? `Prime ${total} corse`
      : `${total} ${total === 1 ? "corsa" : "corse"}`;
    this.#subtitle.textContent = `${count} · ${this.#window}`;

    for (const row of rows) this.#list.append(this.#row(row));
  }

  #row(row: ResultRow): HTMLElement {
    const item = el("li", { class: "trip" });
    const button = el("button", {
      class: "trip__button",
      type: "button",
      "aria-label": `Linea ${row.line}, partenza ${row.departure} da ${row.origin}, arrivo ${row.arrival} a ${row.destination}`,
    });

    button.append(
      el("span", { class: "plate", "data-running": row.running }, [
        el("span", { class: "plate__code", text: row.line }),
      ]),
      el("span", { class: "trip__body" }, [
        el("span", { class: "trip__times" }, [
          el("time", { class: "trip__depart", text: row.departure }),
          el("span", { class: "trip__arrow", "aria-hidden": true, text: "→" }),
          el("time", { class: "trip__arrive", text: row.arrival }),
          ...(row.duration ? [el("span", { class: "trip__duration", text: row.duration })] : []),
        ]),
        el("span", { class: "trip__stops" }, [
          el("span", { class: "trip__stop", text: row.origin }),
          el("span", { class: "trip__stop trip__stop--to", text: row.destination }),
        ]),
      ]),
      ...(row.running
        ? [
            el("span", { class: "trip__live", title: "Un bus sta viaggiando su questa corsa" }, [
              el("span", { class: "trip__livedot", "aria-hidden": true }),
              el("span", { text: "in viaggio" }),
            ]),
          ]
        : []),
    );

    button.addEventListener("click", () => this.#options.onSelect(row.tripId));
    item.append(button);
    return item;
  }
}

/**
 * "oggi 06:00–09:00", or the date when it is not today.
 *
 * Restating the question above the answer is what makes an empty list readable:
 * without it, "nessuna corsa" looks like a claim about the route rather than
 * about the hours that were asked for.
 */
function windowLabel(response: {
  readonly date: string;
  readonly fromSeconds: number;
  readonly toSeconds: number;
}): string {
  const when =
    response.date === toServiceDate(new Date())
      ? "oggi"
      : `${response.date.slice(6, 8)}/${response.date.slice(4, 6)}`;
  return `${when} ${secondsToClock(response.fromSeconds)}–${secondsToClock(response.toSeconds)}`;
}

function secondsOf(gtfsTime: string | null): number | null {
  if (!gtfsTime) return null;
  const [hours, minutes, seconds] = gtfsTime.split(":").map(Number);
  if (hours === undefined || minutes === undefined) return null;
  return hours * 3600 + minutes * 60 + (seconds ?? 0);
}
