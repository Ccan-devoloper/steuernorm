#!/usr/bin/env node
/**
 * eval.mjs — misst die Annotationsqualität gegen einen Goldstandard.
 *
 *   node tools/eval.mjs                 # alle Gesetze mit Goldstandard
 *   node tools/eval.mjs --nur solzg
 *   node tools/eval.mjs --detail        # jede Fehlzuordnung einzeln
 *
 * Erwartet:
 *   annotations/<gesetz>.json   die tatsächlich erzeugten Annotationen (Ist)
 *   eval/gold/<gesetz>.json     die von Hand geprüfte Referenz (Soll, format 3)
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const GOLD = path.join(WURZEL, "eval", "gold");
const args = process.argv.slice(2);
const detail = args.includes("--detail");
const nurIdx = args.indexOf("--nur");
const nur = nurIdx >= 0 ? new Set(args[nurIdx + 1].split(",").map((s) => s.trim().toLowerCase())) : null;

/* ------------------------------ Vergleich ------------------------------ */

const STOPP = new Set(["der", "die", "das", "des", "dem", "den", "ein", "eine", "eines", "einer",
  "und", "oder", "nach", "des", "für", "bei", "von", "vom", "zur", "zum", "auf", "ist", "sind",
  "wird", "werden", "einkommensteuergesetzes", "gesetzes"]);

function tokens(s) {
  return new Set((s.toLowerCase().match(/[a-zäöüß0-9]{3,}/g) || []).filter((t) => !STOPP.has(t)));
}

/** 0..1 — wie stark decken sich zwei Spannen? Überlappungskoeffizient, robust gegen Längenunterschiede. */
function deckung(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let g = 0;
  for (const t of A) if (B.has(t)) g++;
  return g / Math.min(A.size, B.size);
}

const TREFFER = 0.6;   // ab hier gilt eine Spanne als wiedererkannt

/* ------------------------------ Goldformat ------------------------------ */

function goldElemente(norm) {
  const raus = [];
  for (const satz of norm.saetze || []) {
    for (const el of satz.elemente || []) {
      raus.push({ art: el.art, text: el.text, pfad: el.pfad || satz.pfad, rolle: el.rolle || "" });
    }
  }
  return raus;
}

/**
 * Die erzeugten Spannen — MIT ihrem Rechtssatz.
 *
 * Die flachen Listen `norm.tb`, `norm.rf`, `norm.ausnahmen` tragen keine
 * Pfadangabe. Ohne sie ordnet der Abgleich quer über die ganze Norm zu, und
 * das geht in Normen mit gleichförmigen Absätzen schief: § 3 SolzG nennt
 * dieselbe Freigrenze dreimal, einmal je Lohnzahlungszeitraum
 * („ein Zwölftel", „sieben Dreihundertsechzigstel", „ein Dreihundertsechzigstel"
 * des in Absatz 3 Satz 1 Nummer 1 angegebenen Betrages"). Deren Wortüberdeckung
 * liegt weit über der Schwelle. Eine frühe Sollspanne griff sich dann die
 * Fundstelle, die eine spätere gebraucht hätte — und beide zählten falsch: die
 * eine als Fehltreffer, die andere als Auslassung.
 *
 * Aus `saetze[].elemente[]` kommt der Pfad mit, deshalb wird von dort gelesen.
 * Die flachen Listen bleiben der Rückfall für ältere Dateien.
 */
function istElemente(norm) {
  if (!norm) return [];
  if (Array.isArray(norm.saetze) && norm.saetze.length) {
    const raus = [];
    for (const satz of norm.saetze) {
      for (const el of satz.elemente || []) {
        raus.push({ art: el.art, text: el.text, pfad: el.pfad || satz.pfad || "" });
      }
    }
    if (raus.length) return raus;
  }
  return [
    ...(norm.tb || []).map((t) => ({ art: "tb", text: t, pfad: "" })),
    ...(norm.rf || []).map((t) => ({ art: "rf", text: t, pfad: "" })),
    ...(norm.ausnahmen || []).map((t) => ({ art: "ausn", text: t, pfad: "" })),
  ];
}

/* ------------------------------ Fehlerklassen ------------------------------ */

const MONAT = /\b(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/;

function fehlerklasse(el, gold, normObj) {
  if (MONAT.test(el.text.slice(0, 12)) || /\bdem \d{1,2}\.$/.test(el.text) || /\b\d\.$/.test(el.text.trim())) {
    return "fragment";
  }
  const gegen = gold.find((g) => g.art !== el.art && deckung(el.text, g.text) >= TREFFER);
  if (gegen) return `vertauscht (soll ${gegen.art})`;
  if (/^(Der|Die|Das)\s+\w+(zuschlag|steuer|abgabe)?$/i.test(el.text.trim())) return "nur Normsubjekt";
  if (el.text.split(/\s+/).length > 40) return "zu grob (>40 Wörter)";
  if (/BGBl\.|BStBl\./.test(el.text)) return "Fundstelle statt Merkmal";
  return "nicht im Gold";
}

/* ------------------------------ Lauf ------------------------------ */

let dateien;
try {
  dateien = (await readdir(GOLD)).filter((f) => f.endsWith(".json"));
} catch {
  console.error(`Kein Goldstandard gefunden. Erwartet: ${GOLD}/<gesetz>.json`);
  process.exit(2);
}
if (nur) dateien = dateien.filter((f) => nur.has(f.replace(/\.json$/, "")));
if (!dateien.length) { console.error("Für --nur wurde kein Goldstandard gefunden."); process.exit(2); }

const gesamt = { tb: { tp: 0, fp: 0, fn: 0 }, rf: { tp: 0, fp: 0, fn: 0 }, ausn: { tp: 0, fp: 0, fn: 0 } };
const klassen = new Map();
let typRichtig = 0, typGesamt = 0;

for (const datei of dateien) {
  const gold = JSON.parse(await readFile(path.join(GOLD, datei), "utf8"));
  const ist = JSON.parse(await readFile(path.join(WURZEL, "annotations", datei), "utf8"));
  console.log(`\n══ ${gold.abk} ${"═".repeat(Math.max(0, 56 - gold.abk.length))}`);

  for (const [id, gnorm] of Object.entries(gold.normen)) {
    const inorm = ist.normen?.[id];
    const g = goldElemente(gnorm);
    const i = istElemente(inorm);

    /* ZWEI DURCHGÄNGE, und die Reihenfolge ist der Punkt: erst im selben
       Rechtssatz, dann normweit. Sonst greift eine frühe Sollspanne die
       Fundstelle weg, die eine gleichlautende spätere gebraucht hätte. */
    const gTreffer = new Set();
    const iTreffer = new Set();
    const zuordnen = (nurGleicherPfad) => {
      for (const [gi, ge] of g.entries()) {
        if (gTreffer.has(gi)) continue;
        let beste = -1, besteDeckung = TREFFER;
        for (const [ii, ie] of i.entries()) {
          if (iTreffer.has(ii) || ie.art !== ge.art) continue;
          if (nurGleicherPfad && ie.pfad && ge.pfad && ie.pfad !== ge.pfad) continue;
          const d = deckung(ge.text, ie.text);
          /* Die BESTE Überdeckung, nicht die erste: Zwei Spannen desselben
             Rechtssatzes können beide über der Schwelle liegen. */
          if (d >= besteDeckung) { besteDeckung = d; beste = ii; }
        }
        if (beste >= 0) { gTreffer.add(gi); iTreffer.add(beste); }
      }
    };
    zuordnen(true);
    zuordnen(false);

    const zeile = { tb: [0, 0, 0], rf: [0, 0, 0], ausn: [0, 0, 0] };
    g.forEach((ge, gi) => { const k = zeile[ge.art]; if (k) gTreffer.has(gi) ? k[0]++ : k[2]++; });
    i.forEach((ie, ii) => { const k = zeile[ie.art]; if (k && !iTreffer.has(ii)) k[1]++; });
    for (const art of ["tb", "rf", "ausn"]) {
      gesamt[art].tp += zeile[art][0]; gesamt[art].fp += zeile[art][1]; gesamt[art].fn += zeile[art][2];
    }

    typGesamt++;
    const istTyp = inorm?.typ || inorm?.klassifikation || "—";
    const passt = typPasst(gnorm.typ, istTyp);
    if (passt) typRichtig++;

    const summe = zeile.tb[1] + zeile.rf[1] + zeile.ausn[1];
    const fehlt = zeile.tb[2] + zeile.rf[2] + zeile.ausn[2];
    console.log(
      `  § ${id.padEnd(4)} Soll ${String(g.length).padStart(2)} · erkannt ${String(zeile.tb[0] + zeile.rf[0] + zeile.ausn[0]).padStart(2)}` +
      ` · übrig ${String(summe).padStart(2)} · fehlt ${String(fehlt).padStart(2)}` +
      `   Typ ${passt ? "ok " : "‼  "} (${gnorm.typ} / ${istTyp})`,
    );

    /* Was das Soll verlangt und nicht gefunden wurde. Ohne diese Liste sagt
       die Bilanz nur, DASS etwas fehlt — nicht, welcher Bauform es angehört,
       und danach richtet sich, ob eine Regel oder ein Modell hilft. */
    if (detail) {
      g.forEach((ge, gi) => {
        if (gTreffer.has(gi)) return;
        console.log(`        ○ ${ge.art}  [fehlt]  ${ge.pfad ? ge.pfad + " · " : ""}`
          + `${ge.text.slice(0, 66)}${ge.text.length > 66 ? "…" : ""}`);
      });
    }

    i.forEach((ie, ii) => {
      if (iTreffer.has(ii)) return;
      const kl = fehlerklasse(ie, g, gnorm);
      klassen.set(kl, (klassen.get(kl) || 0) + 1);
      if (detail) console.log(`        ✗ ${ie.art}  [${kl}]  ${ie.text.slice(0, 78)}${ie.text.length > 78 ? "…" : ""}`);
    });
  }
}

/**
 * Passt der erkannte Normtyp zum Soll?
 *
 * Die Tabelle stammt aus Fassung 4 und kannte `fiktion` und `aussage` nicht —
 * beide gehören seit Fassung 5 zur Typologie in syntax.mjs. Die Folge war
 * absurd: Ein Rechtssatz, den beide Seiten als „aussage" führten, galt als
 * Fehlklassifikation, weil der Schlüssel in der Tabelle fehlte. Ergänzt sind
 * nur die fehlenden Schlüssel; die Zuordnungen selbst bleiben eng, damit die
 * Messung nicht durch Nachsicht besser aussieht.
 */
function typPasst(gtyp, ityp) {
  const karte = {
    konditional: ["rule", "konditional", "gemischt"],
    berechnung: ["calculation", "rule", "tarif", "gemischt", "konditional", "rechenregel"],
    tarif: ["calculation", "tarif", "gemischt"],
    verweisung: ["reference_only", "verweisung"],
    anwendung: ["no_classic_rule", "reference_only", "anwendung", "ohne_merkmale"],
    kollision: ["rule", "konditional"],
    gemischt: ["rule", "gemischt", "konditional"],
    definition: ["definition"],
    gegennorm: ["rule", "konditional"],
    // Seit Fassung 5 in der Typologie, in dieser Tabelle bisher nicht.
    fiktion: ["fiktion", "gleichstellung", "konditional", "gemischt", "rule"],
    aussage: ["aussage", "gemischt"],
    rechenregel: ["rechenregel", "calculation", "tarif", "gemischt"],
    gleichstellung: ["gleichstellung", "fiktion", "gemischt"],
  };
  return (karte[gtyp] || []).includes(ityp);
}

function pr(k) {
  const p = k.tp + k.fp ? k.tp / (k.tp + k.fp) : 0;
  const r = k.tp + k.fn ? k.tp / (k.tp + k.fn) : 0;
  const f = p + r ? (2 * p * r) / (p + r) : 0;
  return { p, r, f };
}

console.log(`\n${"─".repeat(60)}\nBilanz\n`);
console.log("  Kategorie   Precision   Recall   F1     tp/fp/fn");
for (const art of ["tb", "rf", "ausn"]) {
  const { p, r, f } = pr(gesamt[art]);
  const k = gesamt[art];
  console.log(`  ${art.padEnd(10)}  ${p.toFixed(2).padStart(8)}   ${r.toFixed(2).padStart(6)}   ${f.toFixed(2)}   ${k.tp}/${k.fp}/${k.fn}`);
}
console.log(`\n  Normtyp korrekt: ${typRichtig}/${typGesamt} (${((typRichtig / typGesamt) * 100).toFixed(0)} %)`);

if (klassen.size) {
  console.log("\n  Fehlzuordnungen nach Ursache:");
  [...klassen.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`    ${String(n).padStart(3)}  ${k}`));
}
console.log("");
