import type { Strings } from "./strings.js";

/**
 * English, for the visitor who is standing at a Tuscan bus stop and does not
 * read Italian.
 *
 * Translated for that person rather than for a dictionary. Two consequences
 * worth stating, because both look like mistakes until they are explained:
 *
 * **The day is still written `dd/mm/yyyy` and the hour is still 24-hour.** This
 * page is about Italian timetables, read next to Italian signs, in a country
 * that writes both that way — a visitor who reads `08/12` here and `08/12` on
 * the pole at the stop must not get two different days. The format is a
 * property of the subject, not of the reader's passport.
 *
 * **Stop names, line codes and headsigns stay Italian**, here as everywhere:
 * they are what is written on the front of the bus and on the pole. Translating
 * "SANTA MARIA SOPRARNO" would help nobody find it.
 */
export const en: Strings = {
  locale: "en-GB",
  prefix: "/en",

  freshness: {
    live: "live",
    recent: "recent",
    delayed: "fading",
    // The honest statement about an old fix is that the bus has stopped
    // reporting, not that its position is wrong.
    stale: "silent",
  },

  age: {
    unknown: "time unknown",
    now: "just now",
    seconds: (value) => `${value} s ago`,
    minutes: (value) => `${value} min ago`,
    hours: (value) => `${value} h ago`,
  },

  meter: {
    label: (freshness, age) => `${freshness} position, updated ${age}`,
  },

  delay: {
    cancelled: "cancelled",
    onTime: "on time",
    early: (minutes) => `${minutes} min early`,
    late: (minutes) => `+${minutes} min`,
  },

  duration: {
    minutes: (value) => `${value} min`,
    hoursMinutes: (hours, minutes) => `${hours} h ${String(minutes).padStart(2, "0")}`,
  },

  search: {
    modes: "Search mode",
    tabOd: "Between towns",
    tabLine: "By line",
    origin: "Leaving from",
    originPlaceholder: "Arezzo",
    destination: "Going to",
    destinationPlaceholder: "Anghiari",
    swap: "Swap origin and destination",
    line: "Line",
    linePlaceholder: "SI381, BAAS, 30…",
    day: "Day",
    dayPlaceholder: "dd/mm/yyyy",
    from: "From",
    to: "To",
    clockPlaceholder: "hh:mm",
    submit: "Find departures",
    noLine: "No line by that name.",
    noComune: "No town by that name.",
  },

  results: {
    back: "Search",
    today: "today",
    shortDate: (day, month) => `${day}/${month}`,
    window: (when, from, to) => `${when} ${from}–${to}`,
    count: (total) => `${total} ${total === 1 ? "trip" : "trips"}`,
    firstCount: (total) => `First ${total} trips`,
    emptyTitle: "No departures in this time window.",
    emptyHint: "Widen the hours or check the day: many intercity lines do not run on Sundays.",
    running: "running",
    runningTitle: "A bus is running this trip",
    rowLabel: ({ line, departure, origin, arrival, destination }) =>
      `Line ${line}, departs ${departure} from ${origin}, arrives ${arrival} at ${destination}`,
  },

  trip: {
    back: "Trips",
    unknownDestination: "Destination unknown",
    stops: "Stops",
    noBus: "No bus is running this trip.",
    noBusHint: "The position appears once the bus sets off and starts transmitting.",
    notRunningToday: "This trip does not run on the day you chose.",
    stopOf: (index, total) => `stop ${index} of ${total}`,
    reconnecting: "reconnecting…",
    estimateMetres: (metres) =>
      `Estimated position: moved ~${metres} m on from the last data received.`,
    estimateKilometres: (kilometres) =>
      `Estimated position: moved ~${kilometres} km on from the last data received.`,
    trail: "Path travelled, reconstructed along the line's own shape.",
    trailWithPoints: (points) =>
      `Path travelled, reconstructed along the line's own shape. The dots are the ${points} positions received since DoveBus started following this trip.`,
  },

  callout: {
    label: "Selected bus",
    close: "Close",
    vehicle: (label) => `Vehicle ${label}`,
    inService: "In service",
    outOfService: "Not in service",
    follow: "Follow this trip",
    occupancy: {
      EMPTY: "empty",
      MANY_SEATS_AVAILABLE: "many seats",
      FEW_SEATS_AVAILABLE: "few seats",
      STANDING_ROOM_ONLY: "standing only",
      CRUSHED_STANDING_ROOM_ONLY: "very full",
      FULL: "full",
      NOT_ACCEPTING_PASSENGERS: "not taking passengers",
    },
  },

  credits: {
    // The licence names the publisher, and a licence obligation is discharged in
    // the words of the page it appears on — but never by renaming the publisher.
    data: "Data: Regione Toscana — dati.toscana.it (CC BY 4.0)",
    boundaries: (basemap) => `Municipal boundaries: openpolis / ISTAT · ${basemap}`,
    basemap: {
      openfreemap: "Map © OpenStreetMap, OpenMapTiles, OpenFreeMap",
      carto: "Map © OpenStreetMap, CARTO",
    },
    basemapUnknown: "Map © OpenStreetMap",
    attributionHtml: [
      'Data: <a href="https://dati.toscana.it/" target="_blank" rel="noopener">Regione Toscana</a> (CC BY 4.0)',
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      "© CARTO",
    ].join(" · "),
    nav: "Site pages",
    links: [
      { href: "/en/how-it-works/", text: "How it works" },
      { href: "/en/data-source/", text: "Data source" },
      { href: "/en/privacy/", text: "Privacy" },
    ],
  },

  errors: {
    generic: "Something went wrong. Try again.",
    offline: "You are offline. What is on the map stays, and ages.",
    unreachable: "No connection to the service.",
    badResponse: "The service replied in an unexpected format.",
    badService: "The service did not reply correctly.",
    unscheduledTrip:
      "This bus is not in the published timetable: you can follow it on the map, but there is no schedule to hold it against.",
    rateLimited: "Too many requests. Try again in a minute.",
  },
};
