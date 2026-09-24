import type {
  ComunePage,
  IndexPage,
  LineData,
  LineDirection,
  LinePage,
  LineSummary,
  Page,
} from "./pages.js";

/**
 * The HTML of a generated page.
 *
 * Written as strings rather than assembled from a template engine for the same
 * reason the rest of this site is: the four hand-written content pages are also
 * strings, they use the same classes, and a generated page that reached for a
 * different mechanism would drift away from them in look and in markup.
 *
 * The pages go through Vite's normal pipeline — `<!--@partial:…-->` and
 * `%SITE_URL%` are expanded there, the stylesheet and the font are hashed onto
 * them there, and `assertPairing` checks their canonical there. Nothing in this
 * file may hard-code an origin or a licence line.
 */

/** Escapes text going into an element. Stop names arrive from the feed. */
function text(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapes text going into a double-quoted attribute. */
function attribute(value: string): string {
  return text(value).replace(/"/g, "&quot;");
}

/**
 * Stop and headsign names as the feed shouts them: `ANTELLA_`, `SALUTATI
 * CECCHI`. Rendered in the reader's register instead, because a page of forty
 * capitalised lines is a page nobody reads.
 *
 * Conservative on purpose: it lowercases and re-caps words, leaves anything
 * that is not plainly a word alone, and keeps short particles down. It is not
 * trying to be a name database.
 */
const PARTICLES = new Set([
  "di",
  "da",
  "de",
  "del",
  "della",
  "dello",
  "dei",
  "delle",
  "degli",
  "a",
  "al",
  "alla",
  "e",
  "in",
  "su",
  "per",
  "con",
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
]);

/**
 * Roman numerals that are also ordinary Italian words.
 *
 * `DI`, `MI`, `CI`, `LI`, `VI` and `DID` are all well-formed Roman numerals,
 * and the first five are words this feed is full of — "DI ANTELLA" appears on
 * a dozen stops. The word wins: a stop called "Di Antella" rendered "DI
 * Antella" is a typo on every page it appears on, while a genuine numeral
 * written as a word is a rarity nobody will meet.
 */
const NUMERAL_LOOKALIKES = new Set(["di", "mi", "ci", "li", "vi", "dì", "d", "i", "l", "m", "c"]);

/** Well-formed Roman numerals, from I to a few thousand. */
const ROMAN = /^(?=[mdclxvi])m*(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3})$/i;

/** Elided articles: the name after the apostrophe is the name. */
const ELISION = /^(d|l|dell|nell|all|sull|dall|sant|s)['’]([a-zà-ÿ].*)$/i;

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * One token of a stop name, cased.
 *
 * Order matters: a token is a code, then a numeral, then an elision, then a
 * particle, then an ordinary word. Each test is narrower than the one after it.
 */
function caseToken(token: string, isFirst: boolean): string {
  // A token with a digit is a code, not a word: T1, SR429, 05.
  if (/\d/.test(token)) return token.toUpperCase();

  const bare = token.replace(/[.,;:]+$/, "");
  const trailing = token.slice(bare.length);

  if (ROMAN.test(bare) && !NUMERAL_LOOKALIKES.has(bare.toLowerCase())) {
    return bare.toUpperCase() + trailing;
  }

  const elision = ELISION.exec(bare);
  if (elision) {
    const article = elision[1] as string;
    const name = elision[2] as string;
    const head = isFirst ? capitalise(article.toLowerCase()) : article.toLowerCase();
    return `${head}'${capitalise(name.toLowerCase())}${trailing}`;
  }

  if (!isFirst && PARTICLES.has(bare.toLowerCase())) return bare.toLowerCase() + trailing;

  return capitalise(bare.toLowerCase()) + trailing;
}

/**
 * Separators that end a phrase, as opposed to merely ending a word.
 *
 * Line names pack two destinations into one string — "T2 GUIDONI -
 * SORGANE/BAGNO A RIPOLI" — and a particle is only a particle *inside* a
 * phrase. After one of these the next word starts a name again, so "il Girone"
 * following a dash is "Il Girone".
 */
const PHRASE_BREAK = /^[-–—/]$/;

export function titleCase(value: string): string {
  const cleaned = value.replace(/_+$/g, "").trim();
  let startsPhrase = true;
  return cleaned
    .split(/(\s+|[-–—/])/)
    .map((token) => {
      if (token === "" || /^\s+$/.test(token)) return token;
      if (PHRASE_BREAK.test(token)) {
        startsPhrase = true;
        return token;
      }
      const cased = caseToken(token, startsPhrase);
      startsPhrase = false;
      return cased;
    })
    .join("");
}

/**
 * Collapses a name repeated immediately, keeping one that recurs later.
 *
 * The feed gives the two poles of a terminus separate ids under one name —
 * `ANTELLA_` and `ANTELLA` — and the stop list was printing it twice in a row,
 * which a reader cannot tell from a mistake. A name that comes back further
 * along the route is a different matter: Pistoia's lines genuinely run FS to FS.
 */
export function collapseRepeats(stops: readonly string[]): readonly string[] {
  return stops.filter((stop, index) => index === 0 || stop !== stops[index - 1]);
}

/** `20260918` → `18 settembre 2026`, for a reader rather than a parser. */
export function spelledDate(compact: string): string {
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/** `20260918` → `2026-09-18`, for `datetime` and JSON-LD. */
export function isoDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

/**
 * The link to the live map, pre-loaded with this line.
 *
 * The single most valuable thing on the page, and the only thing on it no other
 * site can offer. It is the reason `map/urlstate.ts` exists.
 */
function liveHref(line: LineSummary): string {
  const params = new URLSearchParams({ linea: line.shortName, comune: line.comuneSlug });
  return `/mappa/?${params.toString()}`;
}

/**
 * A breadcrumb, in markup and on the page.
 *
 * `BreadcrumbList` is the one structured-data type here that earns its place:
 * unlike `Trip`, `BusTrip` or `Schedule` — which Google renders nothing from —
 * a breadcrumb produces a visible trail in the results in place of the raw URL.
 * It also states the hierarchy these pages are built around, which is the thing
 * the guidance on doorway pages asks for. It is rendered for the reader too:
 * markup that says something the page declines to say is the fault this site
 * has already spent time removing from its FAQ.
 */
interface Crumb {
  readonly name: string;
  readonly path: string;
}

/**
 * The breadcrumb's markup, for the head.
 *
 * `BreadcrumbList` is the one structured-data type here that earns its place:
 * unlike `Trip`, `BusTrip` or `Schedule` — which Google renders nothing from —
 * a breadcrumb produces a visible trail in the results in place of the raw URL.
 * It also states the hierarchy these pages are built around, which is what the
 * guidance on doorway pages asks a site to have.
 */
function breadcrumbMarkup(trail: readonly Crumb[]): string {
  const items = trail
    .map(
      (step, index) =>
        `{"@type":"ListItem","position":${index + 1},"name":${JSON.stringify(step.name)},` +
        `"item":"%SITE_URL%${step.path}"}`,
    )
    .join(",");

  return `    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[${items}]}
    </script>`;
}

/**
 * The same trail, for the reader.
 *
 * Separate from the markup above because the two belong in different halves of
 * the document, and putting the `<nav>` in the `<head>` — which is where it was
 * first written — makes the browser hoist it out and drop it above the site
 * header, before the wordmark. It rendered, which is exactly why it is worth a
 * note: nothing failed, the page simply had its navigation in the wrong place.
 *
 * It is rendered at all because markup that tells a crawler something the page
 * declines to tell a person is the fault this site has already spent time
 * removing from its FAQ.
 */
function breadcrumbNav(trail: readonly Crumb[]): string {
  const links = trail
    .map((step, index) =>
      index === trail.length - 1
        ? `<span aria-current="page">${text(step.name)}</span>`
        : `<a href="${attribute(step.path)}">${text(step.name)}</a>`,
    )
    .join('<span class="crumbs__sep" aria-hidden="true">\u203a</span>');

  return `<nav class="crumbs" aria-label="Percorso di navigazione">${links}</nav>`;
}

/** The head every generated page shares. Italian only: these pages have no twin. */
function head(options: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  /** Structured data for this page. Markup only: nothing that renders. */
  readonly markup?: string;
}): string {
  return `  <head>
    <!--@partial:head-common-->

    <title>${text(options.title)}</title>
    <meta name="description" content="${attribute(options.description)}" />
    <link rel="canonical" href="%SITE_URL%${options.path}" />

    <meta property="og:title" content="${attribute(options.title)}" />
    <meta property="og:description" content="${attribute(options.description)}" />
    <meta property="og:url" content="%SITE_URL%${options.path}" />
${options.markup ?? ""}
  </head>`;
}

/**
 * The provenance block every generated page ends with.
 *
 * Three obligations in one place. The CC-BY attribution is in the footer
 * partial and is not repeated here; what *is* here is what the footer cannot
 * know: which edition of the timetable these numbers came out of, the day they
 * describe, and where the authoritative timetable lives.
 *
 * That last link is not politeness. These pages deliberately do not publish a
 * departure-by-departure timetable — the feed is republished on 22 days out of
 * 24 and 71.4% of lines changed their departures between two editions — so the
 * page has to say plainly where the times that are not here can be found.
 */
function provenance(data: LineData, lengthKm: number | null): string {
  const km =
    lengthKm === null
      ? ""
      : `<p>Lunghezza del percorso: circa ${String(lengthKm).replace(".", ",")} km, misurata sul tracciato pubblicato nel feed.</p>`;

  return `
      <section class="section shell" aria-labelledby="dati-titolo">
        <div class="section__head">
          <h2 class="section__title" id="dati-titolo">Da dove vengono questi dati.</h2>
        </div>
        <div class="page__standfirst">
          <p>
            Dall'orario ufficiale pubblicato dalla Regione Toscana, edizione valida dal
            <time datetime="${isoDate(data.feed.startDate)}">${spelledDate(data.feed.startDate)}</time>
            al <time datetime="${isoDate(data.feed.endDate)}">${spelledDate(data.feed.endDate)}</time>.
            I conteggi descrivono
            <time datetime="${isoDate(data.referenceDate)}">${spelledDate(data.referenceDate)}</time>,
            un giorno feriale.
          </p>
          <p>
            L'orario cambia spesso, anche dentro la finestra che dichiara. Per gli orari di ogni
            singola corsa fa fede il gestore:
            <a href="https://www.at-bus.it/" rel="external">at-bus.it</a>.
          </p>
          ${km}
        </div>
      </section>`;
}

/** The two or three facts about a direction that are true of the day named. */
function serviceFacts(dir: LineDirection): string {
  const frequency =
    dir.headwayMinutes === null
      ? ""
      : `<li><span class="facts__k">Frequenza</span> <b>una ogni ${dir.headwayMinutes} min</b></li>`;
  return `<ul class="facts">
          <li><span class="facts__k">Prima corsa</span> <b>${dir.first}</b></li>
          <li><span class="facts__k">Ultima corsa</span> <b>${dir.last}</b></li>
          ${frequency}
        </ul>`;
}

/**
 * The route of one direction — or the reason there is none to draw.
 *
 * A line whose runs are spread over twenty itineraries has no single route, and
 * the honest page says so. Drawing one anyway was the previous behaviour and it
 * published journeys no bus makes: Prato's 207 listed 255 stops where its
 * busiest of 24 itineraries calls at 42.
 */
function directionRoute(dir: LineDirection, folded: boolean): string {
  if (dir.stops.length === 0) {
    return `<p class="note">
          Le corse di questa linea in questa direzione seguono
          <b>${dir.itineraries} percorsi diversi</b>, e nessuno di essi vale per la
          maggior parte di esse. Per questo qui non c'è un elenco di fermate: ne
          risulterebbe un tragitto che nessun autobus percorre davvero. La mappa
          in tempo reale mostra la strada che ogni singola corsa sta facendo.
        </p>`;
  }

  const stops = dir.stops
    .map((stop: string) => `<li class="stops__item">${text(stop)}</li>`)
    .join("\n            ");

  // Said once on the page rather than never: a reader comparing the list with
  // what they saw from the window deserves to know it is the common route and
  // not the only one.
  const variants =
    dir.itineraries > 1
      ? `<p class="note">Il percorso qui sotto è quello seguito dalla maggior parte delle corse.
          Alcune ne fanno uno leggermente diverso: in tutto questa direzione conta
          ${dir.itineraries} varianti.</p>`
      : "";

  // Folded shut past the first direction, and only then.
  //
  // A real route is a long list — the 32 calls at 39 stops each way, and that
  // is not padding, it is the line. Two of them open at once make a page 6.4
  // screens tall on a phone, most of it stop names the reader is scrolling
  // past to reach the other direction. `<details>` keeps every one of them in
  // the HTML, where a crawler reads them and a reader reaches them with one
  // tap, and costs no JavaScript: the site's FAQ already opens this way.
  const list = `<h3 class="stops__title">Fermate servite, in ordine di percorso</h3>
        <ol class="stops">
            ${stops}
        </ol>`;

  if (!folded) return `${variants}\n        ${list}`;

  return `${variants}
        <details class="fold">
          <summary class="fold__summary">
            Vedi le ${dir.stops.length} fermate di questa direzione
          </summary>
          <div class="fold__body">
            ${list}
          </div>
        </details>`;
}

function direction(line: LineSummary, index: number): string {
  const dir = line.directions[index];
  if (dir === undefined) return "";
  const towards = dir.headsign === null ? `direzione ${dir.directionId}` : titleCase(dir.headsign);
  const id = `direzione-${dir.directionId}`;

  return `
      <section class="section shell" aria-labelledby="${id}">
        <div class="section__head">
          <h2 class="section__title" id="${id}">Verso ${text(towards)}.</h2>
          <p class="section__intro">
            ${dir.trips} corse in un giorno feriale, dalle ${dir.first} alle ${dir.last}.
          </p>
        </div>
        ${serviceFacts(dir)}
        ${directionRoute(dir, index > 0)}
      </section>`;
}

/**
 * Both directions' service, at the top of the page.
 *
 * Measured before this existed: on a phone the second direction's first and
 * last departure sat 3,000 px down, behind forty stops. "What time is the last
 * one back" is one of the two questions this page exists to answer, and it was
 * the one you had to scroll furthest for.
 */
function summary(line: LineSummary): string {
  const rows = line.directions
    .map((dir) => {
      const towards =
        dir.headsign === null ? `Direzione ${dir.directionId}` : titleCase(dir.headsign);
      const frequency = dir.headwayMinutes === null ? "" : ` · una ogni ${dir.headwayMinutes} min`;
      return `<li class="summary__row">
            <span class="summary__to">Verso ${text(towards)}</span>
            <span class="summary__when">${dir.first} – ${dir.last}${frequency}</span>
          </li>`;
    })
    .join("\n          ");

  return `<ul class="summary">
          ${rows}
        </ul>`;
}

export function renderLinePage(page: LinePage, data: LineData): string {
  const line = page.line;
  const name = titleCase(line.longName ?? line.comune);
  const title = `Linea ${line.shortName} ${line.comune} — percorso e fermate | DoveBus`;
  const towards = line.directions
    .map((dir) => (dir.headsign === null ? null : titleCase(dir.headsign)))
    .filter((value): value is string => value !== null);
  const description =
    `Il percorso della linea ${line.shortName} a ${line.comune}: ` +
    `${line.directions[0]?.stops.length ?? 0} fermate, prima e ultima corsa, frequenza. ` +
    "E dov'è il bus adesso, sulla mappa in tempo reale.";

  const trail = [
    { name: "Linee", path: "/linee/" },
    ...(page.parentPath === null ? [] : [{ name: line.comune, path: page.parentPath }]),
    { name: `Linea ${line.shortName}`, path: page.path },
  ];

  const comuni =
    line.comuni.length > 1
      ? `<p class="page__standfirst">Attraversa ${text(line.comuni.join(", "))}.</p>`
      : "";

  return `<!doctype html>
<html lang="it">
${head({ title, description, path: page.path, markup: breadcrumbMarkup(trail) })}

  <body>
    <a class="skip-link" href="#contenuto">Vai al contenuto</a>

    <!--@partial:header-->

    <main id="contenuto">
      <div class="page shell">
        ${breadcrumbNav(trail)}
        <p class="eyebrow">Linea ${text(line.shortName)} · ${text(line.comune)}</p>
        <h1 class="page__title">${text(name)}</h1>
        <p class="page__standfirst">
          ${line.trips} corse in un giorno feriale${towards.length === 2 ? `, fra ${text(towards[0] as string)} e ${text(towards[1] as string)}` : ""}.
        </p>
        ${comuni}
        ${summary(line)}
        <p class="page__cta">
          <a class="button" href="${attribute(liveHref(line))}">
            Dov'è il ${text(line.shortName)} adesso <span class="button__arrow" aria-hidden="true">→</span>
          </a>
        </p>
      </div>
${line.directions.map((_, index) => direction(line, index)).join("\n")}
${provenance(data, line.lengthKm)}
    </main>

    <!--@partial:footer-->
  </body>
</html>
`;
}

export function renderComunePage(page: ComunePage, data: LineData): string {
  const title = `Autobus a ${page.comune} — linee e mappa in tempo reale | DoveBus`;
  const description =
    `Le linee di autobus che servono ${page.comune}, con il loro percorso e le fermate. ` +
    "E la mappa che mostra dove sono i bus adesso.";

  const rows = page.lines
    .map(
      (line) => `
          <li class="lines__item">
            <a class="lines__link" href="/linea/${attribute(line.slug)}/">
              <span class="lines__code">${text(line.shortName)}</span>
              <span class="lines__name">${text(titleCase(line.longName ?? ""))}</span>
            </a>
            <span class="lines__meta">${line.trips} corse al giorno</span>
          </li>`,
    )
    .join("");

  const trail = [
    { name: "Linee", path: "/linee/" },
    { name: page.comune, path: page.path },
  ];

  return `<!doctype html>
<html lang="it">
${head({ title, description, path: page.path, markup: breadcrumbMarkup(trail) })}

  <body>
    <a class="skip-link" href="#contenuto">Vai al contenuto</a>

    <!--@partial:header-->

    <main id="contenuto">
      <div class="page shell">
        ${breadcrumbNav(trail)}
        <p class="eyebrow">Autobus a ${text(page.comune)}</p>
        <h1 class="page__title">Le linee di ${text(page.comune)}</h1>
        <p class="page__standfirst">
          ${page.lines.length === 1 ? "Una linea con una pagina" : `${page.lines.length} linee con una pagina`}
          su DoveBus, fra quelle che servono ${text(page.comune)}. Ognuna con il suo percorso,
          le fermate e il collegamento alla mappa viva.
        </p>
        <p class="page__cta">
          <a class="button" href="/mappa/">
            Apri la mappa <span class="button__arrow" aria-hidden="true">→</span>
          </a>
        </p>
      </div>

      <section class="section shell" aria-labelledby="linee-titolo">
        <div class="section__head">
          <h2 class="section__title" id="linee-titolo">Linee con una pagina.</h2>
        </div>
        <ul class="lines">${rows}
        </ul>
      </section>
${provenance(data, null)}
    </main>

    <!--@partial:footer-->
  </body>
</html>
`;
}

export function renderIndexPage(page: IndexPage, data: LineData): string {
  const total = page.comuni.reduce((sum, entry) => sum + entry.lines.length, 0);
  const title = "Linee di autobus in Toscana — percorsi e fermate | DoveBus";
  const description =
    `Le ${total} linee di autobus toscane che hanno una pagina su DoveBus, per comune: ` +
    "percorso, fermate, prima e ultima corsa, e la mappa in tempo reale.";

  const groups = page.comuni
    .map((entry) => {
      const heading =
        entry.path === null
          ? text(entry.comune)
          : `<a href="${attribute(entry.path)}">${text(entry.comune)}</a>`;
      const items = entry.lines
        .map(
          (line) =>
            `<li class="lines__item">
              <a class="lines__link" href="/linea/${attribute(line.slug)}/">
                <span class="lines__code">${text(line.shortName)}</span>
                <span class="lines__name">${text(titleCase(line.longName ?? ""))}</span>
              </a>
            </li>`,
        )
        .join("\n            ");
      return `
        <div class="comuni__group">
          <h3 class="comuni__name">${heading}</h3>
          <ul class="lines">
            ${items}
          </ul>
        </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="it">
${head({
  title,
  description,
  path: page.path,
  markup: breadcrumbMarkup([{ name: "Linee", path: page.path }]),
})}

  <body>
    <a class="skip-link" href="#contenuto">Vai al contenuto</a>

    <!--@partial:header-->

    <main id="contenuto">
      <div class="page shell">
        <p class="eyebrow">Linee</p>
        <h1 class="page__title">Le linee, per comune</h1>
        <p class="page__standfirst">
          ${total} linee di autobus toscane hanno una pagina su DoveBus, con il percorso, le
          fermate servite e il collegamento alla mappa in tempo reale. Sono le linee che
          fanno più corse: l'elenco cresce a gruppi.
        </p>
      </div>

      <section class="section shell" aria-labelledby="comuni-titolo">
        <div class="section__head">
          <h2 class="section__title" id="comuni-titolo">Per comune.</h2>
        </div>
        <div class="comuni">${groups}
        </div>
      </section>
${provenance(data, null)}
    </main>

    <!--@partial:footer-->
  </body>
</html>
`;
}

/** Dispatches to the right renderer. */
export function renderPage(page: Page, data: LineData): string {
  if (page.kind === "line") return renderLinePage(page, data);
  if (page.kind === "comune") return renderComunePage(page, data);
  return renderIndexPage(page, data);
}
