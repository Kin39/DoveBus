import { t } from "../i18n/index.js";
import { clear, el } from "./dom.js";
import { clockToMinutes } from "./when.js";

/** Which ring the dial is showing. */
type Mode = "hours" | "minutes";

/** The minutes the dial offers, and the step the hand snaps to. */
const MINUTE_STEP = 5;

/** Geometry, in the 0–100 space the CSS positions percentages in. */
const CENTRE = 50;
const OUTER_RADIUS = 39;
const INNER_RADIUS = 25;

/**
 * Where the number at a clock position sits, as percentages of the face.
 *
 * Position 0 is twelve o'clock and they run clockwise, which is the only thing
 * about a clock face nobody has to be told.
 */
export function dialPoint(position: number, radius: number): { x: number; y: number } {
  const angle = (position * Math.PI) / 6 - Math.PI / 2;
  return {
    x: CENTRE + radius * Math.cos(angle),
    y: CENTRE + radius * Math.sin(angle),
  };
}

/**
 * The hour at a clock position: `1`–`12` on the outer ring, `13`–`23` and `00`
 * on the inner one — midnight at the top, where twelve is.
 */
export function hourAt(position: number, ring: "outer" | "inner"): number {
  if (ring === "outer") return position === 0 ? 12 : position;
  return position === 0 ? 0 : 12 + position;
}

/** The clock position an hour occupies, and which ring it is on. */
function placeOf(hour: number): { position: number; ring: "outer" | "inner" } {
  if (hour === 0) return { position: 0, ring: "inner" };
  if (hour === 12) return { position: 0, ring: "outer" };
  return hour > 12 ? { position: hour - 12, ring: "inner" } : { position: hour, ring: "outer" };
}

/**
 * The hour, on a clock face.
 *
 * The columns this replaces were honest and nobody enjoyed them: choosing 07:45
 * meant reading two lists of numbers, which is the thing a clock face exists to
 * spare you. This is the dial an Android phone shows — twelve hours outside,
 * the other twelve inside, midnight at the top, the minutes on their own ring
 * afterwards — with the site's ink instead of Material's pink, and without the
 * OK button: every tap commits to the field, so leaving early leaves a time that
 * is true rather than one that was abandoned.
 *
 * Deliberately no dragging of the hand. It is the one gesture of the Material
 * dial that a mouse learns second and a screen reader never learns at all, and
 * every value it can reach is one tap away without it.
 */
export function clockDial(
  value: string,
  onChange: (clock: string) => void,
  onDone: () => void,
): HTMLElement {
  const start = clockToMinutes(value) ?? 0;
  let hour = Math.floor(start / 60);
  let minute = start % 60;
  let mode: Mode = "hours";

  const root = el("div", { class: "dial" });

  const clock = (): string => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const render = (): void => {
    clear(root);
    root.append(head(), face());
  };

  /**
   * The readout, and the way back to the hours.
   *
   * Both halves are buttons: the dial moves on from the hours by itself, and a
   * rider who then wants a different hour must not have to close the panel and
   * open it again to say so.
   */
  const head = (): HTMLElement => {
    const part = (kind: Mode, text: string): HTMLButtonElement => {
      const button = el("button", {
        type: "button",
        class: "dial__part",
        text,
        "aria-label": `${kind === "hours" ? t.search.hours : t.search.minutes} ${text}`,
        "aria-pressed": mode === kind,
      });
      button.addEventListener("click", () => {
        mode = kind;
        render();
      });
      return button;
    };

    return el("div", { class: "dial__head" }, [
      part("hours", String(hour).padStart(2, "0")),
      el("span", { class: "dial__colon", text: ":", "aria-hidden": true }),
      part("minutes", String(minute).padStart(2, "0")),
    ]);
  };

  const face = (): HTMLElement => {
    const surface = el("div", {
      class: "dial__face",
      role: "group",
      "aria-label": mode === "hours" ? t.search.hours : t.search.minutes,
    });
    surface.append(hand());

    if (mode === "hours") {
      for (const ring of ["outer", "inner"] as const) {
        const radius = ring === "outer" ? OUTER_RADIUS : INNER_RADIUS;
        for (let position = 0; position < 12; position += 1) {
          const at = hourAt(position, ring);
          surface.append(
            numberButton(
              String(at).padStart(2, "0"),
              dialPoint(position, radius),
              at === hour,
              ring,
              () => {
                hour = at;
                onChange(clock());
                mode = "minutes";
                render();
              },
            ),
          );
        }
      }
      return surface;
    }

    for (let position = 0; position < 12; position += 1) {
      const at = position * MINUTE_STEP;
      surface.append(
        numberButton(
          String(at).padStart(2, "0"),
          dialPoint(position, OUTER_RADIUS),
          Math.round(minute / MINUTE_STEP) % 12 === position,
          "outer",
          () => {
            minute = at;
            onChange(clock());
            onDone();
          },
        ),
      );
    }
    return surface;
  };

  /** The pointer: a line from the middle to the number, and a disc under it. */
  const hand = (): SVGElement => {
    const place =
      mode === "hours"
        ? placeOf(hour)
        : { position: Math.round(minute / MINUTE_STEP) % 12, ring: "outer" as const };
    const radius = place.ring === "outer" ? OUTER_RADIUS : INNER_RADIUS;
    const tip = dialPoint(place.position, radius);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "dial__hand");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      `<line x1="${CENTRE}" y1="${CENTRE}" x2="${tip.x}" y2="${tip.y}" />` +
      `<circle cx="${CENTRE}" cy="${CENTRE}" r="1.8" />`;
    return svg;
  };

  render();
  return root;
}

function numberButton(
  text: string,
  at: { x: number; y: number },
  selected: boolean,
  ring: "outer" | "inner",
  onPick: () => void,
): HTMLButtonElement {
  const button = el("button", {
    type: "button",
    class: `dial__num${ring === "inner" ? " dial__num--inner" : ""}`,
    text,
    "aria-pressed": selected,
    ...(selected ? { "data-selected": "true" } : {}),
  });
  button.style.left = `${at.x}%`;
  button.style.top = `${at.y}%`;
  button.addEventListener("click", onPick);
  return button;
}
