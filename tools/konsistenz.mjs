#!/usr/bin/env node
/**
 * konsistenz.mjs — findet Wendungen, die im Bestand widersprüchlich eingeordnet sind.
 *
 * Dieselbe Wendung sollte über alle Gesetze hinweg dieselbe Kategorie tragen.
 * „gilt entsprechend" ist eine Rechtsfolge; steht sie irgendwo als Tatbestandsmerkmal,
 * ist eine der beiden Markierungen falsch. Welche, sagt dieses Verfahren nicht — aber es
 * zeigt die Stelle, und die Ausreißer sind fast immer die Fehler.
 *
 * Rein rechnerisch: kein Modell, kein Netz, Sekunden statt Minuten. Damit ist es die
 * billigste automatische Fehlerquelle, die es im Bestand gibt.
 *
 *   node tools/konsistenz.mjs
 *   node tools/konsistenz.mjs --min 5        erst ab 5 Vorkommen berichten
 *   node tools/konsistenz.mjs --quote 0.85   ab welchem Übergewicht ein Ausreißer gilt
 *   node tools/konsistenz.mjs --schreiben    reports/konsistenz.json erzeugen
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const wert = (f, v) => { const i = args.indexOf(f); return i >= 0 ? (args[i + 1] ?? v) : v; };
const MIN = Number(wert("--min", 4));
const QUOTE = Number(wert("--quote", 0.8));
const schreiben = args.includes("--schreiben");

/* Nur Wendungen vergleichen, die überhaupt vergleichbar sind: kurze, formelhafte
   Fügungen. Ganze Merkmalsspannen sind naturgemäß einmalig. */
const MIN_WOERTER = 2;
const MAX_WOERTER = 8;

const register = JSON.parse(await readFile(path.join(WURZEL, "data", "index.json"), "utf8"));

const vorkommen = new Map();   // normalisierte Wendung → { tb, rf, ausn, stellen[] }

for (const meta of register.gesetze) {
  let anm;
  try {
    anm = JSON.parse(await readFile(path.join(WURZEL, "annotations", meta.datei), "utf8"));
  } catch { continue; }

  for (const [id, norm] of Object.entries(anm.normen || {})) {
    for (const satz of norm.saetze || []) {
      for (const el of satz.elemente || []) {
        const schluessel = normalisiere(el.text);
        if (!schluessel) continue;
        if (!vorkommen.has(schluessel)) {
          vorkommen.set(schluessel, { tb: 0, rf: 0, ausn: 0, beispiel: el.text, stellen: [] });
        }
        const e = vorkommen.get(schluessel);
        e[el.art] = (e[el.art] || 0) + 1;
        e.stellen.push({
          gesetz: anm.abk, norm: id, pfad: el.pfad, art: el.art,
          konfidenz: el.konfidenz, status: norm.status,
        });
      }
    }
  }
}

/* ─────────────────────────── Auswertung ─────────────────────────── */

const funde = [];

for (const [schluessel, e] of vorkommen) {
  const gesamt = e.tb + e.rf + e.ausn;
  if (gesamt < MIN) continue;

  const arten = [["tb", e.tb], ["rf", e.rf], ["ausn", e.ausn]].sort((a, b) => b[1] - a[1]);
  const [mehrheit, mehrheitZahl] = arten[0];
  if (mehrheitZahl === gesamt) continue;                 // einheitlich
  if (mehrheitZahl / gesamt < QUOTE) continue;           // echte Uneindeutigkeit, kein Ausreißer

  const ausreisser = e.stellen.filter((s) => s.art !== mehrheit);
  funde.push({
    wendung: e.beispiel,
    schluessel,
    verteilung: { tb: e.tb, rf: e.rf, ausn: e.ausn },
    mehrheit,
    ausreisser: ausreisser.sort((a, b) => a.konfidenz - b.konfidenz),
  });
}

funde.sort((a, b) => b.ausreisser.length - a.ausreisser.length || a.wendung.localeCompare(b.wendung));

/* ─────────────────────────── Ausgabe ─────────────────────────── */

const NAME = { tb: "Tatbestand", rf: "Rechtsfolge", ausn: "Ausnahme" };

if (!funde.length) {
  console.log(`\nKeine Widersprüche ab ${MIN} Vorkommen und ${Math.round(QUOTE * 100)} % Übergewicht.`);
} else {
  console.log(`\n${funde.length} Wendungen mit widersprüchlicher Zuordnung\n`);
  for (const f of funde.slice(0, 40)) {
    const v = f.verteilung;
    const anteile = [["tb", v.tb], ["rf", v.rf], ["ausn", v.ausn]]
      .filter(([, n]) => n).map(([a, n]) => `${a} ${n}×`).join(" · ");
    console.log(`  „${kurz(f.wendung, 62)}"`);
    console.log(`    ${anteile}   →   Mehrheit: ${NAME[f.mehrheit]}, ${f.ausreisser.length} Ausreißer`);
    for (const a of f.ausreisser.slice(0, 4)) {
      console.log(`      ${a.gesetz} § ${a.norm} ${a.pfad ?? ""} — als ${NAME[a.art]} (k=${a.konfidenz}, ${a.status})`);
    }
    console.log("");
  }
  if (funde.length > 40) console.log(`  … und ${funde.length - 40} weitere.\n`);
}

const gesamtAusreisser = funde.reduce((a, f) => a + f.ausreisser.length, 0);
console.log(`${vorkommen.size} verschiedene Wendungen · ${gesamtAusreisser} verdächtige Markierungen\n`);

if (schreiben) {
  const ziel = path.join(WURZEL, "reports", "konsistenz.json");
  await writeFile(ziel, `${JSON.stringify({
    erzeugt: new Date().toISOString(),
    schwellen: { min: MIN, quote: QUOTE },
    wendungen: vorkommen.size,
    verdaechtig: gesamtAusreisser,
    funde,
  }, null, 2)}\n`);
  console.log(`Bericht: ${path.relative(WURZEL, ziel)}`);
}

/* ─────────────────────────── Hilfen ─────────────────────────── */

function normalisiere(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/§+\s*\d+[a-z]?(\s*(abs(atz|\.)|satz|nummer|nr\.|buchst(abe|\.))\s*\d+[a-z]?)*/g, "§")
    .replace(/\b\d[\d.,]*\b/g, "#")
    .replace(/[„""»«(),;:.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const woerter = t.split(" ").filter(Boolean);
  if (woerter.length < MIN_WOERTER || woerter.length > MAX_WOERTER) return null;
  return t;
}

function kurz(t, max) {
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
