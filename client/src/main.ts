// The `wdth` builds rather than the default `wght` ones: the interface leans on
// the width axis to fit long uppercase Tuscan stop names onto a 375 px screen.
import "@fontsource-variable/instrument-sans/wdth.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/brand.css";
import "./styles/base.css";
import "./styles/sheet.css";
import "./styles/panel.css";
import "./styles/trip.css";

import { ApiError, fetchTrip, fetchVehicles, searchLine, searchOd } from "./api/client.js";
import type { LiveTrip, TrailPoint, TripDetail, Vehicle } from "./api/types.js";
import { MapController } from "./map/map.js";
import { boundsOf } from "./map/trip.js";
import { clear, el, query } from "./ui/dom.js";
import { count } from "./ui/format.js";
import { BottomSheet } from "./ui/sheet.js";
import { VehicleCallout } from "./ui/views/callout.js";
import { ResultsView } from "./ui/views/results.js";
import { SearchPanel, type SearchQuery } from "./ui/views/search.js";
import { TripView } from "./ui/views/trip.js";

/**
 * How often the map re-asks for the fleet.
 *
 * Matched to the backend's own 30 s poll: the upstream feed regenerates about
 * every two minutes, so asking faster would spend a rider's data re-downloading
 * positions that have not changed.
 */
const VEHICLE_REFRESH_MS = 30_000;

/** A pan smaller than a gesture should not trigger a request. */
const VIEWPORT_SETTLE_MS = 400;

/** The side column's width plus its margins, matching `sheet.css` above 720 px. */
const WIDE_PANEL_WIDTH = 380 + 32;

/** Matches the marker cadence: the trail must not lag the bus drawing it. */
const PROGRESS_TICK_MS = 200;

type View = "search" | "results" | "trip";

class App {
  readonly #map: MapController;
  readonly #sheet: BottomSheet;
  readonly #scroll: HTMLElement;
  readonly #search: SearchPanel;
  readonly #results: ResultsView;
  readonly #trip: TripView;
  readonly #callout: VehicleCallout;

  #view: View = "search";
  #vehicles: readonly Vehicle[] = [];
  #runningTrips: ReadonlySet<string> = new Set();
  #settleTimer: number | null = null;
  #vehicleRequest: AbortController | null = null;
  #openTrip: TripDetail | null = null;
  /** The day the open trip list was searched for — not necessarily today. */
  #searchDate = todayServiceDate();
  /** The buttons a running request disabled, held so they can be given back. */
  #busyButtons: HTMLButtonElement[] = [];
  /** The positions the followed bus genuinely reported, drawn as marks. */
  #trail: readonly TrailPoint[] = [];
  #progressTimer: number | null = null;

  constructor() {
    this.#scroll = query(document, "#sheet-scroll");

    this.#map = new MapController({
      container: query(document, "#map"),
      onSelectVehicle: (key) => this.#onSelectVehicle(key),
      onViewportChange: () => this.#scheduleVehicleRefresh(),
    });

    this.#sheet = new BottomSheet({
      element: query(document, "#sheet"),
      handle: query(document, "#sheet-handle"),
      scroller: this.#scroll,
      onHeightChange: (height) => this.#onSheetHeight(height),
    });

    this.#search = new SearchPanel({
      onSubmit: (q) => void this.#runSearch(q),
      onFieldFocus: () => this.#sheet.snapTo("full"),
    });
    this.#results = new ResultsView({
      onSelect: (tripId) => void this.#openTripView(tripId),
      onBack: () => this.#showSearch(),
    });
    this.#trip = new TripView({
      onBack: () => this.#showResults(),
      onLive: (live) => this.#onTripLive(live),
    });
    this.#callout = new VehicleCallout({
      onFollow: (tripId) => void this.#openTripView(tripId),
      onDismiss: () => this.#onSelectVehicle(null),
    });

    query(document, "#recenter").addEventListener("click", () => this.#recenter());
    document.addEventListener("visibilitychange", () => this.#onVisibilityChange());

    // Dev-only handle for `npm run shots`, which has to drive the map to a busy
    // viewport before it can photograph a bus. Stripped from the build.
    if (import.meta.env.DEV) {
      (window as unknown as { __map: unknown }).__map = this.#map.map;
    }

    this.#showSearch();
    void this.#start();
  }

  async #start(): Promise<void> {
    await this.#map.ready;
    this.#refreshFooter();
    await this.#refreshVehicles();
    window.setInterval(() => void this.#refreshVehicles(), VEHICLE_REFRESH_MS);
  }

  // ---- views -------------------------------------------------------------

  #showSearch(): void {
    this.#view = "search";
    this.#stopProgressTicker();
    this.#trip.close();
    this.#map.trip?.clear();
    this.#map.vehicles?.select(null);
    this.#callout.hide();
    this.#openTrip = null;
    this.#swap(this.#search.element);
    this.#swapFooter();
  }

  #showResults(): void {
    if (!this.#results.element.dataset.ready) {
      this.#showSearch();
      return;
    }
    this.#view = "results";
    this.#stopProgressTicker();
    this.#trip.close();
    this.#map.trip?.clear();
    this.#map.vehicles?.select(null);
    this.#openTrip = null;
    this.#swap(this.#results.element);
    this.#swapFooter();
  }

  #swap(view: HTMLElement): void {
    clear(this.#scroll);
    this.#scroll.append(view);
    this.#scroll.scrollTop = 0;
  }

  /**
   * The CC-BY obligation, present on every view rather than only on the first.
   *
   * The basemap line names whichever basemap actually loaded, which is not known
   * until the style settles — crediting CARTO for tiles OpenFreeMap served, or
   * the reverse, would be a false statement in the one place the licence asks us
   * to be exact. Until then it credits only OpenStreetMap, which is true of both.
   *
   * It also carries the links to the site's three content pages, and that is
   * deliberate: this page has no menu, because a hamburger in the top bar would
   * compete with the fleet counter at 320 px and cost a drawer and a focus trap
   * on the heaviest page of the site. The bottom of the sheet is where the
   * attribution already is, it is thumb-reachable, and someone looking for
   * "who publishes this data" or "what do you store about me" looks at the fine
   * print — so the links live in the fine print.
   */
  #swapFooter(): void {
    const basemap = this.#map.basemapCredit ?? "Mappa © OpenStreetMap";
    this.#scroll.append(
      el("footer", { class: "credits" }, [
        el("p", { text: "Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)" }),
        el("p", { text: `Confini comunali: openpolis / ISTAT · ${basemap}` }),
        el("nav", { class: "credits__nav", "aria-label": "Pagine del sito" }, [
          el("a", { href: "/come-funziona/", text: "Come funziona" }),
          el("a", { href: "/fonte-dati/", text: "Fonte dati" }),
          el("a", { href: "/privacy/", text: "Privacy" }),
        ]),
      ]),
    );
  }

  /** Replaces the footer once the basemap is known, without stacking a second one. */
  #refreshFooter(): void {
    this.#scroll.querySelector("footer.credits")?.remove();
    this.#swapFooter();
  }

  // ---- search ------------------------------------------------------------

  async #runSearch(request: SearchQuery): Promise<void> {
    const window_ = { date: request.date, from: request.from, to: request.to };
    this.#searchDate = request.date;
    this.#setBusy(true);

    try {
      if (request.mode === "line") {
        const response = await searchLine(request.route, window_);
        this.#results.renderLine(response, request.route, this.#runningTrips);
      } else {
        const response = await searchOd(request.comuneA, request.comuneB, window_);
        this.#results.renderOd(response, this.#runningTrips);
      }
      this.#results.element.dataset.ready = "true";
      this.#view = "results";
      this.#swap(this.#results.element);
      this.#swapFooter();
      // A list fills the sheet; a "nothing found" message would leave most of it
      // empty, so it stays at half and gives the map back.
      this.#sheet.snapTo(this.#results.hasRows ? "full" : "half");
    } catch (error) {
      this.#reportError(error);
    } finally {
      this.#setBusy(false);
    }
  }

  // ---- trip --------------------------------------------------------------

  async #openTripView(tripId: string): Promise<void> {
    this.#setBusy(true);
    try {
      const detail = await fetchTrip(tripId, this.#searchDate);
      this.#openTrip = detail;
      this.#view = "trip";
      this.#callout.hide();
      this.#swap(this.#trip.element);
      this.#trip.show(detail);
      this.#swapFooter();
      this.#sheet.snapTo("half");

      const route = this.#map.trip?.setShape(detail.shape) ?? null;
      this.#map.trip?.setStops(detail.stops);
      // The route goes to the layer too: it is what lets the followed bus be
      // advanced along the road instead of straight on, and it exempts that bus
      // from the age cutoff so it never vanishes mid-watch.
      this.#map.vehicles?.select(detail.live?.vehicle.key ?? null, route);
      this.#trail = detail.live?.trail ?? [];
      this.#map.trip?.setObserved(this.#trail);
      this.#drawProgress();
      this.#startProgressTicker();

      const bounds = boundsOf(detail.shape);
      if (bounds) this.#map.fit(bounds);
    } catch (error) {
      this.#reportError(error);
    } finally {
      this.#setBusy(false);
    }
  }

  #onTripLive(live: LiveTrip | null): void {
    this.#trail = live?.trail ?? [];
    this.#map.trip?.setObserved(this.#trail);
    this.#map.vehicles?.select(live?.vehicle.key ?? null, this.#map.trip?.route ?? null);
    // The stream is the authority for this one bus even when it sits outside the
    // viewport the fleet request asked about.
    if (live) this.#mergeVehicle(live.vehicle);
    this.#drawProgress();
  }

  /**
   * Redraws the travelled road and the uncertainty disc from the *estimated*
   * position, on the same cadence the markers move at — otherwise the trail
   * would stop at the last fix while the bus carried on ahead of it.
   */
  #startProgressTicker(): void {
    if (this.#progressTimer !== null) return;
    this.#progressTimer = window.setInterval(() => this.#drawProgress(), PROGRESS_TICK_MS);
  }

  #stopProgressTicker(): void {
    if (this.#progressTimer !== null) window.clearInterval(this.#progressTimer);
    this.#progressTimer = null;
    this.#trail = [];
  }

  #drawProgress(): void {
    const trip = this.#map.trip;
    const key = this.#map.vehicles?.selectedKey ?? null;
    if (!trip || this.#view !== "trip") return;

    const current = key === null ? null : (this.#map.vehicles?.estimateFor(key) ?? null);
    trip.setProgress(current?.point ?? null, this.#trail);
    trip.setUncertainty(current?.point ?? null, current?.uncertainty ?? 0);
    this.#trip.setEstimate(Math.abs(current?.advanced ?? 0));
  }

  // ---- fleet -------------------------------------------------------------

  #scheduleVehicleRefresh(): void {
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = window.setTimeout(() => void this.#refreshVehicles(), VIEWPORT_SETTLE_MS);
  }

  async #refreshVehicles(): Promise<void> {
    if (document.hidden) return;
    this.#vehicleRequest?.abort();
    const controller = new AbortController();
    this.#vehicleRequest = controller;

    try {
      const response = await fetchVehicles(this.#map.viewportBbox(), { signal: controller.signal });
      this.#vehicles = response.vehicles;
      this.#runningTrips = new Set(
        response.vehicles
          .map((vehicle) => vehicle.tripId)
          .filter((id): id is string => id !== null),
      );
      this.#map.vehicles?.update(response.vehicles);
      this.#setFleetCount(response.count);
      this.#clearError();
      this.#refreshCallout();
    } catch (error) {
      if (controller.signal.aborted) return;
      // The last good fleet stays on the map: a blank map is a worse answer than
      // an ageing one, and every marker already says how old it is.
      this.#reportError(error);
    }
  }

  #mergeVehicle(vehicle: Vehicle): void {
    const others = this.#vehicles.filter((existing) => existing.key !== vehicle.key);
    this.#vehicles = [...others, vehicle];
    this.#map.vehicles?.update(this.#vehicles);
  }

  #setFleetCount(value: number): void {
    query(document, "#fleet-count").textContent = count(value);
  }

  // ---- selection ---------------------------------------------------------

  #onSelectVehicle(key: string | null): void {
    if (this.#view === "trip") return;
    this.#map.vehicles?.select(key);

    if (key === null) {
      this.#callout.hide();
      return;
    }
    const vehicle = this.#vehicles.find((candidate) => candidate.key === key);
    if (!vehicle) return;
    this.#callout.show(vehicle);
    this.#map.focus([vehicle.lon, vehicle.lat]);
  }

  #refreshCallout(): void {
    // The trip view owns the selection while it is open, and re-showing the
    // callout there would put a second freshness meter on top of its own.
    if (this.#view === "trip") return;
    const key = this.#map.vehicles?.selectedKey;
    if (!key) return;
    const vehicle = this.#vehicles.find((candidate) => candidate.key === key);
    if (vehicle) this.#callout.show(vehicle);
  }

  // ---- chrome ------------------------------------------------------------

  #recenter(): void {
    if (this.#view === "trip" && this.#openTrip) {
      const bounds = boundsOf(this.#openTrip.shape);
      if (bounds) {
        this.#map.fit(bounds);
        return;
      }
    }
    this.#map.map.easeTo({ center: [11.15, 43.55], zoom: 8.1, duration: 700 });
  }

  #onSheetHeight(height: number): void {
    document.documentElement.style.setProperty("--sheet-height", `${Math.round(height)}px`);

    // Above 720 px the sheet stops being a bottom sheet and becomes a left
    // column, so the obscured edge moves with it — see `sheet.css`.
    this.#map.setPadding(
      window.matchMedia("(min-width: 720px)").matches
        ? { top: 0, bottom: 0, left: WIDE_PANEL_WIDTH }
        : { top: 0, bottom: Math.min(height, window.innerHeight * 0.5), left: 0 },
    );
  }

  #onVisibilityChange(): void {
    // A backgrounded tab must not keep polling a rider's mobile data, and the
    // first thing they see on return must not be a two-minute-old fleet.
    if (!document.hidden) void this.#refreshVehicles();
  }

  #setBusy(busy: boolean): void {
    document.body.classList.toggle("is-busy", busy);
    if (busy) {
      this.#busyButtons = [...document.querySelectorAll<HTMLButtonElement>(".cta")];
      for (const cta of this.#busyButtons) cta.disabled = true;
      return;
    }
    // Re-enable exactly the buttons that were disabled, rather than re-querying
    // the document: a successful search swaps the search panel out of the DOM
    // before this runs, so a fresh query would miss the now-detached button and
    // leave it disabled — and `cursor: progress` on it — forever.
    for (const cta of this.#busyButtons) cta.disabled = false;
    this.#busyButtons = [];
  }

  #reportError(error: unknown): void {
    query(document, "#toast").textContent = messageFor(error);
    query(document, "#toast").hidden = false;
  }

  #clearError(): void {
    query(document, "#toast").hidden = true;
  }
}

/**
 * What to tell a rider when a request fails.
 *
 * `not_found` on a trip is its own case and a real one: about one live bus in
 * thirty carries a `trip_id` that is not in the published timetable (extra
 * service the static feed does not describe). Saying "errore" there would be
 * wrong — the bus exists, we simply have no schedule to lay against it.
 */
function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) return "Qualcosa non ha funzionato. Riprova.";
  if (error.offline) return "Sei offline. I dati sulla mappa restano, invecchiando.";
  if (error.code === "not_found" && error.message.includes("trip")) {
    return "Questo bus non è in orario pubblicato: puoi seguirlo sulla mappa, ma non c'è una tabella di marcia.";
  }
  if (error.code === "rate_limited") return "Troppe richieste. Riprova tra un minuto.";
  return error.message;
}

function todayServiceDate(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

new App();
