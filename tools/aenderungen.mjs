#!/usr/bin/env node
/**
 * aenderungen.mjs — Änderungsübersicht je Norm.
 *
 * WAS HIER FEHLT UND WARUM ES FEHLT. „Gesetze im Internet" (BMJ/BfJ), die
 * Quelle des Normtextes, veröffentlicht den GELTENDEN Wortlaut: eine
 * Standangabe für das ganze Gesetz, Anwendungsfußnoten für einzelne Normen —
 * und keine Änderungshistorie. Die Tabelle, die dejure und buzer je Norm
 * führen (Inkrafttreten · Änderungsgesetz · Ausfertigung · Fundstelle), wird
 * aus den Änderungsgesetzen im Bundesgesetzblatt gebildet. Dafür braucht es
 * eine zweite Quelle: das Rechtsinformationsportal des Bundes.
 *
 * DIE ERSTE SONDIERUNG hat gezeigt, dass es antwortet und wie:
 *
 *   GET /v1/legislation?searchTerm=…  →  JSON-LD nach schema.org
 *   { totalItems, member: [ { item: { @id, name, legislationIdentifier,
 *       exampleOfWork, temporalCoverage, abbreviation, encoding } } ] }
 *
 * `temporalCoverage` ist der Geltungszeitraum EINER Fassung, `exampleOfWork`
 * verweist auf das Werk, zu dem sie gehört. Damit liegt die Zeitschiene vor,
 * die dejures erste Spalte füllt.
 *
 * Was noch fehlt, ist die Ebene darunter: Welche NORM in welcher Fassung, und
 * durch welches Änderungsgesetz. Deshalb sondiert dieses Werkzeug weiter —
 * aber es rät keine Adressen, sondern FOLGT den Verweisen der Antwort. JSON-LD
 * trägt seine Wege selbst; wer sie sich ausdenkt, baut gegen eine Vermutung.
 *
 *   node tools/aenderungen.mjs --sondieren
 *   node tools/aenderungen.mjs --sondieren --gesetz Umsatzsteuergesetz
 *
 * Geschrieben wird nach `aenderungen/` weiterhin nichts. Der Befund landet in
 * `reports/aenderungen-sondierung.json`; aus ihm entsteht der Auswerter.
 *
 * Umgebung:
 *   RIP_BASIS   Grundadresse des Portals, überschreibt die Voreinstellung.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const BERICHTE = path.join(WURZEL, "reports");

const args = process.argv.slice(2);
const hat = (f) => args.includes(f);
const wert = (f, v) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? v) : v; };

if (!hat("--sondieren")) {
  console.error("Dieses Werkzeug kann bisher nur sondieren:");
  console.error("  node tools/aenderungen.mjs --sondieren");
  console.error("");
  console.error("Solange kein Auswerter steht, wird nichts nach aenderungen/");
  console.error("geschrieben — lieber keine Übersicht als eine erfundene.");
  process.exit(2);
}

const BASIS = (process.env.RIP_BASIS || "https://testphase.rechtsinformationen.bund.de")
  .replace(/\/+$/, "");
/* Das kleinste Gesetz des Bestands: sechs Normen. Eine Sondierung soll die
   Gestalt zeigen, nicht den Bestand herunterladen. */
const GESETZ = wert("--gesetz", "Solidaritätszuschlaggesetz");
const HOECHSTENS = 14;                    // Abrufe insgesamt

/** Die Gestalt eines Werts, ohne ihn zu deuten. */
function gestalt(w, tiefe = 0) {
  if (w === null) return "null";
  if (Array.isArray(w)) {
    if (tiefe > 2) return `Array(${w.length})`;
    return `Array(${w.length})` + (w.length ? ` von ${gestalt(w[0], tiefe + 1)}` : "");
  }
  if (typeof w === "object") {
    const k = Object.keys(w);
    if (tiefe > 2) return `{ ${k.slice(0, 14).join(", ")} }`;
    return "{ " + k.slice(0, 14).map((n) => `${n}: ${gestalt(w[n], tiefe + 1)}`).join(", ")
      + (k.length > 14 ? ", …" : "") + " }";
  }
  return typeof w === "string" && w.length > 60 ? "string" : JSON.stringify(w);
}

/** Alle Zeichenketten, die wie eine Adresse dieses Portals aussehen. */
function verweise(w, gefunden = new Set()) {
  if (typeof w === "string") {
    if (/^https?:\/\//.test(w) && w.startsWith(BASIS)) gefunden.add(w);
    return gefunden;
  }
  if (Array.isArray(w)) { for (const x of w) verweise(x, gefunden); return gefunden; }
  if (w && typeof w === "object") { for (const x of Object.values(w)) verweise(x, gefunden); }
  return gefunden;
}

let abrufe = 0;
const bericht = { erzeugt: new Date().toISOString(), basis: BASIS, gesetz: GESETZ, proben: [] };

async function frage(zweck, url) {
  if (abrufe >= HOECHSTENS) return null;
  abrufe++;
  const eintrag = { zweck, url };
  try {
    const antwort = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    eintrag.status = antwort.status;
    eintrag.typ = antwort.headers.get("content-type") || "";
    const text = await antwort.text();
    eintrag.laenge = text.length;
    if (/json/i.test(eintrag.typ)) {
      try {
        eintrag.daten = JSON.parse(text);
        eintrag.gestalt = gestalt(eintrag.daten);
      } catch (fehler) { eintrag.gestalt = "kein gültiges JSON: " + fehler.message; }
    } else {
      eintrag.gestalt = "kein JSON (" + eintrag.typ.split(";")[0] + ")";
    }
  } catch (fehler) {
    eintrag.status = 0;
    eintrag.fehler = fehler.message;
  }
  bericht.proben.push(eintrag);
  console.log(`  ${String(eintrag.status).padStart(3)}  ${zweck}`);
  console.log(`       ${url}`);
  if (eintrag.gestalt) console.log(`       ${String(eintrag.gestalt).slice(0, 400)}`);
  if (eintrag.fehler) console.log(`       ${eintrag.fehler}`);
  console.log("");
  return eintrag.daten || null;
}

/* ── 1. Suchen ── */
const suche = await frage("Suche: " + GESETZ,
  `${BASIS}/v1/legislation?searchTerm=${encodeURIComponent(GESETZ)}`);

/* ── 2. Den ersten Treffer VOLLSTÄNDIG zeigen ──
   Die Gestalt sagt, welche Felder es gibt; erst der ganze Eintrag sagt, was
   darin steht. Genau daran entscheidet sich, ob die Zeitschiene taugt. */
const ersterTreffer = suche && Array.isArray(suche.member) ? suche.member[0] : null;
if (ersterTreffer) {
  bericht.ersterTreffer = ersterTreffer;
  console.log("  Erster Treffer, ungekürzt:");
  console.log("  " + JSON.stringify(ersterTreffer, null, 1).split("\n").join("\n  ").slice(0, 2200));
  console.log("");
}

/* ── 3. Den Verweisen folgen ──
   JSON-LD trägt seine Wege selbst. Gefolgt wird jedem Verweis EINE Ebene tief
   — das zeigt, ob es unter dem Gesetz eine Normebene gibt und wo die
   Änderungsgesetze stehen. */
const ziele = [...verweise(ersterTreffer || suche)].filter((u) => u !== `${BASIS}/`);
console.log(`  ${ziele.length} Verweise in der Antwort, davon werden ${Math.min(ziele.length, HOECHSTENS - abrufe)} verfolgt:\n`);
const zweiteEbene = [];
for (const url of ziele) {
  const daten = await frage("Verweis aus dem Treffer", url);
  if (daten) zweiteEbene.push(...verweise(daten));
}

/* ── 4. Eine Ebene tiefer, wenn noch Abrufe übrig sind ── */
const tiefer = [...new Set(zweiteEbene)].filter((u) => !ziele.includes(u));
for (const url of tiefer.slice(0, Math.max(0, HOECHSTENS - abrufe))) {
  await frage("Verweis der zweiten Ebene", url);
}

await mkdir(BERICHTE, { recursive: true });
await writeFile(path.join(BERICHTE, "aenderungen-sondierung.json"),
  JSON.stringify(bericht, null, 1) + "\n");

const erreichbar = bericht.proben.filter((p) => p.status >= 200 && p.status < 400).length;
console.log(`${erreichbar} von ${bericht.proben.length} Abrufen haben geantwortet.`);
console.log("Befund vollständig in reports/aenderungen-sondierung.json.");
