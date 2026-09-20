#!/usr/bin/env node
/**
 * redaktion-pruefen.mjs — Integritätsprüfung für manuell verifizierte
 * Strukturkorrekturen.
 *
 * Redaktion ist absichtlich eine andere Vertrauensstufe als die automatische
 * Annotation. Dieser Lauf stellt deshalb sicher, dass
 *   – jeder Befund eindeutig ist und eine bekannte Kategorie trägt,
 *   – der geprüfte Normtext seit der Verifikation nicht geändert wurde,
 *   – textgenaue Befunde tatsächlich in struktur/ angekommen sind und
 *   – bewusst offene Befunde auch als solche ausgewiesen bleiben.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ORDNER = path.join(WURZEL, "redaktion");
const TYPEN = new Set(["tatbestand", "rechtsfolge", "ausnahme", "definition"]);

function normId(fundstelle){
  const f = String(fundstelle || "").trim();
  let m = /^§\s*([0-9]+[a-z]?)/i.exec(f);
  if (m) return m[1].toLowerCase();
  m = /^Anlage\s+([0-9]+[a-z]?)/i.exec(f);
  return m ? "anlage-" + m[1].toLowerCase() : null;
}

function gleich(a, b){
  return JSON.stringify(a) === JSON.stringify(b);
}

let fehler = 0;
const fail = (text) => { console.error("FEHLER " + text); fehler++; };

let dateien = [];
try {
  dateien = (await readdir(ORDNER)).filter((x) => x.endsWith(".json")).sort();
} catch {
  console.log("Keine redaktionellen Dateien vorhanden.");
  process.exit(0);
}

for (const datei of dateien) {
  const [red, ann, struktur] = await Promise.all([
    readFile(path.join(ORDNER, datei), "utf8").then(JSON.parse),
    readFile(path.join(WURZEL, "annotations", datei), "utf8").then(JSON.parse),
    readFile(path.join(WURZEL, "struktur", datei), "utf8").then(JSON.parse),
  ]);

  const befunde = Array.isArray(red.befunde) ? red.befunde : [];
  if (red.anzahl !== befunde.length)
    fail(`${datei}: anzahl ${red.anzahl} ≠ ${befunde.length} Befunde`);

  const ids = new Set();
  const zaehler = {};
  let angewandt = 0, offen = 0;

  for (const b of befunde) {
    if (!b.id || ids.has(b.id)) fail(`${datei}: doppelte/fehlende Befund-ID ${b.id || "(leer)"}`);
    ids.add(b.id);
    if (!TYPEN.has(b.typ)) fail(`${datei} ${b.id}: unbekannter Typ ${b.typ}`);
    zaehler[b.typ] = (zaehler[b.typ] || 0) + 1;

    const id = normId(b.fundstelle);
    if (!id) { fail(`${datei} ${b.id}: Fundstelle ohne auflösbare Norm`); continue; }

    const a = ann.normen?.[id];
    const s = struktur.normen?.[id];
    if (!a) { fail(`${datei} ${b.id}: Annotation für ${id} fehlt`); continue; }
    if (!s) { fail(`${datei} ${b.id}: Struktur für ${id} fehlt`); continue; }

    const erwartet = red.text_hashes?.[id];
    if (!erwartet) fail(`${datei} ${b.id}: kein geprüfter Text-Hash für ${id}`);
    else if (a.text_hash !== erwartet)
      fail(`${datei} ${b.id}: Normtext ${id} hat sich seit der Verifikation geändert`);

    if (Array.isArray(b.bereiche)) {
      const maxBis = Math.max(0,
        ...(a.saetze || []).map((x) => x.bis || 0),
        ...(s.saetze || []).map((x) => x.bis || 0),
        ...(s.segmente || []).map((x) => x.bis || 0));
      for (const r of b.bereiche) {
        if (!Number.isInteger(r.von) || !Number.isInteger(r.bis)
            || r.von < 0 || r.bis <= r.von || r.bis > maxBis)
          fail(`${datei} ${b.id}: ungültiger Bereich ${JSON.stringify(r)} (Text bis ${maxBis})`);
      }
    }

    const direkt = (s.redaktion?.angewandt || []).includes(b.id)
      || (s.segmente || []).some((x) => (x.belegIds || []).includes(b.id));
    if (direkt) {
      angewandt++;
    } else if (b.umsetzung === "nicht textgenau auflösbar") {
      offen++;
      if (!(s.redaktion?.offen || []).includes(b.id))
        fail(`${datei} ${b.id}: offener Befund fehlt in struktur/.redaktion.offen`);
    } else {
      fail(`${datei} ${b.id}: weder angewandt noch ausdrücklich offen`);
    }
  }

  if (!gleich(zaehler, red.kategorien || {}))
    fail(`${datei}: Kategorienzählung stimmt nicht (${JSON.stringify(zaehler)})`);

  const root = struktur.redaktion || {};
  if (root.befunde !== befunde.length)
    fail(`${datei}: struktur/.redaktion.befunde = ${root.befunde}, erwartet ${befunde.length}`);
  if (root.angewandt !== angewandt)
    fail(`${datei}: struktur/.redaktion.angewandt = ${root.angewandt}, erwartet ${angewandt}`);
  const rootOffen = [...(root.offen || [])].sort();
  const erwartetOffen = befunde
    .filter((b) => b.umsetzung === "nicht textgenau auflösbar")
    .map((b) => b.id).sort();
  if (!gleich(rootOffen, erwartetOffen))
    fail(`${datei}: offene Befunde stimmen nicht (${rootOffen.join(", ")})`);

  console.log(`${red.abk || datei}: ${befunde.length} Befunde · ${angewandt} angewandt · ${offen} offen · Text-Hashes geprüft`);
}

if (fehler) {
  console.error(`\n${fehler} Fehler in redaktionellen Strukturdaten.`);
  process.exit(1);
}
console.log("\nRedaktionelle Strukturdaten konsistent.");
