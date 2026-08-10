#!/usr/bin/env node
/**
 * schriften-holen.mjs — legt die Schriften ins Repository.
 *
 * Die Oberfläche arbeitet ohne Netz. Kämen die Schriften von Google Fonts,
 * fiele der Normtext offline auf eine Systemschrift zurück — Zeilenfall und
 * Spaltenbreite ändern sich damit sichtbar, und die Lesespalte von 36 rem
 * stimmt nicht mehr. Zweitens spart der lokale Weg eine Anfrage an einen
 * Dritten bei jedem Aufruf.
 *
 * Geladen werden nur die Zeichensätze `latin` und `latin-ext`. Kyrillisch,
 * Griechisch und Vietnamesisch braucht ein deutscher Gesetzestext nicht; sie
 * machen zwei Drittel der Dateien aus.
 *
 * Lizenz der Schriften: SIL Open Font License 1.1 — sie dürfen mitgeliefert
 * werden, siehe schriften/LIZENZ.txt.
 *
 *   node tools/schriften-holen.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ZIEL = path.join(WURZEL, "schriften");

const QUELLE = "https://fonts.googleapis.com/css2"
  + "?family=Source+Serif+4:opsz,wght@8..60,300;8..60,400;8..60,600"
  + "&family=IBM+Plex+Mono:wght@400;500"
  + "&family=IBM+Plex+Sans:wght@400;500;600"
  + "&display=swap";

/* Ohne modernen User-Agent liefert Google die alte truetype-Fassung. */
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
  + "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const ZEICHENSAETZE = new Set(["latin", "latin-ext"]);

const antwort = await fetch(QUELLE, { headers: { "User-Agent": BROWSER } });
if (!antwort.ok) { console.error("Google Fonts nicht erreichbar:", antwort.status); process.exit(1); }
const css = await antwort.text();

/* Je Schnitt und Zeichensatz ein Block, davor ein Kommentar mit dem Namen. */
const bloecke = [...css.matchAll(/\/\*\s*([\w\-[\]]+)\s*\*\/\s*(@font-face\s*\{[\s\S]*?\})/g)];
const behalten = bloecke.filter(([, name]) => ZEICHENSAETZE.has(name));
if (!behalten.length) { console.error("Keine passenden Blöcke gefunden."); process.exit(1); }

await mkdir(ZIEL, { recursive: true });

const geholt = new Map();
const regeln = [];

for (const [, zeichensatz, block] of behalten) {
  const url = /url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/.exec(block)[1];
  const familie = /font-family:\s*'([^']+)'/.exec(block)[1];
  const gewicht = /font-weight:\s*([\d\s]+);/.exec(block)[1].trim().replace(/\s+/g, "-");
  const dateiname = `${familie.replace(/\s+/g, "")}-${gewicht}-${zeichensatz}.woff2`;

  if (!geholt.has(url)) {
    const datei = await fetch(url, { headers: { "User-Agent": BROWSER } });
    if (!datei.ok) { console.warn("  ⚠ nicht geladen:", url); continue; }
    const daten = Buffer.from(await datei.arrayBuffer());
    await writeFile(path.join(ZIEL, dateiname), daten);
    geholt.set(url, { dateiname, groesse: daten.length });
  }
  /* Relativ zur CSS-Datei, nicht zur Seite: schriften.css liegt selbst in
     schriften/. Ein vorangestelltes „schriften/“ ergäbe schriften/schriften/. */
  regeln.push(block.replace(url, "./" + geholt.get(url).dateiname));
}

const kopf = `/* Schriften lokal — erzeugt von tools/schriften-holen.mjs.

   Nicht von Hand ändern. Zum Auffrischen das Werkzeug erneut laufen lassen.

   Nur die Zeichensätze latin und latin-ext. Lizenz: SIL Open Font License 1.1
   (Source Serif 4, IBM Plex Sans, IBM Plex Mono), siehe LIZENZ.txt. */

`;
await writeFile(path.join(ZIEL, "schriften.css"), kopf + regeln.join("\n") + "\n");

const gesamt = [...geholt.values()].reduce((a, x) => a + x.groesse, 0);
console.log(`${geholt.size} Dateien, ${Math.round(gesamt / 1024)} KB nach schriften/ geschrieben.`);
