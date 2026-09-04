#!/usr/bin/env node
/**
 * instagram.mjs — veröffentlicht den Beitrag des Tages auf Instagram.
 *
 * WOZU. Instagram hat keine Schnittstelle zum Hochladen einer Bilddatei. Der
 * einzige Weg für ein Programm führt über die Graph-Schnittstelle von Meta
 * und besteht aus zwei Schritten:
 *
 *   1. Container anlegen   POST /<konto>/media          image_url + caption
 *   2. Veröffentlichen     POST /<konto>/media_publish  creation_id
 *
 * Dazwischen lädt Meta das Bild von der angegebenen ADRESSE — nicht aus dem
 * Aufruf. Das Bild muss also im Netz stehen, bevor der erste Schritt läuft,
 * und zwar öffentlich, ohne Anmeldung und als JPEG. Deshalb schreibt der
 * Arbeitsablauf das Bild zuerst ins Repositorium und übergibt hier die
 * Rohadresse dieses Commits: Sie ist sofort erreichbar und ändert sich nie,
 * während die Adresse auf GitHub Pages erst nach der nächsten
 * Veröffentlichung antwortet.
 *
 * Der Container ist nicht sofort fertig. Meta lädt das Bild im Hintergrund;
 * `media_publish` vor `status_code=FINISHED` scheitert mit einer irreführenden
 * Meldung. Der Lauf fragt deshalb nach, bevor er veröffentlicht.
 *
 * VORAUSSETZUNGEN (einmalig, siehe docs/07-beitraege-und-instagram.md):
 *   - ein Instagram-Konto vom Typ Unternehmen oder Creator
 *   - eine damit verbundene Facebook-Seite
 *   - eine Meta-App mit den Berechtigungen instagram_basic,
 *     instagram_content_publish, pages_read_engagement
 *   - ein langlebiges Zugriffstoken (rund 60 Tage; siehe --pruefen)
 *
 * UMGEBUNG
 *   IG_TOKEN     langlebiges Zugriffstoken
 *   IG_KONTO     Kennnummer des Instagram-Kontos (nicht der Benutzername)
 *   IG_BILDBASIS Adresse, unter der `beitraege/` öffentlich steht,
 *                z. B. https://raw.githubusercontent.com/<nutzer>/<repo>/<sha>/
 *
 *   node tools/instagram.mjs                  jüngsten Beitrag veröffentlichen
 *   node tools/instagram.mjs --id 2026-09-04-ao-175b
 *   node tools/instagram.mjs --trocken        nichts senden, alles zeigen
 *   node tools/instagram.mjs --pruefen        nur Zugang und Restlaufzeit prüfen
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const API = process.env.IG_API || "https://graph.facebook.com/v21.0";

const args = process.argv.slice(2);
const schalter = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true);
};
const nurId = schalter("--id");
const trocken = args.includes("--trocken");
const nurPruefen = args.includes("--pruefen");

const TOKEN = process.env.IG_TOKEN || "";
const KONTO = process.env.IG_KONTO || "";
/* Leer bleibt leer: `"".replace(/\/*$/, "/")` ergäbe „/" und damit eine
   Adresse, die aussieht wie eine und keine ist. */
const BILDBASIS = process.env.IG_BILDBASIS ? process.env.IG_BILDBASIS.replace(/\/*$/, "/") : "";

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ein Aufruf gegen die Graph-Schnittstelle.
 *
 * Meta antwortet auf Fehler mit HTTP 400 und einem `error`-Objekt, in dem die
 * eigentliche Ursache steht — „The user is not an Instagram Business",
 * „Media type not supported", „(#10) Application does not have permission".
 * Diese Meldung wird durchgereicht; ein blankes „HTTP 400" wäre hier nutzlos.
 */
async function graph(pfad, form = null, methode = "GET") {
  const url = new URL(`${API}/${pfad}`.replace(/([^:])\/{2,}/g, "$1/"));
  const einstellungen = { method: methode, headers: {} };
  if (form) {
    const koerper = new URLSearchParams({ ...form, access_token: TOKEN });
    einstellungen.body = koerper;
  } else {
    url.searchParams.set("access_token", TOKEN);
  }
  const antwort = await fetch(url, einstellungen);
  const text = await antwort.text();
  let daten = {};
  try { daten = JSON.parse(text); } catch { daten = { roh: text }; }
  if (!antwort.ok || daten.error) {
    const f = daten.error || {};
    const teile = [f.message, f.error_user_title, f.error_user_msg].filter(Boolean);
    throw new Error(`Graph ${antwort.status}: ${teile.join(" — ") || text.slice(0, 300)}`);
  }
  return daten;
}

/** Bild öffentlich erreichbar? Meta sagt bei einem 404 nur „unknown error". */
async function bildPruefen(adresse) {
  const antwort = await fetch(adresse, { method: "GET", headers: { Range: "bytes=0-0" } });
  const typ = antwort.headers.get("content-type") || "";
  if (!antwort.ok) throw new Error(`Bild nicht erreichbar (HTTP ${antwort.status}): ${adresse}`);
  if (!/jpe?g/i.test(typ)) {
    throw new Error(`Bild wird als „${typ}" ausgeliefert; Instagram nimmt nur JPEG: ${adresse}`);
  }
  return typ;
}

/** Restlaufzeit des Tokens — der häufigste Grund, warum das Posten eines Tages ausfällt. */
async function zugangPruefen() {
  const wer = await graph(`${KONTO}`, null);
  const name = wer.username || wer.name || KONTO;
  let ablauf = null;
  try {
    const geprueft = await graph(`debug_token?input_token=${encodeURIComponent(TOKEN)}`, null);
    const ab = geprueft.data && geprueft.data.expires_at;
    if (ab) ablauf = ab === 0 ? "unbefristet" : new Date(ab * 1000).toISOString().slice(0, 10);
  } catch (fehler) {
    /* `debug_token` verlangt gewöhnlich ein App-Token. Fehlt es, ist das kein
       Grund abzubrechen — es ist nur eine Auskunft weniger. */
    ablauf = `nicht abfragbar (${fehler.message})`;
  }
  return { konto: KONTO, name, ablauf };
}

/* ── Lauf ──────────────────────────────────────────────────────────────── */
if (!TOKEN || !KONTO) {
  console.error("IG_TOKEN und IG_KONTO fehlen. Ohne beides kann nicht veröffentlicht werden.");
  console.error("Einrichtung: docs/07-beitraege-und-instagram.md");
  process.exit(trocken ? 0 : 2);
}

if (nurPruefen) {
  const zugang = await zugangPruefen();
  console.log(`Konto ${zugang.name} (${zugang.konto}) erreichbar. Token läuft: ${zugang.ablauf}`);
  process.exit(0);
}

const index = JSON.parse(await readFile(path.join(WURZEL, "beitraege/index.json"), "utf8"));
const zeile = (nurId && nurId !== true)
  ? index.beitraege.find((b) => b.id === String(nurId))
  : index.beitraege[0];                       // der Index ist absteigend nach Datum sortiert
if (!zeile) {
  console.error(nurId ? `Beitrag ${nurId} steht nicht im Index.` : "Kein Beitrag vorhanden.");
  process.exit(1);
}

const beitrag = JSON.parse(await readFile(path.join(WURZEL, zeile.datei), "utf8"));
if (beitrag.veroeffentlicht && beitrag.veroeffentlicht.instagram && !args.includes("--nochmal")) {
  console.log(`${beitrag.id} ist bereits veröffentlicht `
    + `(${beitrag.veroeffentlicht.instagram.zeitpunkt}). --nochmal erzwingt es.`);
  process.exit(0);
}

const bildAdresse = BILDBASIS ? BILDBASIS + beitrag.bild : null;
const unterschrift = beitrag.instagram.text;

console.log(`Beitrag  ${beitrag.id} — ${beitrag.titel}`);
console.log(`Bild     ${bildAdresse || "(IG_BILDBASIS fehlt)"}`);
console.log(`Text     ${unterschrift.length} Zeichen`);

if (trocken) {
  console.log(`\n${unterschrift}\n`);
  console.log("Trockenlauf — nichts gesendet.");
  process.exit(0);
}

if (!bildAdresse) {
  console.error("IG_BILDBASIS fehlt. Instagram lädt das Bild selbst; es braucht eine öffentliche Adresse.");
  process.exit(2);
}

const typ = await bildPruefen(bildAdresse);
console.log(`Bild erreichbar (${typ}).`);

/* Schritt 1 — Container. */
const container = await graph(`${KONTO}/media`, {
  image_url: bildAdresse,
  caption: unterschrift,
}, "POST");
console.log(`Container ${container.id} angelegt.`);

/* Schritt 2 — warten, bis Meta das Bild geholt hat. Zwölf Versuche mit
   wachsendem Abstand decken die üblichen Ladezeiten ab; danach ist etwas
   anderes falsch als die Geduld. */
let zustand = null;
for (let versuch = 1; versuch <= 12; versuch++) {
  await schlafen(Math.min(2000 * versuch, 10000));
  const stand = await graph(`${container.id}?fields=status_code,status`, null);
  zustand = stand.status_code;
  if (zustand === "FINISHED") break;
  if (zustand === "ERROR" || zustand === "EXPIRED") {
    throw new Error(`Container ${zustand}: ${stand.status || "ohne nähere Angabe"}`);
  }
  console.log(`  Container ${zustand || "IN_PROGRESS"} (Versuch ${versuch}).`);
}
if (zustand !== "FINISHED") throw new Error(`Container wurde nicht fertig (zuletzt ${zustand}).`);

/* Schritt 3 — veröffentlichen. */
const veroeffentlicht = await graph(`${KONTO}/media_publish`, { creation_id: container.id }, "POST");
let permalink = null;
try {
  permalink = (await graph(`${veroeffentlicht.id}?fields=permalink`, null)).permalink || null;
} catch { /* der Beitrag steht; der Permalink ist Beiwerk */ }

console.log(`Veröffentlicht: ${veroeffentlicht.id}${permalink ? ` — ${permalink}` : ""}`);

/* Was veröffentlicht wurde, steht danach im Beitrag selbst — sonst weiß der
   nächste Lauf nicht, dass dieser Tag erledigt ist, und postet doppelt. */
beitrag.veroeffentlicht = {
  ...(beitrag.veroeffentlicht || {}),
  instagram: {
    id: veroeffentlicht.id,
    permalink,
    zeitpunkt: new Date().toISOString(),
    bild: bildAdresse,
  },
};
await writeFile(path.join(WURZEL, zeile.datei), `${JSON.stringify(beitrag, null, 2)}\n`);

const eintrag = index.beitraege.find((b) => b.id === beitrag.id);
if (eintrag) eintrag.instagram = beitrag.veroeffentlicht.instagram.permalink || veroeffentlicht.id;
await writeFile(path.join(WURZEL, "beitraege/index.json"), `${JSON.stringify(index, null, 2)}\n`);

await mkdir(path.join(WURZEL, "reports"), { recursive: true });
await writeFile(path.join(WURZEL, "reports/instagram.json"), `${JSON.stringify({
  zuletzt: beitrag.id,
  zeitpunkt: beitrag.veroeffentlicht.instagram.zeitpunkt,
  medien_id: veroeffentlicht.id,
  permalink,
  titel: beitrag.titel,
}, null, 2)}\n`);
