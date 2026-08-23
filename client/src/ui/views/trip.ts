import { streamUrl } from "../../api/client.js";
import type { LiveTrip, TripDetail } from "../../api/types.js";
import { t } from "../../i18n/index.js";
import { clear, el } from "../dom.js";
import { clockTime, delayView, titleCase } from "../format.js";
import { FreshnessMeter } from "../freshness.js";

/** Below this the guess is smaller than GPS noise and not worth a sentence. */
const ESTIMATE_VISIBLE_M = 40;

/**
 * How coarsely the advance is spoken: to the nearest 50 m below a kilometre and
 * to a tenth of a kilometre above it. The figure is a guess with hundreds of
 * metres of uncertainty printed beside it on the map — quoting it to the metre,
 * five times a second, would claim a precision it does not have and rewrite the
 * sentence continuously to do it.
 */
const ESTIMATE_STEP_M = 50;

function estimateSentence(metres: number): string {
  if (metres >= 1000) return t.trip.estimateKilometres((metres / 1000).toFixed(1));
  return t.trip.estimateMetres(Math.round(metres / ESTIMATE_STEP_M) * ESTIMATE_STEP_M);
}

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

  /**
   * The estimate line, written so that it cannot move the page under the reader.
   *
   * It is rewritten five times a second, and the stops list sits directly below
   * it — so every character this sentence gains or loses is a jolt in the list a
   * rider is reading. Three things keep it still: the distance is rounded, so
   * the text changes on the scale the bus moves rather than on the scale the
   * clock ticks; the node is emptied rather than hidden, and its box is reserved
   * in `trip.css`, so crossing the "not worth saying" threshold costs nothing;
   * and the figures are tabular, so `~1.1 km` and `~1.9 km` are the same width.
   *
   * That last one is what the bug actually was: measured on a 1280 px screen the
   * sentence sits exactly on a line break, so a proportional `1` against a `9`
   * was enough to reflow it from two lines to one and jump the stops list by
   * 16.5 px, roughly every nine seconds.
   */
  #renderEstimate(): void {
    const node = this.element.querySelector("#trip-estimate");
    if (!(node instanceof HTMLElement)) return;

    const metres = Math.round(this.#advanced);
    const text = metres < ESTIMATE_VISIBLE_M ? "" : estimateSentence(metres);
    // Writing the same string again is a layout invalidation for nothing.
    if (node.textContent !== text) node.textContent = text;
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
        <path d="M14.5 5.5 8 12l6.5 6.5" /></svg><span>${t.trip.back}</span>`;
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
            text: titleCase(trip.headsign ?? trip.routeLongName ?? t.trip.unknownDestination),
          }),
        ]),
      ]),
    );

    const status = el("div", { class: "status", id: "trip-status" });
    const stops = el("section", { class: "stops" }, [
      el("h3", { class: "stops__title", text: t.trip.stops }),
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
          el("p", { class: "status__nonetitle", text: t.trip.noBus }),
          el("p", {
            class: "status__nonehint",
            text: this.#detail?.trip.runsOnDate ? t.trip.noBusHint : t.trip.notRunningToday,
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
            text: t.trip.stopOf(vehicle.stopSequence, total),
          }),
        ]),
      );
    }
    if (!this.#connected) {
      badges.append(
        el("span", { class: "badge", "data-tone": "offline" }, [
          el("span", { class: "badge__value", text: t.trip.reconnecting }),
        ]),
      );
    }

    status.append(this.#meter.element, badges);

    status.append(
      el("p", { class: "status__trail status__trail--estimate", id: "trip-estimate" }),
      el("p", {
        class: "status__trail",
        text: live.trail.length > 1 ? t.trip.trailWithPoints(live.trail.length) : t.trip.trail,
      }),
    );
    this.#renderEstimate();
  }
}
