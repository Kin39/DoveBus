import { describe, expect, test } from "vitest";
import {
  collapseRepeats,
  isoDate,
  renderComunePage,
  renderIndexPage,
  renderLinePage,
  spelledDate,
  titleCase,
} from "../seo/render.js";

describe("titleCase", () => {
  test("turns the feed's shouting into something readable", () => {
    // Every stop name in the feed is capitalised. A page of forty such lines is
    // a page nobody reads.
    expect(titleCase("SALUTATI CECCHI")).toBe("Salutati Cecchi");
    expect(titleCase("STAZIONE MONTELUNGO")).toBe("Stazione Montelungo");
  });

  test("keeps Italian particles down, except at the start", () => {
    expect(titleCase("MUSEO GINO BARTALI")).toBe("Museo Gino Bartali");
    expect(titleCase("CIMITERO SAN PIERO A EMA")).toBe("Cimitero San Piero a Ema");
    expect(titleCase("DI ANTELLA PERUZZI")).toBe("Di Antella Peruzzi");
  });

  test("leaves Roman numerals as Roman numerals", () => {
    // "XXVII APRILE" came out as "Xxvii Aprile" — a date in a street name,
    // rendered as a typo, on a hundred pages.
    expect(titleCase("INDIPENDENZA XXVII APRILE")).toBe("Indipendenza XXVII Aprile");
    expect(titleCase("PIAZZA XX SETTEMBRE")).toBe("Piazza XX Settembre");
    expect(titleCase("VITTORIO EMANUELE II")).toBe("Vittorio Emanuele II");
  });

  test("does not mistake an Italian word for a Roman numeral", () => {
    // "DI", "MI", "CI", "LI" and "VI" are all valid Roman numerals and all
    // ordinary Italian words. The words win.
    expect(titleCase("DI ANTELLA")).toBe("Di Antella");
    expect(titleCase("CHIANTIGIANA DI SOTTO")).toBe("Chiantigiana di Sotto");
    // Not "VI": the reader meets the word far more often than the numeral.
    expect(titleCase("PONTE VI MAGGIO")).toBe("Ponte Vi Maggio");
  });

  test("capitalises the name after an elided article", () => {
    // "GRAN BRETAGNA D'ANGIÒ" was coming out "D'angiò".
    expect(titleCase("GRAN BRETAGNA D'ANGIÒ")).toBe("Gran Bretagna d'Angiò");
    expect(titleCase("CHIANTIGIANA DELL'ANTELLA")).toBe("Chiantigiana dell'Antella");
    expect(titleCase("SANT'ANDREA")).toBe("Sant'Andrea");
  });

  test("leaves codes alone", () => {
    expect(titleCase("FORTEZZA T1 STROZZI")).toBe("Fortezza T1 Strozzi");
    expect(titleCase("DI ANTELLA 05")).toBe("Di Antella 05");
  });

  test("drops the trailing underscore the feed uses to tell two poles apart", () => {
    expect(titleCase("ANTELLA_")).toBe("Antella");
  });

  test("starts a new phrase after a slash or a dash", () => {
    // Line names pack two destinations into one string. "SORGANE/BAGNO A
    // RIPOLI" was coming out "Sorgane/bagno a Ripoli", and "- IL GIRONE" as
    // "- il Girone": a particle is only a particle inside a phrase.
    expect(titleCase("T2 GUIDONI - SORGANE/BAGNO A RIPOLI")).toBe(
      "T2 Guidoni - Sorgane/Bagno a Ripoli",
    );
    expect(titleCase("SANTA MARIA MAGGIORE - IL GIRONE/VIA ROCCA TEDALDA")).toBe(
      "Santa Maria Maggiore - Il Girone/Via Rocca Tedalda",
    );
  });

  test("keeps an abbreviation's full stop", () => {
    expect(titleCase("BRIG. PARTIGIANE TORRICELLA")).toBe("Brig. Partigiane Torricella");
  });
});

describe("collapseRepeats", () => {
  test("says a name once when the feed lists two poles under it", () => {
    // "ANTELLA_" and "ANTELLA" are two stop ids with one name, and the page was
    // printing "Antella" twice in a row, which reads as a mistake because it is
    // indistinguishable from one.
    expect(collapseRepeats(["Antella", "Antella", "Di Antella Peruzzi"])).toEqual([
      "Antella",
      "Di Antella Peruzzi",
    ]);
  });

  test("keeps a name that genuinely recurs later in the route", () => {
    // Pistoia's lines run FS - … - FS. Two calls far apart are two calls.
    expect(collapseRepeats(["Pistoia FS", "Gello", "Pistoia FS"])).toEqual([
      "Pistoia FS",
      "Gello",
      "Pistoia FS",
    ]);
  });

  test("leaves a list with nothing to collapse alone", () => {
    expect(collapseRepeats(["Una", "Due", "Tre"])).toEqual(["Una", "Due", "Tre"]);
    expect(collapseRepeats([])).toEqual([]);
  });
});

describe("dates", () => {
  test("spells a compact date for a reader", () => {
    expect(spelledDate("20260918")).toBe("18 settembre 2026");
  });

  test("and writes the machine-readable form for datetime", () => {
    expect(isoDate("20260918")).toBe("2026-09-18");
  });
});

/** The smallest data that still exercises every branch a page has. */
function fixture() {
  const line = {
    routeId: "92",
    shortName: "32",
    longName: "piazzale Montelungo - Antella",
    comune: "Firenze",
    comuneSlug: "firenze",
    slug: "32-firenze",
    comuni: ["Firenze", "Bagno a Ripoli"],
    trips: 102,
    lengthKm: 18,
    directions: [
      {
        directionId: 0,
        headsign: "ANTELLA",
        trips: 52,
        first: "05:27",
        last: "21:38",
        headwayMinutes: 19,
        stops: ["Stazione Montelungo", "Antella"],
        itineraries: 3,
        coverage: 0.92,
      },
      {
        directionId: 1,
        headsign: null,
        trips: 1,
        first: "05:48",
        last: "05:48",
        headwayMinutes: null,
        stops: [],
        itineraries: 24,
        coverage: 0.17,
      },
    ],
  };
  const data = {
    feed: {
      startDate: "20260918",
      endDate: "20261008",
      sha1: "abc",
      importedAt: "2026-09-18T04:36:00.000Z",
    },
    referenceDate: "20260918",
    minimumTrips: 70,
    generatedAt: "2026-09-18T15:48:00.000Z",
    lines: [line],
  };
  return { line, data };
}

describe("renderLinePage", () => {
  const { line, data } = fixture();
  const html = renderLinePage(
    { kind: "line", path: "/linea/32-firenze/", line, parentPath: "/comune/firenze/" },
    data,
  );

  test("its canonical names the path it is served at", () => {
    // The build asserts this too. It is here as well because the build asserts
    // what the template produced, and this asserts what the template meant.
    expect(html).toContain('<link rel="canonical" href="%SITE_URL%/linea/32-firenze/" />');
  });

  test("declares no hreflang: it has no English twin", () => {
    expect(html).not.toContain("hreflang");
  });

  test("leads with the live link, carrying line and comune", () => {
    expect(html).toContain('href="/mappa/?linea=32&amp;comune=firenze"');
  });

  test("puts the breadcrumb in the body and its markup in the head", () => {
    // Written the other way round first, the nav sat inside <head> and the
    // browser hoisted it above the site header. Nothing failed; it just looked
    // wrong on 112 pages.
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain("BreadcrumbList");
    expect(head).not.toContain('<nav class="crumbs"');
    expect(html.slice(html.indexOf("<body>"))).toContain('<nav class="crumbs"');
  });

  test("names each direction and lists the stops of the one that has a route", () => {
    expect(html).toContain("Verso Antella.");
    expect(html).toContain('<li class="stops__item">Stazione Montelungo</li>');
  });

  test("says a direction has no single route rather than drawing one", () => {
    // The fixture's second direction spreads its runs over 24 itineraries, the
    // busiest covering 17% of the stops. Drawing a list there is what published
    // 255 stops for a line whose longest real run calls at 59.
    expect(html).toContain("24 percorsi diversi");
    expect(html).not.toContain("nessun autobus percorre davvero.</p>\n\n        <h3");
  });

  test("says the drawn route is the common one when variants exist", () => {
    expect(html).toContain("3 varianti");
  });

  test("omits the frequency for a direction that runs once", () => {
    expect(html).toContain("una ogni 19 min");
    expect(html.match(/una ogni/g)).toHaveLength(2); // il riassunto in alto e i dati della direzione
  });

  test("answers both directions' first and last run above the stop lists", () => {
    // Measured before the summary existed: the return direction's last
    // departure sat 3,000 px down a phone screen, behind forty stops.
    const beforeFirstSection = html.slice(0, html.indexOf('<section class="section'));
    expect(beforeFirstSection).toContain("05:27 – 21:38");
    expect(beforeFirstSection).toContain("05:48");
  });

  test("falls back to the direction number when the feed gives no headsign", () => {
    expect(html).toContain("direzione 1");
  });

  test("states the feed window, the day described, and where the times live", () => {
    expect(html).toContain("18 settembre 2026");
    expect(html).toContain("8 ottobre 2026");
    expect(html).toContain("at-bus.it");
    expect(html).toContain("18 km");
  });

  test("escapes what comes out of the feed", () => {
    const hostile = {
      ...line,
      longName: '<script>alert("x")</script>',
      comuni: ["A & B", "Firenze"],
    };
    const rendered = renderLinePage(
      { kind: "line", path: "/linea/32-firenze/", line: hostile, parentPath: null },
      data,
    );
    expect(rendered).not.toContain("<script>alert");
    expect(rendered).toContain("A &amp; B");
  });

  test("omits the length when the shape did not give a plausible one", () => {
    const rendered = renderLinePage(
      {
        kind: "line",
        path: "/linea/32-firenze/",
        line: { ...line, lengthKm: null },
        parentPath: null,
      },
      data,
    );
    expect(rendered).not.toContain("Lunghezza del percorso");
  });
});

describe("renderComunePage and renderIndexPage", () => {
  const { line, data } = fixture();

  test("a comune page links every line it lists", () => {
    const html = renderComunePage(
      {
        kind: "comune",
        path: "/comune/firenze/",
        comune: "Firenze",
        slug: "firenze",
        lines: [line],
      },
      data,
    );
    expect(html).toContain('<link rel="canonical" href="%SITE_URL%/comune/firenze/" />');
    expect(html).toContain('href="/linea/32-firenze/"');
    expect(html).not.toContain("hreflang");
  });

  test("the index names a comune with a page as a link, one without as text", () => {
    const html = renderIndexPage(
      {
        kind: "index",
        path: "/linee/",
        comuni: [
          { comune: "Firenze", path: "/comune/firenze/", lines: [line] },
          { comune: "Vinci", path: null, lines: [line] },
        ],
      },
      data,
    );
    expect(html).toContain('<a href="/comune/firenze/">Firenze</a>');
    expect(html).toContain('<h3 class="comuni__name">Vinci</h3>');
    expect(html).toContain('<link rel="canonical" href="%SITE_URL%/linee/" />');
  });
});
