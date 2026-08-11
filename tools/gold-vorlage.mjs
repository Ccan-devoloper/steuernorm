#!/usr/bin/env node
/**
 * gold-vorlage.mjs — legt das Gerüst für einen Goldstandard an.
 *
 * WARUM NICHT VON HAND. Der Goldstandard vergleicht Spannen über
 * Wortüberdeckung (`deckung()` in eval.mjs). Eine von Hand abgetippte Spanne,
 * die ein Wort anders schreibt als der Normtext, zählt als Fehltreffer — und
 * misst dann den Abschreibfehler statt der Erkennung. Die Rechtssätze müssen
 * deshalb aus derselben Quelle kommen wie im Lauf: `gliederung.mjs`.
 *
 * Ausgegeben wird ein Gerüst mit leeren `elemente`-Listen, in das die
 * Zuordnung von Hand eingetragen wird. Der Wortlaut je Rechtssatz steht als
 * `text` daneben, damit wörtlich zitiert werden kann.
 *
 *   node tools/gold-vorlage.mjs solzg 3,4,5     # bestimmte Normen
 *   node tools/gold-vorlage.mjs solzg           # alle Normen des Gesetzes
 *   node tools/gold-vorlage.mjs --stichprobe 50 # gestreute Auswahl
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { einheiten as zerlegeNorm } from "./lib/gliederung.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEN = path.join(WURZEL, "data");
const args = process.argv.slice(2);

const register = JSON.parse(await readFile(path.join(DATEN, "index.json"), "utf8"));

/* ── Gestreute Stichprobe ──────────────────────────────────────────────
   Nicht die ersten n Normen: Die stehen am Anfang jedes Gesetzes und sind
   dort auffällig oft Anwendungsbereich und Begriffsbestimmungen. Gezogen wird
   gleichmäßig über jedes Gesetz, damit alle Bauformen vorkommen. */
if (args[0] === "--stichprobe") {
  const wunsch = Number(args[1] || 50);

  /* GESTAFFELT NACH GRÖSSE, nicht gleichmäßig. Der Bestand ist stark
     ungleich: 21 % der Normen haben unter 300 Zeichen, 10 % über 5 000. Eine
     Auswahl ohne Rücksicht darauf misst überwiegend kurze Normen — und kurze
     Normen sind fast immer Tarif oder Verweisung, also gerade die Bauformen,
     bei denen die Syntaxanalyse ohnehin sicher ist.

     Die Bänder folgen der tatsächlichen Verteilung, die letzten beiden
     bewusst unterproportional: Eine Norm mit 9 000 Zeichen von Hand zu
     prüfen kostet ein Vielfaches, und der Goldstandard soll gebaut werden,
     nicht geplant werden. Diese Untergewichtung gehört in den Bericht. */
  const BAENDER = [
    [0, 300, 0.18], [300, 800, 0.24], [800, 1500, 0.20],
    [1500, 2500, 0.18], [2500, 5000, 0.14], [5000, Infinity, 0.06],
  ];

  const alle = [];
  for (const meta of register.gesetze) {
    const gesetz = JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8"));
    for (const n of gesetz.normen) {
      if (!n.abs || !n.abs.length || /weggefallen/i.test(n.titel || "")) continue;
      alle.push({
        abk: meta.abk, slug: meta.datei.replace(/\.json$/, ""), id: n.id,
        enbez: n.enbez, titel: n.titel || "",
        zeichen: n.abs.map((a) => a.html.replace(/<[^>]+>/g, "")).join(" ").length,
      });
    }
  }

  const raus = [];
  for (const [von, bis, anteil] of BAENDER) {
    const band = alle.filter((n) => n.zeichen >= von && n.zeichen < bis);
    const soll = Math.round(wunsch * anteil);
    /* Gleichmäßig durch das Band greifen, nicht die ersten n: Sonst kommen
       alle aus demselben Gesetz. */
    const schritt = Math.max(1, Math.floor(band.length / soll));
    for (let i = 0, genommen = 0; i < band.length && genommen < soll; i += schritt, genommen++) {
      raus.push(band[i]);
    }
  }

  raus.sort((a, b) => a.slug.localeCompare(b.slug) || a.zeichen - b.zeichen);
  for (const r of raus) {
    console.log(`${r.slug.padEnd(8)} ${r.id.padEnd(6)} ${String(r.zeichen).padStart(5)} Z  ${r.enbez} ${r.titel}`);
  }
  const gesetze = new Set(raus.map((r) => r.abk)).size;
  console.error(`\n${raus.length} Normen über ${gesetze} Gesetze, `
    + `${raus.reduce((a, r) => a + r.zeichen, 0).toLocaleString("de")} Zeichen.`);
  process.exit(0);
}

const slug = String(args[0] || "").toLowerCase();
const meta = register.gesetze.find((g) => g.datei.replace(/\.json$/, "") === slug || g.abk.toLowerCase() === slug);
if (!meta) { console.error("Gesetz nicht gefunden: " + slug); process.exit(2); }

const gesetz = JSON.parse(await readFile(path.join(DATEN, meta.datei), "utf8"));
const wunsch = args[1] ? new Set(args[1].split(",").map((s) => s.trim())) : null;
const normen = gesetz.normen.filter((n) => (!wunsch || wunsch.has(n.id)) && n.abs && n.abs.length);
if (!normen.length) { console.error("Keine passende Norm."); process.exit(2); }

const gerippe = { abk: meta.abk, titel: meta.titel, format: 3, quelle: "von Hand geprüft", normen: {} };
for (const norm of normen) {
  const einheiten = zerlegeNorm(norm);
  gerippe.normen[norm.id] = {
    enbez: norm.enbez,
    titel: norm.titel || "",
    typ: "",                       // konditional | tarif | definition | verweisung | anwendung | gemischt …
    saetze: einheiten.map((e) => ({
      pfad: e.pfad,
      text: e.text,                // Wortlaut zum wörtlichen Zitieren; bleibt in der Datei stehen
      elemente: [],                // { art: "tb"|"rf"|"ausn", text: "wörtlich aus text", rolle: "" }
    })),
  };
}
console.log(JSON.stringify(gerippe, null, 1));
