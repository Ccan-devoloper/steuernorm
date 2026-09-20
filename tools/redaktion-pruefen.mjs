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


/* Regression der 21 Stellen, die beim ersten Abgleich 158/179 noch offen
 * waren. Die Anker sind bewusst textgenau: Eine spätere Vergröberung auf
 * ganze Absätze soll den Test brechen. E095 und E102 bleiben dagegen offen,
 * weil ihr Kommentarinhalt im zitierten Normwortlaut keine korrespondierende
 * Teilspanne hat. */
const REGRESSION_ESTG_20260920 = {
  E027:{ norm:"2a", typ:"definition", segmente:[[4663,4757],[4761,4936]] },
  E050:{ norm:"19", typ:"definition", segmente:[[199,390]] },
  E051:{ norm:"19", typ:"definition", segmente:[[391,763]] },
  E055:{ norm:"81", typ:"definition", segmente:[[0,82]] },
  E058:{ norm:"93", typ:"tatbestand", segmente:[[0,404]] },
  E059:{ norm:"93", typ:"ausnahme", segmente:[[1283,2807]] },
  E077:{ norm:"105", typ:"tatbestand", segmente:[[143,195]] },
  E078:{ norm:"105", typ:"ausnahme", segmente:[[130,141]] },
  E095:{ norm:"114", offen:true },
  E096:{ norm:"114", typ:"rechtsfolge", segmente:[[0,73]] },
  E102:{ norm:"116", offen:true },
  E120:{ norm:"90", typ:"tatbestand", segmente:[[1384,1631]] },
  E125:{ norm:"96", typ:"ausnahme", segmente:[[723,850]], fundstelle:"§ 96 Abs. 2 S. 3" },
  E126:{ norm:"119", typ:"rechtsfolge", segmente:[[253,317]] },
  E134:{ norm:"93", typ:"definition", segmente:[[5954,5958],[6222,6226]] },
  E142:{ norm:"93", typ:"ausnahme", segmente:[[1283,2807]] },
  E153:{ norm:"92a", typ:"tatbestand", segmente:[[16187,16649]] },
  E163:{ norm:"100", typ:"tatbestand", segmente:[[1257,1485]] },
  E174:{ norm:"anlage-1", typ:"rechtsfolge", segmente:[[0,604]] },
  E176:{ norm:"anlage-1a", typ:"tatbestand", segmente:[[453,1158]] },
  E177:{ norm:"anlage-1a", typ:"rechtsfolge", segmente:[[1162,1265]] },
};

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

  if (datei === "estg.json") {
    const nachId = new Map(befunde.map((b) => [b.id, b]));
    for (const [id, soll] of Object.entries(REGRESSION_ESTG_20260920)) {
      const b = nachId.get(id);
      const n = struktur.normen?.[soll.norm];
      const segmente = (n?.segmente || []).filter((x) => (x.belegIds || []).includes(id));
      if (!b) { fail(`estg.json: Regressionsbefund ${id} fehlt`); continue; }
      if (soll.fundstelle && b.fundstelle !== soll.fundstelle)
        fail(`estg.json ${id}: Fundstelle ${b.fundstelle} ≠ ${soll.fundstelle}`);
      if (soll.offen) {
        if (b.umsetzung !== "nicht textgenau auflösbar")
          fail(`estg.json ${id}: muss ausdrücklich nicht textgenau auflösbar bleiben`);
        if (segmente.length)
          fail(`estg.json ${id}: offener Befund darf keine redaktionelle Textspanne färben`);
        if (!(n?.redaktion?.offen || []).includes(id))
          fail(`estg.json ${id}: fehlt in normbezogener Offen-Liste`);
        continue;
      }
      for (const [von, bis] of soll.segmente || []) {
        if (!segmente.some((x) => x.typ === soll.typ && x.von === von && x.bis === bis))
          fail(`estg.json ${id}: erwartete ${soll.typ}-Spanne ${von}–${bis} fehlt`);
      }
    }
    if (red.aufloesung?.explizit !== 19 || red.aufloesung?.nicht_textgenau !== 2)
      fail(`estg.json: Auflösungsbilanz stimmt nicht (${JSON.stringify(red.aufloesung)})`);
  }

  console.log(`${red.abk || datei}: ${befunde.length} Befunde · ${angewandt} angewandt · ${offen} offen · Text-Hashes geprüft`);
}

if (fehler) {
  console.error(`\n${fehler} Fehler in redaktionellen Strukturdaten.`);
  process.exit(1);
}
console.log("\nRedaktionelle Strukturdaten konsistent.");
