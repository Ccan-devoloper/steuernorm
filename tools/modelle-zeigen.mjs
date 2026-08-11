#!/usr/bin/env node
/**
 * modelle-zeigen.mjs — welche Modelle darf dieser Schlüssel benutzen?
 *
 * ANLASS. Der Annotationslauf scheiterte mit HTTP 404 und der Meldung „Kein
 * Modellzugang — Schlüssel prüfen". Das war die falsche Fährte: Ein
 * ungültiger Schlüssel antwortet mit 400 oder 403. 404 heißt, dass es den
 * angefragten MODELLNAMEN unter dieser API-Fassung nicht gibt — meist, weil
 * Google ihn zurückgezogen hat. Ein fest eingetragener Modellname überlebt
 * keinen längeren Zeitraum.
 *
 * Dieses Werkzeug fragt die API, was sie tatsächlich anbietet, und ordnet die
 * Antwort ein. Es erzeugt nichts und zählt nicht gegen das Tageskontingent.
 *
 *   export GEMINI_API_KEY=...
 *   node tools/modelle-zeigen.mjs
 */

import { verfuegbareModelle, modelleAbgleichen } from "./lib/modell.mjs";

const TOKEN = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const WUNSCH = (process.env.KI_MODELLE || "gemini-2.5-flash,gemini-2.0-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (!TOKEN) {
  console.error("GEMINI_API_KEY ist nicht gesetzt.");
  console.error("Kostenlosen Schlüssel holen: https://aistudio.google.com/app/apikey");
  console.error("Dann:  export GEMINI_API_KEY=...");
  process.exit(2);
}

let verfuegbar;
try {
  verfuegbar = await verfuegbareModelle(TOKEN);
} catch (fehler) {
  console.error("");
  console.error("  ✗ " + fehler.message);
  console.error("");
  /* Die Zahl im Fehler ist die eigentliche Auskunft — sie sagt, wo zu suchen ist. */
  const code = /HTTP (\d+)/.exec(fehler.message)?.[1];
  if (code === "400" || code === "401" || code === "403") {
    console.error("  Der Schlüssel wird abgelehnt. Neu erzeugen auf");
    console.error("  https://aistudio.google.com/app/apikey und das Secret ersetzen.");
  } else if (code === "404") {
    console.error("  404 auf der Modellliste betrifft den Endpunkt, nicht den Schlüssel.");
    console.error("  Möglich ist auch, dass für das Projekt des Schlüssels die");
    console.error("  „Generative Language API“ nicht freigeschaltet ist.");
  } else {
    console.error("  Weder Schlüssel noch Modellname — eher Netz oder Störung bei Google.");
  }
  console.error("");
  process.exit(1);
}

const gemini = verfuegbar.filter((m) => m.startsWith("gemini-"));
console.log("");
console.log(`  ${verfuegbar.length} Modelle erreichbar, davon ${gemini.length} aus der Gemini-Familie:`);
console.log("");
for (const m of gemini) console.log("    " + m);
if (gemini.length !== verfuegbar.length) {
  console.log("");
  console.log("  Weitere (Einbettung, Bild, Sprache):");
  for (const m of verfuegbar.filter((m) => !m.startsWith("gemini-"))) console.log("    " + m);
}

console.log("");
console.log("  Eingestellt ist:  " + WUNSCH.join(", "));
const { modelle, ersetzt } = modelleAbgleichen(WUNSCH, verfuegbar);
if (!ersetzt.length) {
  console.log("  Alle eingestellten Modelle sind verfügbar. Der Lauf kann starten.");
} else {
  for (const { gewuenscht, statt } of ersetzt) {
    console.log(statt
      ? `  ✗ ${gewuenscht} gibt es nicht — der Lauf nähme automatisch ${statt}.`
      : `  ✗ ${gewuenscht} gibt es nicht, und kein Ersatz derselben Familie ist verfügbar.`);
  }
  console.log("");
  console.log("  Dauerhaft eintragen in .github/workflows/annotationen.yml:");
  console.log("      KI_MODELLE: " + (modelle.length ? modelle.join(",") : gemini.slice(0, 2).join(",")));
}
console.log("");
