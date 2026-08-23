import { t } from "../i18n/index.js";
import { clear, el } from "./dom.js";
import { clockToMinutes, dayParts, firstOfMonth, monthGrid, stepDay } from "./when.js";

/** The minutes a rider actually asks about. A timetable search is not a stopwatch. */
const MINUTE_STEP = 5;

/**
 * The hour, as two columns to pick from.
 *
 * This is what the native control was doing better than a bare text field, and
 * what its replacement had lost: on a phone there are no arrow keys, so an
 * interface that offers only typing and stepping offers only typing. Hours and
 * minutes are shown side by side rather than one after the other — picking an
 * hour and picking a minute are one gesture apart, and a wheel that hides the
 * hours while you choose the minutes is a wheel you have to scroll back.
 *
 * Both columns commit on tap: choosing only the hour keeps the minutes that were
 * already there, which is what "dalle 9" means when the field said 09:35.
 */
export function clockPicker(value: string, onPick: (clock: string) => void): HTMLElement {
  const minutes = clockToMinutes(value) ?? 0;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  const hours = column(t.search.hours, 24, 3, (index) => ({
    text: String(index).padStart(2, "0"),
    selected: index === hour,
    pick: () => onPick(`${String(index).padStart(2, "0")}:${String(minute).padStart(2, "0")}`),
  }));

  const step = 60 / MINUTE_STEP;
  const minuteColumn = column(t.search.minutes, step, 2, (index) => {
    const each = index * MINUTE_STEP;
    return {
      text: String(each).padStart(2, "0"),
      // The current minute is rarely a multiple of five — mark the step it sits
      // in rather than nothing at all.
      selected: Math.floor(minute / MINUTE_STEP) === index,
      pick: () => onPick(`${String(hour).padStart(2, "0")}:${String(each).padStart(2, "0")}`),
    };
  });

  return el("div", { class: "picker__cols" }, [hours, minuteColumn]);
}

/**
 * `width` is in cells: three across for the hours, so most of the day is on
 * screen at once, two for the minutes, which fit whole either way.
 */
function column(
  label: string,
  count: number,
  width: number,
  describe: (index: number) => { text: string; selected: boolean; pick: () => void },
): HTMLElement {
  const list = el("div", { class: "picker__col", role: "group", "aria-label": label });
  list.style.setProperty("--cols", String(width));
  list.append(el("p", { class: "picker__collabel", text: label, "aria-hidden": true }));

  for (let index = 0; index < count; index += 1) {
    const item = describe(index);
    const button = el("button", {
      type: "button",
      class: "picker__cell",
      text: item.text,
      "aria-pressed": item.selected,
      ...(item.selected ? { "data-selected": "true" } : {}),
    });
    button.addEventListener("click", item.pick);
    list.append(button);
  }
  return list;
}

/**
 * The day, as the month it belongs to.
 *
 * Six rows always, so the panel does not change height between February and
 * August and move what the reader was reaching for. Arrow keys walk the grid a
 * day and a week at a time and cross into the neighbouring month, which is the
 * one thing a calendar has to get right for a keyboard.
 */
export function dayPicker(value: string, onPick: (day: string) => void): HTMLElement {
  const root = el("div", { class: "picker__day" });
  let shown = value;

  const render = (): void => {
    clear(root);
    const { year, month } = dayParts(shown);

    const back = iconButton("‹", t.search.previousMonth, () => {
      shown = firstOfMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
      render();
    });
    const forward = iconButton("›", t.search.nextMonth, () => {
      shown = firstOfMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
      render();
    });

    root.append(
      el("div", { class: "picker__head" }, [
        back,
        el("p", { class: "picker__month", text: monthLabel(year, month) }),
        forward,
      ]),
      weekdayRow(),
    );

    const grid = el("div", { class: "picker__grid", role: "group", "aria-label": t.search.day });
    for (const day of monthGrid(year, month)) {
      if (day === null) {
        grid.append(el("span", { class: "picker__blank", "aria-hidden": true }));
        continue;
      }
      const selected = day === value;
      const cell = el("button", {
        type: "button",
        class: "picker__cell picker__cell--day",
        text: String(dayParts(day).day),
        "aria-label": fullDayLabel(day),
        "aria-pressed": selected,
        ...(selected ? { "data-selected": "true" } : {}),
      });
      cell.addEventListener("click", () => onPick(day));
      cell.addEventListener("keydown", (event) => {
        const delta = ARROW_DAYS[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        const target = stepDay(day, delta);
        const { year: targetYear, month: targetMonth } = dayParts(target);
        if (targetYear !== year || targetMonth !== month) {
          shown = target;
          render();
        }
        root.querySelector<HTMLElement>(`[data-day="${target}"]`)?.focus();
      });
      cell.dataset.day = day;
      grid.append(cell);
    }
    root.append(grid);
  };

  render();
  return root;
}

const ARROW_DAYS: Record<string, number | undefined> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

function iconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", {
    type: "button",
    class: "picker__step",
    "aria-label": label,
    text: glyph,
  });
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Monday first, in both languages: it is how a calendar is printed in Italy and
 * in the UK, and `Intl`'s own first-day-of-week would put Sunday in front for
 * some English locales — a grid whose columns move with the reader's passport is
 * a grid that has to be re-read.
 */
function weekdayRow(): HTMLElement {
  const format = new Intl.DateTimeFormat(t.locale, { weekday: "narrow" });
  const row = el("div", { class: "picker__week", "aria-hidden": true });
  for (let day = 0; day < 7; day += 1) {
    // 5 January 2026 is a Monday — any Monday would do.
    row.append(el("span", { text: format.format(new Date(2026, 0, 5 + day)) }));
  }
  return row;
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat(t.locale, { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

function fullDayLabel(serviceDate: string): string {
  const { year, month, day } = dayParts(serviceDate);
  return new Intl.DateTimeFormat(t.locale, { dateStyle: "full" }).format(
    new Date(year, month - 1, day),
  );
}
