#!/usr/bin/env node
/**
 * pruefen.mjs — prüft die erzeugten Annotationen strukturell.
 *
 * Anders als die frühere Fassung prüft dieses Skript nicht nur, ob eine Spanne
 * IRGENDWO im Text vorkommt, sondern
 *   – ob sie an der gespeicherten Position steht,
 *   – ob sie in dem Rechtssatz steht, dem sie zugeordnet ist,
 *   – ob der Normtyp mit der erzeugten Ausgabe zusammenpasst,
 *   – ob die Validatoren sie heute noch durchlassen würden.
 *
 *   node tools/pruefen.mjs
 *   node tools/pruefen.mjs --nur solzg
 *   node tools/pruefen.mjs --streng     Warnungen zählen als Fehler
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { einheiten, volltextDerNorm } from "./lib/gliederung.mjs";
import { NICHT_MARKIEREN, verberst } from "./lib/syntax.mjs";
import { pruefeSpanne } from "./lib/validatoren.mjs";

const WURZEL = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const streng = args.includes("--streng");
const i = args.indexOf("--nur");
const kurz = (s) => String(s || "").toLowerCase().replace(/\.json$/, "").replace(/[^a-z0-9]/g, "");
const nur = i >= 0 ? new Set(args[i + 1].split(",").map(kurz)) : null;
const hash = (s) => createHash("sha256").update(s).digest("hex");

const register = JSON.parse(await readFile(path.join(WURZEL, "data", "index.json"), "utf8"));
const gesetze = register.gesetze.filter((m) => !nur || [m.abk, m.slug, m.datei].some((k) => nur.has(kurz(k))));

let fehler = 0, warnungen = 0, spannen = 0, normen = 0, markierbar = 0;
const gruende = new Map();

for (const meta of gesetze) {
  const gesetz = JSON.parse(await readFile(path.join(WURZEL, "data", meta.datei), "utf8"));
  let anm;
  try {
    anm = JSON.parse(await readFile(path.join(WURZEL, "annotations", meta.datei), "utf8"));
  } catch {
    console.error(`FEHLER ${meta.abk}: keine Annotationsdatei`);
    fehler++;
    continue;
  }

  if (Number(anm.format) !== 5) { console.error(`FEHLER ${meta.abk}: Format ${anm.format}, erwartet 5`); fehler++; }
  if (anm.abk !== meta.abk) { console.error(`FEHLER ${meta.abk}: falsches Kürzel`); fehler++; }

  for (const norm of gesetz.normen) {
    normen++;
    const a = anm.normen?.[norm.id];
    if (!a) { console.error(`FEHLER ${meta.abk} ${norm.enbez}: Annotation fehlt`); fehler++; continue; }

    const teile = einheiten(norm);
    const volltext = volltextDerNorm(norm);
    const eigenerHash = hash(teile.map((t) => t.text).join(" "));

    if (a.text_hash !== eigenerHash) {
      console.error(`FEHLER ${meta.abk} ${norm.enbez}: Text-Hash veraltet — neu annotieren`);
      fehler++;
      continue;
    }
    if (a.markierbar) markierbar++;

    const nachPfad = new Map(teile.map((t) => [t.pfad, t]));

    for (const satz of a.saetze || []) {
      const einheit = nachPfad.get(satz.pfad);
      if (!einheit) {
        console.error(`FEHLER ${meta.abk} ${norm.enbez}: unbekannter Pfad „${satz.pfad}"`);
        fehler++;
        continue;
      }
      if (NICHT_MARKIEREN.has(satz.typ) && (satz.elemente || []).length) {
        console.error(`FEHLER ${meta.abk} ${norm.enbez} ${satz.pfad}: Typ „${satz.typ}" darf keine Markierung tragen`);
        fehler++;
      }

      for (const el of satz.elemente || []) {
        spannen++;
        // Mehrteilige Spannen: jedes Stück einzeln prüfen.
        const stuecke = Array.isArray(el.teile) && el.teile.length
          ? el.teile
          : [{ text: el.text, von: el.von, laenge: el.text.length }];
        let stueckFehler = false;
        for (const st of stuecke) {
          if (volltext.substr(st.von, st.text.length) !== st.text) {
            console.error(`FEHLER ${meta.abk} ${norm.enbez} ${satz.pfad}: Teilstück nicht an seiner Position — „${st.text.slice(0, 40)}"`);
            fehler++; stueckFehler = true;
          } else if (!einheit.text.includes(st.text)) {
            console.error(`FEHLER ${meta.abk} ${norm.enbez} ${satz.pfad}: Teilstück außerhalb seines Rechtssatzes`);
            fehler++; stueckFehler = true;
          }
        }
        if (stueckFehler) continue;
        if (Array.isArray(el.teile) && el.teile.length) {
          const grund = pruefeSpanne({ art: el.art, text: el.teile[0].text }, {
            volltext, satztext: einheit.text, typ: satz.typ,
            verberst: verberst(einheit.text), katalog: Boolean(satz.katalog),
            gegenstand: String(gesetz.titel || "").replace(/gesetz.*$/i, "").toLowerCase(),
          });
          if (grund) { warnungen++; gruende.set(grund, (gruende.get(grund) || 0) + 1); }
          continue;
        }
        if (volltext.substr(el.von, el.text.length) !== el.text) {
          console.error(`FEHLER ${meta.abk} ${norm.enbez} ${satz.pfad}: Position stimmt nicht — „${el.text.slice(0, 40)}"`);
          fehler++;
          continue;
        }
        if (!einheit.text.includes(el.text)) {
          console.error(`FEHLER ${meta.abk} ${norm.enbez} ${satz.pfad}: Spanne liegt außerhalb ihres Rechtssatzes`);
          fehler++;
          continue;
        }
        const grund = pruefeSpanne(el, {
          volltext, satztext: einheit.text, typ: satz.typ,
          verberst: verberst(einheit.text), katalog: Boolean(satz.katalog),
          gegenstand: String(gesetz.titel || "").replace(/gesetz.*$/i, "").toLowerCase(),
        });
        if (grund) {
          warnungen++;
          gruende.set(grund, (gruende.get(grund) || 0) + 1);
          if (streng) { console.error(`FEHLER ${meta.abk} ${norm.enbez} ${satz.pfad}: ${grund}`); fehler++; }
        }
      }
    }

    // Schema muss aus vorhandenen Spannen bestehen
    for (const stufe of a.schema || []) {
      for (const s of stufe.sub || []) {
        if (typeof s === "object" && s.t && !volltext.includes(s.t)) {
          console.error(`FEHLER ${meta.abk} ${norm.enbez}: Schemapunkt ohne Textgrundlage`);
          fehler++;
        }
      }
    }
  }
}

console.log(`\n${normen} Normen · ${spannen} Spannen · ${markierbar} markierbar`);
if (gruende.size) {
  console.log("\nWarnungen:");
  [...gruende.entries()].sort((a, b) => b[1] - a[1]).forEach(([g, n]) => console.log(`  ${String(n).padStart(4)}  ${g}`));
}
console.log(`\n${fehler} Fehler, ${warnungen} Warnungen.`);
process.exit(fehler ? 1 : 0);
