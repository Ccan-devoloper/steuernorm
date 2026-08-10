#!/usr/bin/env node
/**
 * fassungen.mjs — erzeugt `fassungen/<gesetz>.json` für den Fassungsvergleich.
 *
 * WOHER DIE FASSUNGEN KOMMEN. Nicht aus einer Quelle für historische
 * Gesetzestexte — eine solche hat das Repository nicht. gesetze-im-internet.de
 * liefert ausschließlich den geltenden Wortlaut; wer eine frühere Fassung
 * zeigen will, muss sie sich beschaffen. Erfunden wird hier nichts.
 *
 * Beschafft ist sie längst: Der Git-Verlauf von `data/<gesetz>.json` hält jeden
 * Stand fest, mit dem das Repository je gearbeitet hat. Jeder Abruf ist ein
 * datierter Zeitschnitt. Ändert sich der Wortlaut einer Norm zwischen zwei
 * Abrufen, sind das zwei Fassungen — beide echt, beide datiert, beide im
 * Repository nachweisbar.
 *
 * WAS DAS DATUM BEDEUTET. `abgerufen` ist der Tag, an dem der Text ins
 * Repository kam, NICHT der Tag des Inkrafttretens. Wer zwischen zwei Abrufen
 * ändert, dessen Änderung erscheint hier am Tag des nächsten Abrufs. Die
 * amtliche Angabe steht daneben in `stand` — sie, nicht das Datum, sagt,
 * welche Fassung das ist. Die Oberfläche muss beides zeigen.
 *
 * FORM DER DATEI
 *
 *   { abk, erzeugt, quelle, hinweis,
 *     normen: { <normId>: { fassungen: [ { id, abgerufen, stand,
 *                                          aktuell?, enbez?, titel?,
 *                                          abs?, fussnote? } ] } } }
 *
 * Jüngste zuerst. Die jüngste trägt `aktuell: true` und KEINEN Wortlaut — der
 * steht in `data/` und würde hier nur verdoppelt. Ältere tragen ihn vollständig.
 *
 * Aufgenommen werden nur Normen mit mehr als einer Fassung. Alles andere wäre
 * eine Kopie von `data/` unter anderem Namen; die Datei bliebe groß und sagte
 * nichts. Wo eine Norm fehlt, bleibt der Knopf „Vergleichen" gesperrt.
 *
 *   node tools/fassungen.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ZIEL = path.join(WURZEL, "fassungen");
const NICHT_GESETZ = new Set(["index.json", "verweise.json"]);

const git = (...args) =>
  execFileSync("git", args, { cwd: WURZEL, maxBuffer: 1 << 30, encoding: "utf8" });

/** Der Inhalt einer Norm, auf den es ankommt — ohne flüchtige Felder. */
const inhalt = (n) => JSON.stringify({
  enbez: n.enbez, titel: n.titel, gliederung: n.gliederung,
  abs: n.abs, fussnote: n.fussnote ?? null,
});

const standAus = (gesetz) =>
  (Array.isArray(gesetz.stand) ? gesetz.stand : [])
    .find((s) => s.typ === "Stand")?.text || null;

const dateien = (await readdir(path.join(WURZEL, "data")))
  .filter((d) => d.endsWith(".json") && !NICHT_GESETZ.has(d))
  .sort();

await mkdir(ZIEL, { recursive: true });

let gesamtNormen = 0;
let gesamtFassungen = 0;
const zeilen = [];

for (const datei of dateien) {
  const pfad = "data/" + datei;
  /* Ältester Stand zuerst: Die Reihenfolge der Fassungen entsteht hier. */
  const verlauf = git("log", "--format=%H %ad", "--date=short", "--", pfad)
    .trim().split("\n").filter(Boolean).reverse()
    .map((zeile) => {
      const [hash, datum] = zeile.split(" ");
      return { hash, datum };
    });

  /* normId → Liste der Fassungen, älteste zuerst. */
  const je = new Map();
  let vorige = new Map();          // normId → inhalt() des letzten Abrufs
  let abk = null;

  for (const { hash, datum } of verlauf) {
    let gesetz;
    try { gesetz = JSON.parse(git("show", hash + ":" + pfad)); }
    catch (e) { continue; }        // Datei damals nicht vorhanden oder kaputt
    abk = gesetz.abk || abk;
    const stand = standAus(gesetz);
    const jetzt = new Map();

    for (const norm of gesetz.normen || []) {
      const schluessel = inhalt(norm);
      jetzt.set(norm.id, schluessel);
      if (vorige.get(norm.id) === schluessel) continue;   // unverändert

      if (!je.has(norm.id)) je.set(norm.id, []);
      je.get(norm.id).push({
        id: datum,
        abgerufen: datum,
        stand,
        enbez: norm.enbez,
        titel: norm.titel,
        abs: norm.abs,
        fussnote: norm.fussnote ?? null,
      });
    }
    vorige = jetzt;
  }

  const normen = {};
  for (const [normId, liste] of je) {
    if (liste.length < 2) continue;
    /* Jüngste zuerst. Die jüngste verweist auf `data/`, statt den Wortlaut
       ein zweites Mal zu führen. */
    const umgekehrt = liste.slice().reverse();
    normen[normId] = {
      fassungen: umgekehrt.map((f, i) => (i === 0
        ? { id: f.id, abgerufen: f.abgerufen, stand: f.stand, aktuell: true }
        : f)),
    };
    gesamtNormen++;
    gesamtFassungen += umgekehrt.length;
  }

  const inhaltDatei = {
    abk: abk || datei.replace(/\.json$/, "").toUpperCase(),
    erzeugt: new Date().toISOString().slice(0, 10),
    quelle: "Git-Verlauf von " + pfad,
    hinweis: "Die Fassungen stammen aus dem Verlauf dieses Repositoriums, nicht "
      + "aus einer amtlichen Sammlung historischer Gesetzestexte. „abgerufen“ ist "
      + "der Tag, an dem der Wortlaut hier eintraf, nicht der Tag des "
      + "Inkrafttretens; maßgeblich ist die Standangabe. Frühere Änderungen als "
      + "der erste Abruf sind nicht erfasst.",
    normen,
  };

  const ziel = path.join(ZIEL, datei);
  await writeFile(ziel, JSON.stringify(inhaltDatei) + "\n");
  const zahl = Object.keys(normen).length;
  zeilen.push(`  ${(abk || datei).padEnd(9)} ${verlauf.length} Abrufe, `
    + `${zahl} ${zahl === 1 ? "Norm" : "Normen"} mit mehr als einer Fassung`);
}

console.log(zeilen.join("\n"));
console.log(`\n${gesamtNormen} Normen, ${gesamtFassungen} Fassungen nach fassungen/ geschrieben.`);
if (!gesamtNormen) {
  console.log("\nKeine einzige Norm hat im Verlauf ihren Wortlaut geändert —");
  console.log("der Knopf „Vergleichen“ bleibt damit überall gesperrt. Das ist");
  console.log("kein Fehler, sondern der Bestand.");
}
