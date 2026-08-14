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
 * eine zweite Quelle.
 *
 * Amtlich und maschinenlesbar ist dafür das Rechtsinformationsportal des
 * Bundes. Wie seine Antwort aussieht, weiß dieses Werkzeug NICHT — deshalb
 * rät es auch nicht.
 *
 *   node tools/aenderungen.mjs --sondieren     fragen und berichten
 *   node tools/aenderungen.mjs --sondieren --roh   Antwort ungekürzt ausgeben
 *
 * Die Sondierung schreibt nichts nach `aenderungen/`. Sie fragt die
 * konfigurierten Adressen ab, meldet Status und Gestalt der Antwort und legt
 * sie unter `reports/aenderungen-sondierung.json` ab. Aus DIESEM Befund wird
 * der Auswerter geschrieben — nicht aus einer Vermutung darüber, was das
 * Portal wohl liefern wird. Ein Auswerter gegen eine ungesehene Schnittstelle
 * ist genau die Sorte Code, die beim ersten echten Lauf umfällt.
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

/* Abgefragt wird an EINEM Gesetz — dem kleinsten des Bestands. Eine Sondierung
   soll die Gestalt der Antwort zeigen, nicht den Bestand herunterladen. */
const PROBEN = [
  { zweck: "Wurzel", url: `${BASIS}/` },
  { zweck: "Suche nach dem Solidaritätszuschlaggesetz", url: `${BASIS}/v1/legislation?searchTerm=Solidarit%C3%A4tszuschlaggesetz` },
  { zweck: "Suche allgemein", url: `${BASIS}/v1/legislation?searchTerm=Umsatzsteuergesetz` },
  { zweck: "Dokumentation", url: `${BASIS}/api-docs` },
];

/** Die Gestalt einer Antwort, ohne sie zu deuten. */
function gestalt(wert, tiefe = 0) {
  if (wert === null) return "null";
  if (Array.isArray(wert)) {
    return tiefe > 2 ? `Array(${wert.length})`
      : `Array(${wert.length})` + (wert.length ? ` von ${gestalt(wert[0], tiefe + 1)}` : "");
  }
  if (typeof wert === "object") {
    const schluessel = Object.keys(wert);
    if (tiefe > 2) return `{ ${schluessel.slice(0, 12).join(", ")} }`;
    return "{ " + schluessel.slice(0, 12)
      .map((k) => `${k}: ${gestalt(wert[k], tiefe + 1)}`).join(", ")
      + (schluessel.length > 12 ? ", …" : "") + " }";
  }
  return typeof wert;
}

const bericht = { erzeugt: new Date().toISOString(), basis: BASIS, proben: [] };

for (const probe of PROBEN) {
  const eintrag = { ...probe };
  try {
    const antwort = await fetch(probe.url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    eintrag.status = antwort.status;
    eintrag.typ = antwort.headers.get("content-type") || "";
    const text = await antwort.text();
    eintrag.laenge = text.length;
    if (/json/i.test(eintrag.typ)) {
      try {
        const daten = JSON.parse(text);
        eintrag.gestalt = gestalt(daten);
        eintrag.anfang = hat("--roh") ? daten : JSON.parse(JSON.stringify(daten)).slice?.(0, 2) ?? undefined;
      } catch (fehler) {
        eintrag.gestalt = "kein gültiges JSON: " + fehler.message;
      }
    } else {
      eintrag.gestalt = "kein JSON";
      eintrag.anfang = text.slice(0, 400);
    }
  } catch (fehler) {
    eintrag.status = 0;
    eintrag.fehler = fehler.message;
  }
  bericht.proben.push(eintrag);
  console.log(`  ${String(eintrag.status).padStart(3)}  ${probe.zweck}`);
  console.log(`       ${probe.url}`);
  if (eintrag.gestalt) console.log(`       ${String(eintrag.gestalt).slice(0, 300)}`);
  if (eintrag.fehler) console.log(`       ${eintrag.fehler}`);
  console.log("");
}

await mkdir(BERICHTE, { recursive: true });
await writeFile(path.join(BERICHTE, "aenderungen-sondierung.json"),
  JSON.stringify(bericht, null, 1) + "\n");

const erreichbar = bericht.proben.filter((p) => p.status >= 200 && p.status < 400).length;
console.log(`${erreichbar} von ${bericht.proben.length} Adressen haben geantwortet.`);
console.log("Befund in reports/aenderungen-sondierung.json.");
if (!erreichbar) {
  console.log("");
  console.log("Keine Antwort. Das heißt nicht, dass es die Quelle nicht gibt —");
  console.log("es heißt, dass sie von hier aus nicht erreichbar ist.");
}
