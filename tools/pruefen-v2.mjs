#!/usr/bin/env node
/** Vollständigkeits- und Konsistenzprüfung der automatischen Annotationen. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const W = path.resolve(import.meta.dirname, "..");
const register = JSON.parse(await readFile(path.join(W, "data", "index.json"), "utf8"));
const minQuellen = Number(process.env.MIN_QUELLEN || 4);
const erlaubteKlassen = new Set(["rule", "definition", "fiction", "obligation", "prohibition", "permission", "entitlement", "calculation", "procedure", "competence", "reference_only", "no_classic_rule"]);
const normativ = new Set(["rule", "definition", "fiction", "obligation", "prohibition", "permission", "entitlement", "calculation", "procedure", "competence"]);

function text(h = "") { return h.replace(/<br\s*\/?\s*>/gi, " ").replace(/<\/p>|<\/li>|<\/dd>|<\/dt>|<\/tr>|<\/h\d>/gi, ". ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&sect;/g, "§").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim(); }
function normtext(n) { return n.abs.map((a) => text(a.html)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); }
function hash(s) { return createHash("sha256").update(s).digest("hex"); }

let fehler = 0, warnungen = 0, marker = 0, normen = 0, regeln = 0;
const proGesetz = [];
for (const meta of register.gesetze) {
  const gesetz = JSON.parse(await readFile(path.join(W, "data", meta.datei), "utf8"));
  const ann = JSON.parse(await readFile(path.join(W, "annotations", meta.datei), "utf8"));
  let gesetzRegeln = 0;
  if (ann.abk !== meta.abk) { console.error(`FEHLER ${meta.abk}: falsches Kürzel`); fehler++; }
  if (!ann.automatisch || Number(ann.pipeline_version) < 2) { console.error(`FEHLER ${meta.abk}: keine v2-Automatikdatei`); fehler++; }
  for (const n of gesetz.normen) {
    normen++;
    const a = ann.normen?.[n.id];
    if (!a) { console.error(`FEHLER ${meta.abk} ${n.enbez}: Annotation fehlt`); fehler++; continue; }
    const voll = normtext(n);
    if (a.text_hash !== hash(voll)) { console.error(`FEHLER ${meta.abk} ${n.enbez}: Text-Hash veraltet`); fehler++; }
    if (!erlaubteKlassen.has(a.klassifikation)) { console.error(`FEHLER ${meta.abk} ${n.enbez}: unbekannte Klasse ${a.klassifikation}`); fehler++; }
    if (!Array.isArray(a.quellen) || a.quellen.length < minQuellen) { console.error(`FEHLER ${meta.abk} ${n.enbez}: nur ${a.quellen?.length || 0} Quellen`); fehler++; }
    if (!Number.isFinite(Number(a.konfidenz)) || Number(a.konfidenz) < 0 || Number(a.konfidenz) > 1) { console.error(`FEHLER ${meta.abk} ${n.enbez}: ungültige Konfidenz`); fehler++; }
    for (const art of ["tb", "rf", "ausnahmen"]) {
      if (!Array.isArray(a[art])) { console.error(`FEHLER ${meta.abk} ${n.enbez}: ${art} ist kein Array`); fehler++; continue; }
      for (const p of a[art]) { marker++; if (!voll.includes(p)) { console.error(`FEHLER ${meta.abk} ${n.enbez} [${art}]: nicht im Text: ${String(p).slice(0, 100)}`); fehler++; } }
    }
    const hatRegel = a.tb.length > 0 && a.rf.length > 0;
    if (hatRegel) { regeln++; gesetzRegeln++; }
    if (normativ.has(a.klassifikation) && !hatRegel) { console.warn(`WARNUNG ${meta.abk} ${n.enbez}: normative Klasse ohne TB/RF-Paar`); warnungen++; }
    if (!normativ.has(a.klassifikation) && hatRegel) { console.warn(`WARNUNG ${meta.abk} ${n.enbez}: TB/RF bei Klasse ${a.klassifikation}`); warnungen++; }
  }
  const extras = Object.keys(ann.normen || {}).filter((id) => !gesetz.normen.some((n) => n.id === id));
  if (extras.length) { console.warn(`WARNUNG ${meta.abk}: ${extras.length} verwaiste Annotationen`); warnungen += extras.length; }
  proGesetz.push(`${meta.abk} ${gesetzRegeln}/${gesetz.normen.length}`);
}
console.log(`\nAbdeckung: ${regeln}/${normen} Normen mit TB/RF; ${marker} Textmarkierungen.`);
console.log(`Gesetze: ${proGesetz.join(" · ")}`);
console.log(`${fehler} Fehler, ${warnungen} Warnungen.`);
if (fehler) process.exitCode = 1;
