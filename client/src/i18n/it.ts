import type { Strings } from "./strings.js";

/**
 * Italian — the language this interface was written in, moved here unchanged.
 *
 * Every sentence is the one that was already on screen: the point of the move
 * was to make a second language possible, not to take the chance to reword the
 * first. Where wording is load-bearing the reasoning stayed with it.
 */
export const it: Strings = {
  locale: "it-IT",

  /**
   * "silenzioso" rather than a translation of "stale": the honest statement
   * about an old fix is that the bus has stopped reporting, not that its
   * position is wrong. The exact age in seconds is always printed next to this
   * word, so the label never has to carry precision it does not have.
   */
  freshness: {
    live: "in diretta",
    recent: "recente",
    delayed: "attenuato",
    stale: "silenzioso",
  },

  age: {
    unknown: "orario sconosciuto",
    now: "adesso",
    seconds: (value) => `${value} s fa`,
    minutes: (value) => `${value} min fa`,
    hours: (value) => `${value} h fa`,
  },

  meter: {
    label: (freshness, age) => `Posizione ${freshness}, aggiornata ${age}`,
  },

  delay: {
    cancelled: "soppressa",
    onTime: "in orario",
    early: (minutes) => `${minutes} min in anticipo`,
    late: (minutes) => `+${minutes} min`,
  },

  duration: {
    minutes: (value) => `${value} min`,
    hoursMinutes: (hours, minutes) => `${hours} h ${String(minutes).padStart(2, "0")}`,
  },

  search: {
    modes: "Modo di ricerca",
    tabOd: "Tra comuni",
    tabLine: "Per linea",
    origin: "Parto da",
    originPlaceholder: "Arezzo",
    destination: "Arrivo a",
    destinationPlaceholder: "Anghiari",
    swap: "Inverti partenza e arrivo",
    line: "Linea",
    linePlaceholder: "SI381, BAAS, 30…",
    day: "Giorno",
    dayPlaceholder: "gg/mm/aaaa",
    from: "Dalle",
    to: "Alle",
    whenHint: (shape) =>
      `Formato ${shape}. Le frecce su e giù cambiano il valore, con shift a passi più grandi.`,
    whenReverted: (value) => `Non l'ho capito: resta ${value}.`,
    pickDay: "Scegli il giorno",
    pickClock: "Scegli l'ora",
    previousMonth: "Mese precedente",
    nextMonth: "Mese successivo",
    hours: "Ore",
    minutes: "Minuti",
    clockPlaceholder: "hh:mm",
    submit: "Cerca corse",
    noLine: "Nessuna linea con questo nome.",
    noComune: "Nessun comune con questo nome.",
  },

  results: {
    back: "Ricerca",
    today: "oggi",
    shortDate: (day, month) => `${day}/${month}`,
    window: (when, from, to) => `${when} ${from}–${to}`,
    count: (total) => `${total} ${total === 1 ? "corsa" : "corse"}`,
    firstCount: (total) => `Prime ${total} corse`,
    emptyTitle: "Nessuna corsa in questa fascia oraria.",
    emptyHint:
      "Allarga l’orario o controlla il giorno: molte linee extraurbane non viaggiano la domenica.",
    running: "in viaggio",
    runningTitle: "Un bus sta viaggiando su questa corsa",
    rowLabel: ({ line, departure, origin, arrival, destination }) =>
      `Linea ${line}, partenza ${departure} da ${origin}, arrivo ${arrival} a ${destination}`,
  },

  trip: {
    back: "Corse",
    unknownDestination: "Destinazione ignota",
    stops: "Fermate",
    noBus: "Nessun bus in viaggio su questa corsa.",
    noBusHint: "La posizione compare quando il bus parte e inizia a trasmettere.",
    notRunningToday: "Questa corsa non è prevista nel giorno scelto.",
    stopOf: (index, total) => `fermata ${index} di ${total}`,
    reconnecting: "riconnessione…",
    estimateMetres: (metres) =>
      `Posizione stimata: avanzata di ~${metres} m dall'ultimo dato ricevuto.`,
    estimateKilometres: (kilometres) =>
      `Posizione stimata: avanzata di ~${kilometres} km dall'ultimo dato ricevuto.`,
    // The green line is a reconstruction and the dots are observations, and the
    // difference between those two is not something to leave implicit.
    trail: "Percorso compiuto ricostruito sul tracciato della linea.",
    trailWithPoints: (points) =>
      `Percorso compiuto ricostruito sul tracciato della linea. I punti sono le ${points} posizioni ricevute da quando DoveBus segue questa corsa.`,
  },

  callout: {
    label: "Bus selezionato",
    close: "Chiudi",
    vehicle: (label) => `Vettura ${label}`,
    inService: "In servizio",
    outOfService: "Fuori servizio",
    follow: "Segui questa corsa",
    /** GTFS-RT occupancy, in words a rider standing at the door would use. */
    occupancy: {
      EMPTY: "vuoto",
      MANY_SEATS_AVAILABLE: "molti posti",
      FEW_SEATS_AVAILABLE: "pochi posti",
      STANDING_ROOM_ONLY: "solo in piedi",
      CRUSHED_STANDING_ROOM_ONLY: "molto pieno",
      FULL: "pieno",
      NOT_ACCEPTING_PASSENGERS: "non accetta passeggeri",
    },
  },

  credits: {
    data: "Dati: Regione Toscana — dati.toscana.it (CC BY 4.0)",
    boundaries: (basemap) => `Confini comunali: openpolis / ISTAT · ${basemap}`,
    basemap: {
      openfreemap: "Mappa © OpenStreetMap, OpenMapTiles, OpenFreeMap",
      carto: "Mappa © OpenStreetMap, CARTO",
    },
    basemapUnknown: "Mappa © OpenStreetMap",
    attributionHtml: [
      'Dati: <a href="https://dati.toscana.it/" target="_blank" rel="noopener">Regione Toscana</a> (CC BY 4.0)',
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      "© CARTO",
    ].join(" · "),
    nav: "Pagine del sito",
    links: [
      { href: "/come-funziona/", text: "Come funziona" },
      { href: "/fonte-dati/", text: "Fonte dati" },
      { href: "/privacy/", text: "Privacy" },
    ],
    otherLanguage: {
      href: "/en/map/",
      name: "English",
      label: "Read this page in English",
      lang: "en",
    },
  },

  errors: {
    generic: "Qualcosa non ha funzionato. Riprova.",
    offline: "Sei offline. I dati sulla mappa restano, invecchiando.",
    unreachable: "Nessuna connessione al servizio.",
    badResponse: "Il servizio ha risposto in un formato imprevisto.",
    badService: "Il servizio non ha risposto correttamente.",
    /**
     * A real case, not a defensive one: about one live bus in eight carries a
     * `trip_id` the published timetable does not contain — extra service the
     * static feed does not describe. Saying "errore" there would be wrong; the
     * bus exists, we simply have no schedule to lay against it.
     */
    unscheduledTrip:
      "Questo bus non è in orario pubblicato: puoi seguirlo sulla mappa, ma non c'è una tabella di marcia.",
    rateLimited: "Troppe richieste. Riprova tra un minuto.",
  },
};
