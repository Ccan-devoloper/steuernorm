#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const datei = path.resolve(import.meta.dirname, "..", ".github", "workflows", "ki-vollannotation.yml");
let yaml = await readFile(datei, "utf8");
const alt = `      - name: Finale Dateien und Zwischenstände prüfen
        run: node tools/pruefen-fortschritt.mjs | tee pruefbericht-ki.txt`;
const neu = `      - name: Finale Dateien und Zwischenstände prüfen
        shell: bash
        run: |
          set -euo pipefail
          node tools/pruefen-fortschritt.mjs | tee pruefbericht-ki.txt`;
if (!yaml.includes(alt)) throw new Error("Prüfschritt nicht im erwarteten Format gefunden");
yaml = yaml.replace(alt, neu);
await writeFile(datei, yaml);
console.log("Workflow-Prüfschritt verwendet jetzt pipefail");
