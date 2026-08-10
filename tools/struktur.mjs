#!/usr/bin/env node
/**
 * struktur.mjs — erzeugt `struktur/<gesetz>.json` aus `annotations/`.
 *
 * Die Oberfläche färbt Tatbestand, Rechtsfolge und Ausnahme im Normtext ein.
 * Dafür braucht sie Zeichenbereiche, sonst nichts. Die Annotationen enthalten
 * diese Bereiche längst, aber eingebettet in alles Übrige: Begründungen,
 * Konfidenzen, Prüfungsschema, Belege. Für das Frontend sind das je Gesetz
 * mehrere Megabyte, von denen es drei Felder braucht.
 *
 * Dieses Werkzeug schneidet die Segmentierung heraus:
 *
 *   { normId: { segmente: [ { typ, von, bis, pfad, konfidenz } ] } }
 *
 * Die Zeichenpositionen beziehen sich auf den KANONISCHEN VOLLTEXT der Norm —
 * die Verkettung aller Absätze, wie `gliederung.mjs → volltextDerNorm` sie
 * bildet. Das Frontend baut dieselbe Zeichenkette aus dem DOM auf; nur wenn
 * beide Seiten identisch rechnen, sitzen die Farben richtig.
 *
 * Übernommen werden ausschließlich die drei Kategorien, die der Entwurf kennt.
 * Das Definiendum (`def`) hat in der Legende keine Marke und bleibt draußen —
 * lieber keine Farbe als eine, die niemand erklärt.
 *
 *   node tools/struktur.mjs                 alle Gesetze
 *   node tools/struktur.mjs --nur solzg
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ZIEL = path.join(WURZEL, "struktur");
const FORMAT = 1;

const args = process.argv.slice(2);
const nurRoh = args.includes("--nur") ? args[args.indexOf("--nur") + 1] : null;
const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const nur = nurRoh ? new Set(nurRoh.split(",").map(kurz).filter(Boolean)) : null;

/** Die drei Kategorien der Legende. Alles andere wird nicht eingefärbt. */
const TYP = { tb: "tatbestand", rf: "rechtsfolge", ausn: "ausnahme" };

const register = JSON.parse(await readFile(path.join(WURZEL, "data", "index.json"), "utf8"));
const gesetze = register.gesetze.filter(
  (m) => !nur || [m.abk, m.slug, m.datei].some((k) => nur.has(kurz(k))),
);
if (!gesetze.length) { console.error("Kein passendes Gesetz gefunden."); process.exit(2); }

await mkdir(ZIEL, { recursive: true });

let gesamtNormen = 0, gesamtSegmente = 0;

for (const meta of gesetze) {
  const datei = path.join(WURZEL, "annotations", meta.datei);
  let annotation;
  try {
    annotation = JSON.parse(await readFile(datei, "utf8"));
  } catch (fehler) {
    console.warn(`  ⚠ ${meta.abk}: keine Annotationen (${path.basename(datei)}) — übersprungen`);
    continue;
  }

  const normen = {};
  let segmenteImGesetz = 0;

  for (const [normId, anm] of Object.entries(annotation.normen || {})) {
    const segmente = [];

    for (const satz of anm.saetze || []) {
      for (const element of satz.elemente || []) {
        const typ = TYP[element.art];
        if (!typ) continue;

        /* Mehrteilige Spannen („werden … zugerechnet") liegen an zwei Stellen
           im Text und gehören trotzdem zu EINEM Merkmal. Jedes Stück wird
           eigens eingefärbt, die Zusammengehörigkeit steht in `gruppe`. */
        const stuecke = Array.isArray(element.teile) && element.teile.length
          ? element.teile
          : [{ von: element.von, laenge: element.laenge }];

        const gruppe = segmente.length;
        for (const stueck of stuecke) {
          if (!Number.isInteger(stueck.von) || !stueck.laenge) continue;
          segmente.push({
            typ,
            von: stueck.von,
            bis: stueck.von + stueck.laenge,
            pfad: element.pfad || satz.pfad || null,
            konfidenz: typeof element.konfidenz === "number" ? element.konfidenz : null,
            ...(stuecke.length > 1 ? { gruppe } : {}),
          });
        }
      }
    }

    if (!segmente.length) continue;
    segmente.sort((a, b) => a.von - b.von || a.bis - b.bis);
    normen[normId] = { segmente };
    segmenteImGesetz += segmente.length;
    gesamtNormen++;
  }

  const inhalt = {
    abk: annotation.abk || meta.abk,
    titel: annotation.titel || meta.titel,
    format: FORMAT,
    erzeugt: new Date().toISOString(),
    quelle: "annotations/" + meta.datei,
    verfahren: annotation.verfahren || null,
    hinweis: "Maschinell erkannt, nicht redaktionell geprüft. "
      + "Zeichenpositionen beziehen sich auf den kanonischen Volltext der Norm.",
    normen,
  };

  await writeFile(path.join(ZIEL, meta.datei), `${JSON.stringify(inhalt)}\n`);
  gesamtSegmente += segmenteImGesetz;
  console.log(`  ${meta.abk.padEnd(7)} ${String(Object.keys(normen).length).padStart(4)} Normen · ${String(segmenteImGesetz).padStart(6)} Segmente`);
}

console.log(`\n${gesamtNormen} Normen, ${gesamtSegmente} Segmente nach struktur/ geschrieben.`);
