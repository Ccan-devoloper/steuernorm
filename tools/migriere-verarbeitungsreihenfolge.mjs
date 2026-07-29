#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const wurzel = path.resolve(import.meta.dirname, "..");
const skriptDatei = path.join(wurzel, "tools", "ki-annotieren.mjs");
const workflowDatei = path.join(wurzel, ".github", "workflows", "ki-vollannotation.yml");

let skript = await readFile(skriptDatei, "utf8");
const auswahlAlt = `  const gesetze = register.gesetze.filter((gesetz) => {
    if (!nur) return true;
    return [gesetz.abk, gesetz.slug, gesetz.datei].some((kandidat) => nur.has(schluessel(kandidat)));
  });
  if (!gesetze.length) {`;
const auswahlNeu = `  const gesetze = register.gesetze.filter((gesetz) => {
    if (!nur) return true;
    return [gesetz.abk, gesetz.slug, gesetz.datei].some((kandidat) => nur.has(schluessel(kandidat)));
  });
  // Beim automatischen Vollaufbau werden kleine Gesetze zuerst abgeschlossen.
  // Bereits fertige Gesetze verursachen dabei keine Modellaufrufe, weil ihre Text-Hashes wiederverwendet werden.
  if (!nur) {
    gesetze.sort((a, b) => {
      const anzahlA = Number.isFinite(Number(a.anzahl)) ? Number(a.anzahl) : Number.MAX_SAFE_INTEGER;
      const anzahlB = Number.isFinite(Number(b.anzahl)) ? Number(b.anzahl) : Number.MAX_SAFE_INTEGER;
      return anzahlA - anzahlB || String(a.abk).localeCompare(String(b.abk), "de");
    });
  }
  if (!gesetze.length) {`;
if (!skript.includes(auswahlAlt)) throw new Error("Auswahlblock in ki-annotieren.mjs nicht gefunden");
skript = skript.replace(auswahlAlt, auswahlNeu);
await writeFile(skriptDatei, skript);

let workflow = await readFile(workflowDatei, "utf8");
const aufrufAlt = `          if [ -n "\${INPUT_GESETZ:-}" ]; then
            args+=(--nur "$INPUT_GESETZ")
          elif [ "$EVENT_NAME" = "push" ]; then
            # Nach Codeänderungen zuerst ein kleines Gesetz vollständig produktiv absichern.
            args+=(--nur solzg)
          fi
          node tools/ki-annotieren.mjs "\${args[@]}"`;
const aufrufNeu = `          if [ -n "\${INPUT_GESETZ:-}" ]; then
            args+=(--nur "$INPUT_GESETZ")
          fi
          node tools/ki-annotieren.mjs "\${args[@]}"`;
if (!workflow.includes(aufrufAlt)) throw new Error("Push-Sonderfall im KI-Workflow nicht gefunden");
workflow = workflow.replace(aufrufAlt, aufrufNeu);
await writeFile(workflowDatei, workflow);

console.log("Kleine Gesetze werden künftig zuerst verarbeitet; Push-Läufe setzen den gesamten offenen Bestand fort.");
