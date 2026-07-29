#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const ZIEL = path.join(WURZEL, ".tmp", "xml-github");
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const GESETZE = [
  "ao_1977",
  "bewg",
  "estg",
  "kstg_1977",
  "ustg_1980",
  "gewstg",
  "erbstg_1974",
  "grstg_1973",
  "fgo",
  "grestg_1983",
  "umwstg_2006",
  "astg",
  "solzg_1995",
  "invstg_2018",
];

function kopf(accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    "User-Agent": "steuernorm-updater",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

async function api(url, accept) {
  const antwort = await fetch(url, { headers: kopf(accept) });
  if (!antwort.ok) {
    const text = await antwort.text();
    throw new Error(`${antwort.status} ${antwort.statusText}: ${text.slice(0, 300)}`);
  }
  return antwort;
}

async function ladeGesetz(slug) {
  const ordnerUrl = `https://api.github.com/repos/QuantLaw/gesetze-im-internet/contents/data/items/${slug}?ref=data`;
  const liste = await (await api(ordnerUrl)).json();
  if (!Array.isArray(liste)) throw new Error(`Unerwartete Verzeichnisantwort für ${slug}`);

  const xmlDatei = liste.find((eintrag) => eintrag.type === "file" && eintrag.name.toLowerCase().endsWith(".xml"));
  if (!xmlDatei?.url) throw new Error(`Keine XML-Datei für ${slug} gefunden`);

  const xml = await (await api(xmlDatei.url, "application/vnd.github.raw+json")).text();
  if (!xml.includes("<norm")) throw new Error(`Ungültige XML-Datei für ${slug}`);

  await writeFile(path.join(ZIEL, `${slug}.xml`), xml, "utf8");
  console.log(`geladen       ${slug}`);
}

async function ausfuehren() {
  await rm(ZIEL, { recursive: true, force: true });
  await mkdir(ZIEL, { recursive: true });

  for (const slug of GESETZE) await ladeGesetz(slug);

  await new Promise((resolve, reject) => {
    const kind = spawn(process.execPath, [path.join(WURZEL, "tools", "update.mjs"), "--aus", ZIEL], {
      cwd: WURZEL,
      stdio: "inherit",
      env: process.env,
    });
    kind.on("error", reject);
    kind.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Konvertierung endete mit Code ${code}`)));
  });
}

try {
  await ausfuehren();
} catch (fehler) {
  console.error(`Aktualisierung fehlgeschlagen: ${fehler.message}`);
  process.exitCode = 1;
}
