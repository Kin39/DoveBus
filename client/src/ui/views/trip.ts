import { streamUrl } from "../../api/client.js";
import type { LiveTrip, TripDetail } from "../../api/types.js";
import { clear, el } from "../dom.js";
import { clockTime, delayView, titleCase } from "../format.js";
import { FreshnessMeter } from "../freshness.js";

/** Below this the guess is smaller than GPS noise and not worth a sentence. */
const ESTIMATE_VISIBLE_M = 40;

export interface TripViewOptions {
  readonly onBack: () => void;
  /** Fired on every live payload so the map can move the bus and redraw the trail. */
  readonly onLive: (live: LiveTrip | null) => void;
}

/**
 * One run, watched live.
 *
 * The connection is an `EventSource`, which reconnects by itself when a rider
 * goes through a tunnel — and because the freshness meter counts from the bus's
 * own clock rather than from the last message, the age stays truthful across the
 * gap instead of resetting to zero the moment the socket comes back.
 */
export class TripView {
  readonly element: HTMLElement;
  readonly #options: TripViewOptions;
  readonly #meter = new FreshnessMeter();

  #source: EventSource | null = null;
  #detail: TripDetail | null = null;
  #live: LiveTrip | null = null;
  #connected = true;
  #advanced = 0;

  constructor(options: TripViewOptions) {
    this.#options = options;
    this.element = el("div", { class: "tripview" });
  }

  /** Renders the timetable half, then opens the stream for the live half. */
  show(detail: TripDetail): void {
    this.#detail = detail;
    this.#live = detail.live;
    this.#render();
    this.#connect(detail.trip.tripId, detail.trip.date);
  }

  /**
   * Says how far the marker has been advanced past the last real fix.
   *
   * The bus is drawn where we think it is, not where we last saw it — so the
   * size of that assumption is stated in words as well as drawn on the map,
   * rather than left for the rider to infer from a moving dot.
   */
  setEstimate(advancedMetres: number): void {
    this.#advanced = advancedMetres;
    this.#renderEstimate();
  }

  #renderEstimate(): void {
    const node = this.element.querySelector("#trip-estimate");
    if (!(node instanceof HTMLElement)) return;
    const metres = Math.round(this.#advanced);
    node.hidden = metres < ESTIMATE_VISIBLE_M;
    node.textContent =
      metres >= 1000
        ? `Posizione stimata: avanzata di ~${(metres / 1000).toFixed(1)} km dall'ultimo dato ricevuto.`
        : `Posizione stimata: avanzata di ~${metres} m dall'ultimo dato ricevuto.`;
  }

  close(): void {
    this.#source?.close();
    this.#source = null;
    this.#meter.stop();
  }

  #connect(tripId: string, date: string): void {
    this.close();
    const source = new EventSource(streamUrl(tripId, date));
    this.#source = source;

    const receive = (event: MessageEvent<string>): void => {
      try {
        const payload = JSON.parse(event.data) as { live: LiveTrip | null };
        this.#connected = true;
        this.#live = payload.live;
        this.#renderLive();
        this.#options.onLive(payload.live);
      } catch {
        // A malformed frame is the server's problem, not this rider's: keep the
        // last good position on screen and wait for the next tick.
      }
    };

    source.addEventListener("snapshot", receive);
    source.addEventListener("update", receive);
    source.addEventListener("error", () => {
      // EventSource retries on its own; this only records that the picture on
      // screen is no longer being confirmed.
      this.#connected = false;
      this.#renderLive();
    });
  }

  #render(): void {
    const detail = this.#detail;
    if (!detail) return;
    clear(this.element);

    const { trip } = detail;
    const head = el("div", { class: "viewhead" });
    const back = el("button", { class: "viewhead__back", type: "button" });
    back.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14.5 5.5 8 12l6.5 6.5" /></svg><span>Corse</span>`;
    back.addEventListener("click", () => this.#options.onBack());

    head.append(
      back,
      el("div", { class: "viewhead__text" }, [
        el("h2", { class: "viewhead__title" }, [
          el("span", { class: "plate plate--large" }, [
            el("span", { class: "plate__code", text: trip.line }),
          ]),
          el("span", {
            class: "viewhead__headsign",
            text: titleCase(trip.headsign ?? trip.routeLongName ?? "Destinazione ignota"),
          }),
        ]),
      ]),
    );

    const status = el("div", { class: "status", id: "trip-status" });
    const stops = el("section", { class: "stops" }, [
      el("h3", { class: "stops__title", text: "Fermate" }),
    ]);
    const list = el("ol", { class: "stops__list" });

    for (const stop of detail.stops) {
      list.append(
        el("li", { class: "stops__item" }, [
          el("time", { class: "stops__time", text: clockTime(stop.arrivalTime) }),
          el("span", { class: "stops__name", text: titleCase(stop.name) }),
        ]),
      );
    }
    stops.append(list);

    this.element.append(head, status, stops);
    this.#renderLive();
  }

  #renderLive(): void {
    const status = this.element.querySelector("#trip-status");
    if (!(status instanceof HTMLElement)) return;
    clear(status);

    const live = this.#live;
    if (!live) {
      status.append(
        el("div", { class: "status__none" }, [
          el("p", { class: "status__nonetitle", text: "Nessun bus in viaggio su questa corsa." }),
          el("p", {
            class: "status__nonehint",
            text: this.#detail?.trip.runsOnDate
              ? "La posizione compare quando il bus parte e inizia a trasmettere."
              : "Questa corsa non è prevista nel giorno scelto.",
          }),
        ]),
      );
      return;
    }

    const { vehicle } = live;
    this.#meter.setTimestamp(vehicle.timestamp);

    const delay = delayView(vehicle.delaySeconds, vehicle.cancelled);
    const badges = el("div", { class: "badges" });
    if (delay) {
      badges.append(
        el("span", { class: "badge", "data-tone": delay.tone }, [
          el("span", { class: "badge__value", text: delay.label }),
        ]),
      );
    }
    if (vehicle.stopSequence !== null && this.#detail) {
      const total = this.#detail.stops.length;
      badges.append(
        el("span", { class: "badge badge--quiet" }, [
          el("span", {
            class: "badge__value",
            text: `fermata ${vehicle.stopSequence} di ${total}`,
          }),
        ]),
      );
    }
    if (!this.#connected) {
      badges.append(
        el("span", { class: "badge", "data-tone": "offline" }, [
          el("span", { class: "badge__value", text: "riconnessione…" }),
        ]),
      );
    }

    status.append(this.#meter.element, badges);

    status.append(
      el("p", { class: "status__trail", id: "trip-estimate" }),
      el("p", {
        class: "status__trail",
        // The green line is a reconstruction and the dots are observations, and
        // the difference between those two is not something to leave implicit.
        text:
          live.trail.length > 1
            ? `Percorso compiuto ricostruito sul tracciato della linea. I punti sono le ${live.trail.length} posizioni ricevute da quando DoveBus segue questa corsa.`
            : "Percorso compiuto ricostruito sul tracciato della linea.",
      }),
    );
    this.#renderEstimate();
  }
}
