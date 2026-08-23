import { t } from "../i18n/index.js";
import {
  ageFromTimestamp,
  ageLabel,
  bucketOf,
  FRESHNESS_FULL_S,
  freshnessLabel,
} from "./format.js";

/** Redraw cadence when the device asks for less motion: still true, just calmer. */
const REDUCED_MOTION_INTERVAL_MS = 1000;

/**
 * The freshness readout — the one thing this interface is built around.
 *
 * The project's whole position on honesty is that a colour must never outlive
 * the fact it describes, so this does not render a value handed to it once. It
 * holds the bus's own timestamp and recomputes the age on every frame: the
 * number climbs while you watch, the bar fills toward the point where the fix
 * stops being worth trusting, and both reset only when the bus actually reports
 * again. A stalled feed therefore *looks* stalled, which is the point — nothing
 * here can quietly keep claiming "recente" for a bus that went silent.
 */
export class FreshnessMeter {
  readonly element: HTMLElement;
  readonly #age: HTMLElement;
  readonly #label: HTMLElement;
  readonly #bar: HTMLElement;

  #timestamp: number | null = null;
  #frame: number | null = null;
  #timer: number | null = null;
  #reducedMotion: boolean;

  constructor() {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.#reducedMotion = query.matches;
    query.addEventListener("change", (event) => {
      this.#reducedMotion = event.matches;
      this.#restart();
    });

    this.element = document.createElement("div");
    this.element.className = "meter";
    this.element.innerHTML = `
      <div class="meter__row">
        <span class="meter__age" role="status" aria-live="off"></span>
        <span class="meter__label"></span>
      </div>
      <div class="meter__track" role="presentation"><div class="meter__bar"></div></div>
    `;
    this.#age = this.element.querySelector(".meter__age") as HTMLElement;
    this.#label = this.element.querySelector(".meter__label") as HTMLElement;
    this.#bar = this.element.querySelector(".meter__bar") as HTMLElement;
  }

  /** Points the meter at a new fix. Called on every snapshot the stream delivers. */
  setTimestamp(timestamp: number | null): void {
    const changed = timestamp !== this.#timestamp;
    this.#timestamp = timestamp;
    this.#render();
    if (changed && timestamp !== null) this.#flash();
    this.#restart();
  }

  stop(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#frame = null;
    this.#timer = null;
  }

  #restart(): void {
    this.stop();
    if (this.#reducedMotion) {
      this.#timer = window.setInterval(() => this.#render(), REDUCED_MOTION_INTERVAL_MS);
      return;
    }
    const step = (): void => {
      this.#render();
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  /** One pulse per real snapshot — the only unprompted motion in the interface. */
  #flash(): void {
    if (this.#reducedMotion) return;
    this.element.classList.remove("meter--pulse");
    void this.element.offsetWidth;
    this.element.classList.add("meter--pulse");
  }

  #render(): void {
    const age = ageFromTimestamp(this.#timestamp);
    const bucket = bucketOf(age);

    this.#age.textContent = ageLabel(age);
    this.#label.textContent = freshnessLabel(bucket);
    this.element.dataset.freshness = bucket;

    const filled = age === null ? 1 : Math.min(1, age / FRESHNESS_FULL_S);
    this.#bar.style.transform = `scaleX(${filled.toFixed(4)})`;

    this.element.setAttribute("aria-label", t.meter.label(freshnessLabel(bucket), ageLabel(age)));
  }
}
