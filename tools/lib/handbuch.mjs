/**
 * Zugriff auf die amtlichen Steuerhandbücher des BMF.
 *
 * Die Extraktion berücksichtigt sowohl direkt beschriftete Verwaltungsüberschriften
 * (AEAO zu § ..., Abschnitt 1.1, R 1, H 1) als auch BMF-Seiten, auf denen der
 * Gliederungsmarker getrennt vor generischen Überschriften wie „Richtlinie“ steht.
 */

const KENNUNG = "steuernorm/4 (+https://github.com/Ccan-devoloper/steuernorm)";
const PAUSE_MS = 1_000;
const TIMEOUT_MS = 60_000;
const MAX_VERSUCHE = 4;
const WIEDERHOLBAR = new Set([408, 425, 429, 500, 502, 503, 504]);

let letzterAbruf = 0;

const warten = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryNachMillis(antwort, versuch) {
  const roh = antwort?.headers?.get?.("retry-after");
  if (roh && /^\d+$/.test(roh)) return Math.min(Number(roh) * 1_000, 60_000);
  if (roh) {
    const zeit = Date.parse(roh) - Date.now();
    if (Number.isFinite(zeit) && zeit > 0) return Math.min(zeit, 60_000);
  }
  return Math.min(2_000 * (2 ** (versuch - 1)), 20_000);
}

async function hole(url, etag = null) {
  let letzterFehler = "unbekannter Abruffehler";

  for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
    const wartezeit = PAUSE_MS - (Date.now() - letzterAbruf);
    if (wartezeit > 0) await warten(wartezeit);
    letzterAbruf = Date.now();

    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
    let wiederholungNach = Math.min(2_000 * (2 ** (versuch - 1)), 20_000);

    try {
      const kopf = { "User-Agent": KENNUNG, Accept: "text/html,application/xhtml+xml" };
      if (etag) kopf["If-None-Match"] = etag;
      const antwort = await fetch(url, { headers: kopf, signal: abbruch.signal, redirect: "follow" });
      if (antwort.status === 304) return { unveraendert: true };
      if (antwort.ok) {
        return { html: await antwort.text(), etag: antwort.headers.get("etag"), url: antwort.url || url };
      }
      letzterFehler = `HTTP ${antwort.status}`;
      if (!WIEDERHOLBAR.has(antwort.status)) return { fehler: letzterFehler };
      wiederholungNach = retryNachMillis(antwort, versuch);
    } catch (fehler) {
      letzterFehler = fehler.name === "AbortError" ? "Zeitüberschreitung" : fehler.message;
    } finally {
      clearTimeout(uhr);
    }

    if (versuch < MAX_VERSUCHE) await warten(wiederholungNach);
  }

  return { fehler: `${letzterFehler} nach ${MAX_VERSUCHE} Versuchen` };
}

const LINK = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

function dekodiere(html) {
  return String(html || "")
    .replace(/&sect;|&#167;/gi, "§")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&auml;/gi, "ä").replace(/&ouml;/gi, "ö").replace(/&uuml;/gi, "ü")
    .replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü")
    .replace(/&#x([0-9a-f]+);/gi, (_, wert) => String.fromCodePoint(Number.parseInt(wert, 16)))
    .replace(/&#(\d+);/g, (_, wert) => String.fromCodePoint(Number(wert)))
    .replace(/\u00ad/g, "");
}

function text(html) {
  return dekodiere(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function zeilenText(html) {
  return dekodiere(
    String(html || "")
      .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|td|th)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .split("\n")
    .map((zeile) => zeile.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function paragrafAus(beschriftung) {
  const t = text(beschriftung);
  if (/^AEAO\s+vor/i.test(t) || /^§§/.test(t)) return null;
  const m = /^§\s*(\d{1,4}[a-z]?)\b/.exec(t);
  return m ? m[1] : null;
}

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

function internePrefixe(handbuch) {
  const prefixe = [handbuch.prefix];
  if (handbuch.prefix.includes("//ao.bundesfinanzministerium.de/")) {
    prefixe.push(handbuch.prefix.replace("//ao.bundesfinanzministerium.de/", "//amtliche-handbuecher.bundesfinanzministerium.de/"));
  }
  return [...new Set(prefixe)];
}

function startpunkte(handbuch) {
  const kandidaten = [];
  for (const prefix of internePrefixe(handbuch)) {
    kandidaten.push(`${prefix}Meta/Inhaltsverzeichnis/inhalt.html`);
    kandidaten.push(`${prefix}Meta/Inhaltsuebersicht/inhalt.html`);
  }
  kandidaten.push(handbuch.start);
  return [...new Set(kandidaten)];
}

function istInterneHtmlSeite(url, prefixe) {
  if (!url || !prefixe.some((prefix) => url.startsWith(prefix))) return false;
  const pfad = new URL(url).pathname;
  return /\.html$/i.test(pfad) || /\/inhalt\/?$/i.test(pfad);
}

function istInhaltsverzeichnis(url) {
  return /\/Meta\/Inhalts(?:verzeichnis|uebersicht)\/inhalt\.html$/i.test(url || "");
}

export async function karteBauen(handbuch, melde = () => {}) {
  const gesehen = new Set();
  const warteschlange = startpunkte(handbuch);
  const erlaubtePrefixe = internePrefixe(handbuch);
  const karte = {};
  const vorschalt = {};
  let seiten = 0;
  let verwendeterStart = handbuch.start;

  while (warteschlange.length) {
    if (gesehen.size > 5000) throw new Error(`${handbuch.abk}: mehr als 5000 interne Seiten; Prefix prüfen.`);
    const url = warteschlange.shift();
    if (gesehen.has(url)) continue;
    gesehen.add(url);

    const { html, fehler, url: endUrl } = await hole(url);
    if (fehler) { melde(`  ⚠ ${url}: ${fehler}`); continue; }
    const aktuelleUrl = endUrl || url;
    verwendeterStart = aktuelleUrl;
    seiten++;
    if (seiten % 20 === 0) melde(`  ${seiten} Verzeichnisseiten, ${Object.keys(karte).length} Paragrafen`);

    const metaSeite = istInhaltsverzeichnis(aktuelleUrl) || istInhaltsverzeichnis(url);
    const linkBasis = basisAus(html, aktuelleUrl);
    LINK.lastIndex = 0;
    let treffer;
    while ((treffer = LINK.exec(html)) !== null) {
      const href = treffer[1] || treffer[2] || treffer[3];
      const ziel = absolut(linkBasis, href);
      if (!istInterneHtmlSeite(ziel, erlaubtePrefixe)) continue;
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
      if (!metaSeite && !gesehen.has(sauber) && !warteschlange.includes(sauber)) warteschlange.push(sauber);
    }
    if (metaSeite && Object.keys(karte).length >= 5) warteschlange.length = 0;
  }

  return {
    abk: handbuch.abk,
    name: handbuch.name,
    jahrgang: handbuch.jahrgang ?? null,
    start: verwendeterStart,
    abgerufen: new Date().toISOString().slice(0, 10),
    seiten,
    paragrafen: karte,
    vorschaltnormen: vorschalt,
  };
}

const ABSCHNITT_MARKE = /^(?:AEAO\s+(?:zu\s+§|vor\b)|R(?:\s+[A-Z])?\s*\d|H(?:\s+[A-Z])?\s*\d|Abschnitt\s*\d|UStAE\s*\d|A(?:\s+[A-Z])?\s*\d+\.\d|\d+\.\d+\.)/i;
const MARKER_ZEILE = /^(AEAO\s+(?:zu\s+§|vor\b).{0,120}|R(?:\s+[A-Z])?\s*\d+(?:[a-z]|\.\d+)*\.?|H(?:\s+[A-Z])?\s*\d+(?:[a-z]|\.\d+)*\.?|Abschnitt\s+\d+(?:\.\d+)*\.?|UStAE\s+\d+(?:\.\d+)*\.?|A(?:\s+[A-Z])?\s*\d+(?:\.\d+)+\.?)(?:\s*[-–—:]?\s*(Richtlinie|Hinweise?|Anwendungserlass|Anwendungshinweise?))?$/i;
const GENERISCHE_UEBERSCHRIFT = /^(?:Richtlinie|Hinweise?|Anwendungserlass|Anwendungshinweise?|Verwaltungsanweisung)$/i;
const HEADING = /<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

function direktBeschrifteteBloecke(roh) {
  const ueberschriften = [];
  HEADING.lastIndex = 0;
  let treffer;
  while ((treffer = HEADING.exec(roh)) !== null) {
    ueberschriften.push({ start: treffer.index, ende: HEADING.lastIndex, titel: text(treffer[2]) });
  }

  const marken = ueberschriften.filter((eintrag) => ABSCHNITT_MARKE.test(eintrag.titel));
  return marken.flatMap((marke, index) => {
    const ende = marken[index + 1]?.start ?? roh.length;
    const koerper = text(roh.slice(marke.ende, ende));
    return koerper.length >= 40 ? [{ titel: marke.titel, text: koerper }] : [];
  });
}

function getrenntBeschrifteteBloecke(roh) {
  const zeilen = zeilenText(roh).split("\n").filter(Boolean);
  const marken = [];
  for (const [index, zeile] of zeilen.entries()) {
    const treffer = MARKER_ZEILE.exec(zeile);
    if (treffer) marken.push({ index, titel: treffer[1], zusatz: treffer[2] || null });
  }

  const bloecke = [];
  for (const [position, marke] of marken.entries()) {
    const ende = marken[position + 1]?.index ?? zeilen.length;
    const inhalt = zeilen.slice(marke.index + 1, ende);
    const ueberschriften = [];
    if (marke.zusatz) ueberschriften.push(marke.zusatz);
    while (inhalt.length && GENERISCHE_UEBERSCHRIFT.test(inhalt[0])) ueberschriften.push(inhalt.shift());
    if (inhalt.length && inhalt[0].length <= 140 && !/[.!?]$/.test(inhalt[0])) ueberschriften.push(inhalt.shift());
    const koerper = inhalt.join(" ").trim();
    if (koerper.length < 40) continue;
    bloecke.push({ titel: [marke.titel, ...ueberschriften.slice(0, 2)].join(" — "), text: koerper });
  }
  return bloecke;
}

export function abschnitteAus(html) {
  const roh = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "");

  const eindeutig = new Map();
  for (const block of [...direktBeschrifteteBloecke(roh), ...getrenntBeschrifteteBloecke(roh)]) {
    const schluessel = block.titel.toLowerCase().replace(/\s+/g, " ").trim();
    const vorhanden = eindeutig.get(schluessel);
    if (!vorhanden || block.text.length > vorhanden.text.length) eindeutig.set(schluessel, block);
  }
  return [...eindeutig.values()];
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
