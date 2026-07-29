#!/usr/bin/env node
/** Vollständigkeits- und Konsistenzprüfung der automatischen Annotationen. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const register = JSON.parse(await readFile(path.join(WURZEL, "data", "index.json"), "utf8"));
const minQuellen = Number(process.env.MIN_QUELLEN || 4);
const args = process.argv.slice(2);
const nurIndex = args.indexOf("--nur");
const nur = nurIndex >= 0
  ? args[nurIndex + 1]?.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)
  : null;

const erlaubteKlassen = new Set([
  "rule",
  "definition",
  "fiction",
  "obligation",
  "prohibition",
  "permission",
  "entitlement",
  "calculation",
  "procedure",
  "competence",
  "reference_only",
  "no_classic_rule",
]);
const normativ = new Set([
  "rule",
  "definition",
  "fiction",
  "obligation",
  "prohibition",
  "permission",
  "entitlement",
  "calculation",
  "procedure",
  "competence",
]);

function text(html = "") {
  return html
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/p>|<\/li>|<\/dd>|<\/dt>|<\/tr>|<\/h\d>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&sect;/g, "§")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function normtext(norm) {
  return norm.abs.map((absatz) => text(absatz.html)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function hash(inhalt) {
  return createHash("sha256").update(inhalt).digest("hex");
}

function kanonischeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return "";
  }
}

let fehler = 0;
let warnungen = 0;
let marker = 0;
let normen = 0;
let regeln = 0;
const proGesetz = [];

const gesetze = register.gesetze.filter((meta) =>
  !nur || nur.includes(meta.abk.toLowerCase()) || nur.includes(meta.slug),
);
if (!gesetze.length) throw new Error("Für --nur wurde kein Gesetz gefunden");

for (const meta of gesetze) {
  const gesetz = JSON.parse(await readFile(path.join(WURZEL, "data", meta.datei), "utf8"));
  const annotationen = JSON.parse(await readFile(path.join(WURZEL, "annotations", meta.datei), "utf8"));
  let gesetzRegeln = 0;

  if (annotationen.abk !== meta.abk) {
    console.error(`FEHLER ${meta.abk}: falsches Kürzel`);
    fehler++;
  }
  if (!annotationen.automatisch || Number(annotationen.pipeline_version) < 2) {
    console.error(`FEHLER ${meta.abk}: keine v2-Automatikdatei`);
    fehler++;
  }

  for (const norm of gesetz.normen) {
    normen++;
    const annotation = annotationen.normen?.[norm.id];
    if (!annotation) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: Annotation fehlt`);
      fehler++;
      continue;
    }

    const volltext = normtext(norm);
    if (annotation.text_hash !== hash(volltext)) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: Text-Hash veraltet`);
      fehler++;
    }
    if (!erlaubteKlassen.has(annotation.klassifikation)) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: unbekannte Klasse ${annotation.klassifikation}`);
      fehler++;
    }
    if (annotation.konsens_methode !== "ki_logik_quellen" || annotation.modell === "nur-regellogik") {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: kein KI-/Logik-/Quellenkonsens`);
      fehler++;
    }

    const quellen = Array.isArray(annotation.quellen) ? annotation.quellen : [];
    const support = Array.isArray(annotation.quellen_support)
      ? [...new Set(annotation.quellen_support.map(String))]
      : [];
    const quellenIds = new Set(quellen.map((quelle) => String(quelle.id)));
    const urls = quellen.map((quelle) => kanonischeUrl(quelle.url)).filter(Boolean);
    if (support.length < minQuellen) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: nur ${support.length} ausdrücklich stützende Referenzen`);
      fehler++;
    }
    if (new Set(urls).size < minQuellen) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: weniger als ${minQuellen} eindeutige Quellen-URLs`);
      fehler++;
    }
    if (support.some((id) => !quellenIds.has(id))) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: Quellen-Support verweist auf fehlende Quelle`);
      fehler++;
    }

    const konfidenz = Number(annotation.konfidenz);
    if (!Number.isFinite(konfidenz) || konfidenz < 0 || konfidenz > 1) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: ungültige Konfidenz`);
      fehler++;
    }

    for (const art of ["tb", "rf", "ausnahmen"]) {
      if (!Array.isArray(annotation[art])) {
        console.error(`FEHLER ${meta.abk} ${norm.enbez}: ${art} ist kein Array`);
        fehler++;
        continue;
      }
      for (const phrase of annotation[art]) {
        marker++;
        if (!volltext.includes(phrase)) {
          console.error(`FEHLER ${meta.abk} ${norm.enbez} [${art}]: nicht im Text: ${String(phrase).slice(0, 100)}`);
          fehler++;
        }
      }
    }

    const hatRegel = annotation.tb.length > 0 && annotation.rf.length > 0;
    if (hatRegel) {
      regeln++;
      gesetzRegeln++;
    }
    if (normativ.has(annotation.klassifikation) && !hatRegel) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: normative Klasse ohne TB/RF-Paar`);
      fehler++;
    }
    if (!normativ.has(annotation.klassifikation) && hatRegel) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: TB/RF bei nichtnormativer Klasse ${annotation.klassifikation}`);
      fehler++;
    }
    if (konfidenz < 0.55) {
      console.warn(`WARNUNG ${meta.abk} ${norm.enbez}: niedrige Konfidenz ${(konfidenz * 100).toFixed(0)} %`);
      warnungen++;
    }
  }

  const extras = Object.keys(annotationen.normen || {}).filter(
    (id) => !gesetz.normen.some((norm) => norm.id === id),
  );
  if (extras.length) {
    console.error(`FEHLER ${meta.abk}: ${extras.length} verwaiste Annotationen`);
    fehler += extras.length;
  }
  proGesetz.push(`${meta.abk} ${gesetzRegeln}/${gesetz.normen.length}`);
}

console.log(`\nAbdeckung: ${regeln}/${normen} Normen mit TB/RF; ${marker} Textmarkierungen.`);
console.log(`Gesetze: ${proGesetz.join(" · ")}`);
console.log(`${fehler} Fehler, ${warnungen} Warnungen.`);
if (fehler) process.exitCode = 1;
