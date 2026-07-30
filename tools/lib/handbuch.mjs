/**
 * handbuch.mjs — Zugriff auf die Amtlichen Handbücher des BMF.
 *
 * Die Handbücher (AEAO, EStR/EStH, UStAE, KStR/KStH, GewStR, ErbStR, GrStR) sind
 * amtliche Werke und nach § 5 Abs. 1 UrhG gemeinfrei. Sie sind paragrafenweise
 * gegliedert und damit die beste frei verfügbare Auslegungsquelle für das deutsche
 * Steuerrecht.
 *
 * Zwei Schritte:
 *   1. karteBauen()  — einmalig den Verzeichnisbaum ablaufen und § → URL festhalten
 *   2. abschnittLesen() — die Einzelseite holen und den Verwaltungstext herausziehen
 *
 * Abrufhygiene: ein Abruf je Sekunde, sprechender User-Agent, If-Modified-Since.
 */

const KENNUNG = "steuernorm/4 (+https://github.com/Ccan-devoloper/steuernorm)";
const PAUSE_MS = 1_000;
const TIMEOUT_MS = 30_000;

let letzterAbruf = 0;

async function hole(url, etag = null) {
  const wartezeit = PAUSE_MS - (Date.now() - letzterAbruf);
  if (wartezeit > 0) await new Promise((r) => setTimeout(r, wartezeit));
  letzterAbruf = Date.now();

  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
  try {
    const kopf = { "User-Agent": KENNUNG, Accept: "text/html,application/xhtml+xml" };
    if (etag) kopf["If-None-Match"] = etag;
    const antwort = await fetch(url, { headers: kopf, signal: abbruch.signal, redirect: "follow" });
    if (antwort.status === 304) return { unveraendert: true };
    if (!antwort.ok) return { fehler: `HTTP ${antwort.status}` };
    return { html: await antwort.text(), etag: antwort.headers.get("etag"), url: antwort.url || url };
  } catch (fehler) {
    return { fehler: fehler.name === "AbortError" ? "Zeitüberschreitung" : fehler.message };
  } finally {
    clearTimeout(uhr);
  }
}

/* ─────────────────────────── Karte aufbauen ─────────────────────────── */

// BMF-Seiten verwenden je nach Handbuch doppelte, einfache oder unquotierte href-Werte.
const LINK = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

function text(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&sect;|&#167;/gi, "§").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö").replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** „§ 8 Wohnsitz" → „8"; „§ 32a Absatz 5" → „32a"; „AEAO vor §§ 8, 9" → null */
export function paragrafAus(beschriftung) {
  const t = text(beschriftung);
  if (/^AEAO\s+vor/i.test(t) || /^§§/.test(t)) return null;
  const m = /^§\s*(\d{1,4}[a-z]?)\b/.exec(t);
  return m ? m[1] : null;
}

/** „AEAO vor §§ 169 bis 171" → ["169","170","171"]; „vor §§ 8, 9" → ["8","9"] */
export function vorschaltParagrafen(beschriftung) {
  const t = text(beschriftung);
  if (!/vor\s+§§?/i.test(t)) return [];
  const rest = t.split(/vor\s+§§?/i)[1] || "";
  const spanne = /(\d{1,4}[a-z]?)\s*(?:bis|-|–)\s*(\d{1,4}[a-z]?)/.exec(rest);
  if (spanne) {
    const von = Number.parseInt(spanne[1], 10);
    const bis = Number.parseInt(spanne[2], 10);
    if (Number.isFinite(von) && Number.isFinite(bis) && bis >= von && bis - von < 60) {
      return Array.from({ length: bis - von + 1 }, (_, i) => String(von + i));
    }
  }
  return [...rest.matchAll(/(\d{1,4}[a-z]?)/g)].map((m) => m[1]).slice(0, 12);
}

function basisAus(html, seitenUrl) {
  const m = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(html);
  const href = m ? (m[1] || m[2] || m[3]) : null;
  try { return href ? new URL(href.replace(/&amp;/gi, "&"), seitenUrl).toString() : seitenUrl; } catch { return seitenUrl; }
}

function absolut(basis, href) {
  const sauber = String(href || "").replace(/&amp;/gi, "&").trim();
  if (!sauber || sauber.startsWith("#") || /^(?:javascript|mailto|tel):/i.test(sauber)) return null;
  try {
    const basisUrl = new URL(basis);
    if (/^(?:ao|esth|usth|ksth|gewsth|erbsth|grsth)\/(?:\d{4}|\d{4}-\d{4})\//i.test(sauber)) {
      return new URL(`/${sauber}`, basisUrl.origin).toString();
    }
    return new URL(sauber, basisUrl).toString();
  } catch { return null; }
}

function istInterneHtmlSeite(url, prefix) {
  if (!url || !url.startsWith(prefix)) return false;
  const pfad = new URL(url).pathname;
  return /\.html$/i.test(pfad) || /\/inhalt\/?$/i.test(pfad);
}

/**
 * Läuft den Verzeichnisbaum eines Handbuchs ab und liefert die Karte § → URL.
 * Vollständige Meta-Inhaltsverzeichnisse werden bewusst nur einmal gelesen; sie
 * enthalten bereits sämtliche Paragraphseiten und verhindern unnötige Vollcrawls.
 */
export async function karteBauen(handbuch, melde = () => {}) {
  const gesehen = new Set();
  const warteschlange = [handbuch.start];
  const karte = {};
  const vorschalt = {};
  const nurInhaltsverzeichnis = /\/Meta\/Inhalts(?:verzeichnis|uebersicht)\/inhalt\.html$/i.test(handbuch.start);
  let seiten = 0;

  while (warteschlange.length) {
    if (gesehen.size > 5000) throw new Error(`${handbuch.abk}: mehr als 5000 interne Seiten; Prefix prüfen.`);
    const url = warteschlange.shift();
    if (gesehen.has(url)) continue;
    gesehen.add(url);

    const { html, fehler, url: endUrl } = await hole(url);
    if (fehler) { melde(`  ⚠ ${url}: ${fehler}`); continue; }
    seiten++;
    if (seiten % 20 === 0) melde(`  ${seiten} Verzeichnisseiten, ${Object.keys(karte).length} Paragrafen`);

    const linkBasis = basisAus(html, endUrl || url);
    LINK.lastIndex = 0;
    let treffer;
    while ((treffer = LINK.exec(html)) !== null) {
      const href = treffer[1] || treffer[2] || treffer[3];
      const ziel = absolut(linkBasis, href);
      if (!istInterneHtmlSeite(ziel, handbuch.prefix)) continue;
      const sauber = ziel.split(/[?#]/)[0];
      const beschriftung = treffer[4];

      const nr = paragrafAus(beschriftung);
      if (nr) {
        if (!karte[nr]) karte[nr] = { url: sauber, titel: text(beschriftung) };
        continue;
      }
      for (const v of vorschaltParagrafen(beschriftung)) {
        if (!vorschalt[v]) vorschalt[v] = { url: sauber, titel: text(beschriftung) };
      }
      if (!nurInhaltsverzeichnis && !gesehen.has(sauber) && !warteschlange.includes(sauber)) {
        warteschlange.push(sauber);
      }
    }
  }

  return {
    abk: handbuch.abk,
    name: handbuch.name,
    jahrgang: handbuch.jahrgang ?? null,
    start: handbuch.start,
    abgerufen: new Date().toISOString().slice(0, 10),
    seiten,
    paragrafen: karte,
    vorschaltnormen: vorschalt,
  };
}

/* ─────────────────────────── Einzelseite lesen ─────────────────────────── */

const ABSCHNITT_MARKE = /^(AEAO\s+zu\s+§|AEAO\s+vor|R\s?\d|H\s?\d|Abschnitt\s?\d|UStAE\s?\d|A\s?\d+\.\d)/i;

export function abschnitteAus(html) {
  const roh = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "");

  const bloecke = [];
  const teile = roh.split(/<h[2-5][^>]*>/i);
  for (const teil of teile.slice(1)) {
    const ende = teil.search(/<\/h[2-5]>/i);
    if (ende === -1) continue;
    const titel = text(teil.slice(0, ende));
    if (!ABSCHNITT_MARKE.test(titel)) continue;
    const koerper = text(teil.slice(ende));
    if (koerper.length < 40) continue;
    bloecke.push({ titel, text: koerper });
  }
  return bloecke;
}

export async function abschnittLesen({ eintrag, quelle, etag = null, maxZeichen = 2_400 }) {
  if (!eintrag?.url) return null;
  const { html, fehler, unveraendert, etag: neuerEtag } = await hole(eintrag.url, etag);
  if (unveraendert) return { unveraendert: true };
  if (fehler || !html) return null;

  const abschnitte = abschnitteAus(html)
    .map((a) => ({ titel: a.titel, text: kuerzen(a.text, maxZeichen) }))
    .filter((a) => a.text.length > 40)
    .slice(0, 6);

  if (!abschnitte.length) return null;
  return { quelle, url: eintrag.url, titel: eintrag.titel, abschnitte, etag: neuerEtag ?? null };
}

function kuerzen(t, max) {
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max);
  const punkt = Math.max(schnitt.lastIndexOf(". "), schnitt.lastIndexOf("; "));
  return `${(punkt > max * 0.5 ? schnitt.slice(0, punkt + 1) : schnitt).trim()} […]`;
}
