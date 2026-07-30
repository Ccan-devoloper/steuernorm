/**
 * rechtsprechung.mjs — Entscheidungen, die eine Norm anwenden.
 *
 * Vorrangig über das Rechtsinformationsportal des Bundes (NeuRIS). Der Dienst ist in
 * der Testphase und der Datenbestand unvollständig; deshalb fällt das Modul bei
 * Fehlschlag still auf „keine Treffer" zurück, statt den Lauf abzubrechen.
 *
 * Gerichtsentscheidungen sind nach § 5 Abs. 1 UrhG gemeinfrei. Übernommen werden nur
 * amtliche Angaben (Gericht, Datum, Aktenzeichen, ECLI) und der amtliche Leitsatz —
 * keine redaktionellen Zusätze kommerzieller Anbieter.
 */

const PORTALE = (process.env.RECHTSPRECHUNG_API || "https://testphase.rechtsinformationen.bund.de/api/v1").split(",").map((s) => s.trim()).filter(Boolean);
const KENNUNG = "steuernorm/3 (+https://github.com/Ccan-devoloper/steuernorm)";
const PAUSE_MS = 700;
const TIMEOUT_MS = 20_000;

let letzterAbruf = 0;
let portalAus = false;   // nach wiederholtem Fehlschlag nicht weiter belästigen
let fehlversuche = 0;

async function hole(url) {
  const wartezeit = PAUSE_MS - (Date.now() - letzterAbruf);
  if (wartezeit > 0) await new Promise((r) => setTimeout(r, wartezeit));
  letzterAbruf = Date.now();

  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
  try {
    const antwort = await fetch(url, {
      headers: { "User-Agent": KENNUNG, Accept: "application/json" },
      signal: abbruch.signal,
    });
    if (!antwort.ok) return null;
    return await antwort.json();
  } catch {
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * @returns {Promise<Array<{gericht,datum,az,ecli,leitsatz,url,quelle}>>}
 */
export async function entscheidungenZu({ gesetz, paragraf, grenze = 5 }) {
  if (portalAus) return [];

  const suche = `"§ ${paragraf} ${gesetz}"`;
  let antwort = null;
  for (const portal of PORTALE) {
    const url = `${portal.replace(/\/$/, "")}/case-law?searchTerm=${encodeURIComponent(suche)}&size=${grenze}`;
    antwort = await hole(url);
    if (antwort) break;
  }

  if (!antwort) {
    if (++fehlversuche >= 5) portalAus = true;
    return [];
  }
  fehlversuche = 0;

  const posten = antwort.member ?? antwort.items ?? antwort.content ?? [];
  if (!Array.isArray(posten)) return [];

  return posten.slice(0, grenze).map(normiere).filter(Boolean);
}

function normiere(roh) {
  const item = roh?.item ?? roh;
  if (!item) return null;

  const gericht = item.courtName ?? item.court?.name ?? item.gericht ?? null;
  const az = item.fileNumbers?.[0] ?? item.fileNumber ?? item.aktenzeichen ?? null;
  const datum = (item.decisionDate ?? item.date ?? "").slice(0, 10) || null;
  if (!gericht && !az) return null;

  const leitsatz = saeubere(item.headline ?? item.guidingPrinciple ?? item.leitsatz ?? "");

  return {
    quelle: "Rechtsinformationen des Bundes",
    gericht,
    datum,
    az,
    ecli: item.ecli ?? null,
    leitsatz: leitsatz ? kuerzen(leitsatz, 600) : null,
    url: item.documentUrl ?? item.url ?? (item.documentNumber
      ? `https://www.rechtsinformationen.bund.de/case-law/${item.documentNumber}`
      : null),
  };
}

function saeubere(t) {
  return String(t || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function kuerzen(t, max) {
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max);
  const punkt = schnitt.lastIndexOf(". ");
  return `${(punkt > max * 0.5 ? schnitt.slice(0, punkt + 1) : schnitt).trim()} […]`;
}
