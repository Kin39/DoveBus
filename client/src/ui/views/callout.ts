import type { Vehicle } from "../../api/types.js";
import { t } from "../../i18n/index.js";
import { clear, el } from "../dom.js";
import { delayView, titleCase } from "../format.js";
import { FreshnessMeter } from "../freshness.js";

export interface VehicleCalloutOptions {
  readonly onFollow: (tripId: string) => void;
  readonly onDismiss: () => void;
}

/**
 * What a tapped bus says for itself.
 *
 * Floats above the sheet rather than replacing it: tapping a marker is an
 * exploratory gesture, and taking over the whole panel for it would throw away
 * whatever the rider was in the middle of.
 */
export class VehicleCallout {
  readonly element: HTMLElement;
  readonly #meter = new FreshnessMeter();
  readonly #options: VehicleCalloutOptions;

  constructor(options: VehicleCalloutOptions) {
    this.#options = options;
    this.element = el("aside", {
      class: "callout",
      hidden: true,
      "aria-label": t.callout.label,
    });
    document.body.append(this.element);
  }

  show(vehicle: Vehicle): void {
    clear(this.element);
    this.element.hidden = false;

    const dismiss = el("button", {
      class: "callout__close",
      type: "button",
      "aria-label": t.callout.close,
    });
    dismiss.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.5 6.5l11 11m0-11-11 11" /></svg>`;
    dismiss.addEventListener("click", () => this.#options.onDismiss());

    const head = el("div", { class: "callout__head" }, [
      el("span", { class: "plate" }, [
        el("span", { class: "plate__code", text: vehicle.line ?? "—" }),
      ]),
      el("span", {
        class: "callout__title",
        // A bus with no trip is a real thing in this feed — deadheading, or a run
        // the timetable does not carry — and saying so is better than a blank.
        text: vehicle.tripId
          ? titleCase(
              vehicle.vehicleLabel ? t.callout.vehicle(vehicle.vehicleLabel) : t.callout.inService,
            )
          : t.callout.outOfService,
      }),
      dismiss,
    ]);

    const badges = el("div", { class: "badges" });
    const delay = delayView(vehicle.delaySeconds, vehicle.cancelled);
    if (delay) {
      badges.append(
        el("span", { class: "badge", "data-tone": delay.tone }, [
          el("span", { class: "badge__value", text: delay.label }),
        ]),
      );
    }
    if (vehicle.occupancy) {
      badges.append(
        el("span", { class: "badge badge--quiet" }, [
          el("span", { class: "badge__value", text: occupancyLabel(vehicle.occupancy) }),
        ]),
      );
    }

    this.#meter.setTimestamp(vehicle.timestamp);
    this.element.append(head, this.#meter.element, badges);

    if (vehicle.tripId) {
      const follow = el("button", {
        class: "cta cta--compact",
        type: "button",
        text: t.callout.follow,
      });
      const tripId = vehicle.tripId;
      follow.addEventListener("click", () => this.#options.onFollow(tripId));
      this.element.append(follow);
    }
  }

  hide(): void {
    this.element.hidden = true;
    this.#meter.stop();
  }
}

/**
 * The feed's occupancy enum, in words a rider standing at the door would use.
 * An unknown value is shown as it arrived rather than hidden: a new enum member
 * is news, and "MOSTLY_FULL" tells a rider more than nothing does.
 */
function occupancyLabel(value: string): string {
  return t.callout.occupancy[value] ?? value.toLocaleLowerCase(t.locale).replaceAll("_", " ");
}
