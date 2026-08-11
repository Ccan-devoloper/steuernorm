#!/usr/bin/env node
/**
 * gold-pruefen.mjs — prüft den Goldstandard gegen den Normtext.
 *
 * WOZU. `eval.mjs` vergleicht über Wortüberdeckung. Eine von Hand eingetragene
 * Sollspanne, die ein Wort anders schreibt als das Gesetz, zählt dort als
 * Auslassung — und die Bilanz misst dann den Abschreibfehler statt der
 * Erkennung. Ein Goldstandard, der selbst ungeprüft ist, taugt als Maßstab
 * nichts.
 *
 * Geprüft wird dreierlei:
 *   1. Jede Spanne steht WÖRTLICH im Rechtssatz, dem sie zugeordnet ist.
 *   2. Jeder genannte Pfad gibt es in der Gliederung.
 *   3. Jeder Rechtssatz der Norm ist erfasst — auch mit leerer Liste. Fehlt
 *      einer, zählt alles, was die Erkennung dort findet, als Fehltreffer,
 *      und die Präzision fällt aus einem Grund, der nicht in den Daten liegt.
 *
 *   node tools/gold-pruefen.mjs [gesetz]
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { einheiten as zerlegeNorm } from "./lib/gliederung.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const GOLD = path.join(WURZEL, "eval", "gold");
const DATEN = path.join(WURZEL, "data");
const nur = process.argv[2] ? process.argv[2].toLowerCase() : null;

const register = JSON.parse(await readFile(path.join(DATEN, "index.json"), "utf8"));
let dateien;
try { dateien = (await readdir(GOLD)).filter((d) => d.endsWith(".json")); }
catch (e) { console.error("Kein eval/gold/ vorhanden."); process.exit(2); }
if (nur) dateien = dateien.filter((d) => d.replace(/\.json$/, "") === nur);

let fehler = 0, spannen = 0, normen = 0, luecken = 0;

for (const datei of dateien) {
  const gold = JSON.parse(await readFile(path.join(GOLD, datei), "utf8"));
  const meta = register.gesetze.find((g) => g.datei === datei);
  if (!meta) { console.log(`✗ ${datei}: kein Gesetz mit diesem Dateinamen`); fehler++; continue; }
  const gesetz = JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8"));

  for (const [id, gnorm] of Object.entries(gold.normen || {})) {
    normen++;
    const norm = gesetz.normen.find((n) => n.id === id);
    if (!norm) { console.log(`✗ ${gold.abk} § ${id}: Norm gibt es nicht`); fehler++; continue; }

    const einheiten = zerlegeNorm(norm);
    const nachPfad = new Map(einheiten.map((e) => [e.pfad, e.text]));
    const erfasst = new Set((gnorm.saetze || []).map((s) => s.pfad));

    for (const satz of gnorm.saetze || []) {
      const text = nachPfad.get(satz.pfad);
      if (text === undefined) {
        console.log(`✗ ${gold.abk} § ${id}: Pfad „${satz.pfad}" gibt es in der Gliederung nicht`);
        fehler++;
        continue;
      }
      /* Der Normtext wird in der Vorlage mitgeführt; weicht er ab, ist der
         Goldstandard gegen einen älteren Gesetzesstand geschrieben. */
      if (satz.text !== undefined && satz.text !== text) {
        console.log(`✗ ${gold.abk} § ${id} [${satz.pfad}]: mitgeführter Wortlaut weicht vom Gesetz ab`);
        fehler++;
      }
      for (const el of satz.elemente || []) {
        spannen++;
        if (!text.includes(el.text)) {
          console.log(`✗ ${gold.abk} § ${id} [${satz.pfad}] ${el.art}: steht nicht wörtlich im Rechtssatz`);
          console.log(`    Soll: ${el.text.slice(0, 90)}`);
          fehler++;
        }
      }
    }

    const fehlend = einheiten.filter((e) => !erfasst.has(e.pfad));
    if (fehlend.length) {
      luecken += fehlend.length;
      console.log(`⚠ ${gold.abk} § ${id}: ${fehlend.length} Rechtssatz/-sätze nicht erfasst`
        + ` — ${fehlend.slice(0, 4).map((e) => e.pfad).join(", ")}${fehlend.length > 4 ? " …" : ""}`);
    }
  }
}

console.log("");
console.log(`${normen} Normen · ${spannen} Sollspannen · ${fehler} Fehler · ${luecken} nicht erfasste Rechtssätze`);
if (luecken) {
  console.log("");
  console.log("Nicht erfasste Rechtssätze verfälschen die Präzision nach unten:");
  console.log("Was die Erkennung dort findet, hat im Soll keine Entsprechung.");
}
process.exit(fehler ? 1 : 0);
