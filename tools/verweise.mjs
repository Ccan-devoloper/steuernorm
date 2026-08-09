#!/usr/bin/env node
/**
 * verweise.mjs — baut den Rückverweisindex („Zitiert von").
 *
 * Das Frontend verlinkt Verweise bisher nur in EINE Richtung: Von § 15 EStG
 * kommt man zu § 4 EStG, aber nicht zurück. Wer eine Norm auslegt, will genau
 * das Gegenteil wissen — welche anderen Vorschriften auf sie Bezug nehmen.
 * Diese Rückschau ist der Kern juristischer Portale und ließ sich bisher nur
 * über die Volltextsuche nachbilden.
 *
 * Der Index wird einmal vorberechnet und als `data/verweise.json` abgelegt;
 * zur Laufzeit ist er ein einfacher Nachschlagevorgang.
 *
 *   node tools/verweise.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEN = path.join(WURZEL, "data");

const register = JSON.parse(await readFile(path.join(DATEN, "index.json"), "utf8"));
const kuerzel = register.gesetze.map((g) => g.abk);

/**
 * Verweismuster. Erfasst wird die Paragrafennummer und — falls genannt — das
 * Gesetz. Fehlt es, gilt der Verweis dem eigenen Gesetz; so steht es in den
 * Gesetzestexten („§ 4 Absatz 5" innerhalb des EStG meint das EStG).
 *
 * `§§ 82 bis 84` und `§§ 3, 4` erfassen mehrere Normen auf einmal und werden
 * getrennt aufgelöst, damit auch die Normen dazwischen den Rückverweis erhalten.
 */
const ABK_ALT = kuerzel.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const EINZEL = new RegExp(
  `§§?\\s?(\\d+[a-z]?)((?:\\s?(?:bis|,|und)\\s?\\d+[a-z]?)*)`
  + `(?:[^.;]{0,60}?\\b(${ABK_ALT})\\b)?`,
  "g",
);
const SPANNE = /\s?(bis|,|und)\s?(\d+[a-z]?)/g;

/** Normtext ohne Auszeichnung. */
function volltext(norm) {
  return norm.abs.map((a) => a.html || "").join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&sect;/g, "§").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** Numerischer Teil einer Paragrafenbezeichnung, für „§§ 82 bis 84". */
const zahl = (s) => parseInt(String(s), 10);

const gesetze = new Map();
for (const meta of register.gesetze) {
  gesetze.set(meta.abk, JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8")));
}

/** ziel „estg/15" → Menge von Quellen „ao/3" */
const rueck = new Map();
let gefunden = 0;

for (const [abk, gesetz] of gesetze) {
  const eigenerSlug = abk.toLowerCase();
  for (const norm of gesetz.normen) {
    const text = volltext(norm);
    const quelle = `${eigenerSlug}/${norm.id}`;
    EINZEL.lastIndex = 0;
    let m;
    while ((m = EINZEL.exec(text)) !== null) {
      if (EINZEL.lastIndex <= m.index) EINZEL.lastIndex = m.index + 1;
      const zielAbk = (m[3] || abk).toLowerCase();
      const zielGesetz = gesetze.get(m[3] || abk);
      if (!zielGesetz) continue;

      const nummern = [m[1]];
      if (m[2]) {
        SPANNE.lastIndex = 0;
        let s;
        let vorher = m[1];
        while ((s = SPANNE.exec(m[2])) !== null) {
          if (s[1] === "bis" && zahl(vorher) && zahl(s[2])) {
            // „§§ 82 bis 84" verweist auch auf § 83.
            for (let n = zahl(vorher) + 1; n <= zahl(s[2]); n++) nummern.push(String(n));
          } else {
            nummern.push(s[2]);
          }
          vorher = s[2];
        }
      }

      for (const nr of nummern) {
        const ziel = `${zielAbk}/${nr}`;
        if (ziel === quelle) continue;                       // Selbstverweis
        if (!zielGesetz.normen.some((n) => n.id === nr)) continue;
        if (!rueck.has(ziel)) rueck.set(ziel, new Set());
        rueck.get(ziel).add(quelle);
        gefunden++;
      }
    }
  }
}

/* Ausgabe: kompakt, damit die Datei im Browser schnell geladen ist. */
const raus = {};
for (const [ziel, quellen] of [...rueck].sort()) {
  raus[ziel] = [...quellen].sort((a, b) => {
    const [ga, na] = a.split("/");
    const [gb, nb] = b.split("/");
    return ga === gb ? (zahl(na) || 0) - (zahl(nb) || 0) : ga.localeCompare(gb);
  });
}

const datei = {
  erzeugt: new Date().toISOString(),
  hinweis: "Rückverweise: Schlüssel ist die zitierte Norm, Wert sind die zitierenden Normen. Automatisch aus dem Normtext gewonnen.",
  normen: raus,
};
await writeFile(path.join(DATEN, "verweise.json"), `${JSON.stringify(datei)}\n`);

const spitze = [...rueck].sort((a, b) => b[1].size - a[1].size).slice(0, 8);
console.log(`${Object.keys(raus).length} Normen mit Rückverweisen, ${gefunden} Verweise erfasst.`);
console.log("Am häufigsten zitiert:");
for (const [ziel, q] of spitze) console.log(`  ${ziel.padEnd(14)} ${q.size}×`);
