#!/usr/bin/env node
/**
 * beitrag-bild.mjs — rendert das Bild zum Beitrag des Tages.
 *
 * WOZU. Instagram zeigt keinen Text ohne Bild. Die Graph-Schnittstelle nimmt
 * ausschließlich Bild oder Video an; die Bildunterschrift hängt daran. Ein
 * Beitrag ohne Bild wird also nicht „schlechter dargestellt", er wird gar
 * nicht angenommen.
 *
 * Das Bild ist deshalb kein Schmuck, sondern die Trägerfläche des Zitats. Es
 * zeigt, was diese Seite von einem Gesetzestext-Abdruck unterscheidet: den
 * Wortlaut mit der erkannten Struktur darin — Tatbestand sandfarben,
 * Rechtsfolge grün, Ausnahme rot, in denselben Farben wie im Arbeitsplatz,
 * mit derselben Legende darüber und demselben Hinweis darunter, dass die
 * Einfärbung maschinell ist. Wer das Bild sieht, hat die Seite verstanden.
 *
 * Gerendert wird in Chromium, weil dort dieselbe Typografie herauskommt wie
 * auf der Website: dieselben Schriftdateien aus `schriften/`, dieselbe
 * Silbentrennung, dasselbe Umbruchverhalten. Ein selbstgebautes SVG könnte
 * das nicht — es müsste Zeilenumbrüche raten.
 *
 * Format: 1080 × 1350 (4:5), das größte Hochformat, das Instagram ungekürzt
 * zeigt. JPEG, weil die Graph-Schnittstelle für `image_url` genau das
 * verlangt; ein PNG wird mit „media type not supported" abgelehnt.
 *
 *   npm install --no-save playwright
 *   node tools/beitrag-bild.mjs                 alle Beiträge ohne Bild
 *   node tools/beitrag-bild.mjs --id 2026-09-04-ao-175b
 *   node tools/beitrag-bild.mjs --alle          auch vorhandene neu rendern
 */

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const WURZEL = path.resolve(import.meta.dirname, "..");
const BREITE = 1080;
const HOEHE = 1350;

const args = process.argv.slice(2);
const schalter = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true);
};
const nurId = schalter("--id");
const alle = args.includes("--alle");

/* Wie in `browser-pruefen.mjs`: Chromium liegt in dieser Umgebung unter
   PLAYWRIGHT_BROWSERS_PATH; ohne ausdrücklichen Pfad sucht Playwright die
   headless-shell-Variante, die dort nicht liegt. */
const CHROMIUM = process.env.CHROMIUM_PFAD
  || (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);

const da = async (pfad) => { try { await access(pfad); return true; } catch { return false; } };
const schutz = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FARBE = {
  tatbestand: { grund: "#F3E3B8", rand: "#E0CE9E", marke: "Tatbestand" },
  rechtsfolge: { grund: "#D6E9DB", rand: "#B4D2BC", marke: "Rechtsfolge" },
  ausnahme: { grund: "#F5D9D4", rand: "#E3B7B0", marke: "Ausnahme" },
};

/**
 * Der Auszug mit eingefärbten Spannen.
 *
 * Die Spannen sind Zeichenpositionen im Auszug und überlappungsfrei (dafür
 * sorgt `beitrag.mjs`). Gebaut wird stumpf von links nach rechts; alles
 * zwischen zwei Spannen bleibt ungefärbt.
 */
function auszugMitFarbe(text, spannen = []) {
  const stuecke = [];
  let cursor = 0;
  for (const s of spannen) {
    if (s.von > cursor) stuecke.push(schutz(text.slice(cursor, s.von)));
    const f = FARBE[s.typ];
    const inhalt = schutz(text.slice(s.von, s.bis));
    stuecke.push(f ? `<mark class="s-${s.typ}">${inhalt}</mark>` : inhalt);
    cursor = s.bis;
  }
  if (cursor < text.length) stuecke.push(schutz(text.slice(cursor)));
  return stuecke.join("");
}

/**
 * Wieviel Text passt auf die Fläche?
 *
 * 1 350 Pixel sind endlich, der Wortlaut mancher Norm ist es kaum. Statt zu
 * raten, wird gemessen: Der Auszug wird im Browser gesetzt und, solange er
 * überläuft, um je einen Satz gekürzt — an der Satzgrenze, nie im Satz. So
 * steht auf jedem Bild so viel Norm, wie hineingeht, und kein halber Satz.
 */
async function passendKuerzen(seite) {
  for (let versuch = 0; versuch < 40; versuch++) {
    const zuViel = await seite.evaluate(() => {
      const k = document.querySelector(".karte");
      return k.scrollHeight > k.clientHeight + 1;
    });
    if (!zuViel) return versuch;
    const gekuerzt = await seite.evaluate(() => window.satzWegnehmen());
    if (!gekuerzt) return versuch;
  }
  return -1;
}

function seiteBauen(beitrag, schriftenUrl) {
  const wortlaut = beitrag.abschnitte.find((a) => a.art === "wortlaut");
  const verwaltung = beitrag.abschnitte.find((a) => a.art === "verwaltung");
  const genutzt = new Set((wortlaut.spannen || []).map((s) => s.typ));
  const legende = ["tatbestand", "rechtsfolge", "ausnahme"]
    .filter((t) => genutzt.has(t))
    .map((t) => `<span class="lg"><i class="s-${t}"></i>${FARBE[t].marke}</span>`)
    .join("");
  const datum = new Date(`${beitrag.datum}T12:00:00Z`)
    .toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<link rel="stylesheet" href="${schriftenUrl}">
<style>
  :root{
    --papier:#FCFCFC; --text:#14161A; --text-2:#3B4149; --text-3:#6C737C; --text-5:#9AA1A9;
    --linie:#D8DBE0; --linie-schwach:#E4E7EA;
    --tb-voll:#F3E3B8; --tb-rand:#E0CE9E;
    --rf-voll:#D6E9DB; --rf-rand:#B4D2BC;
    --au-voll:#F5D9D4; --au-rand:#E3B7B0;
    --serif:"Source Serif 4",Georgia,serif;
    --sans:"IBM Plex Sans",system-ui,sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${BREITE}px;height:${HOEHE}px}
  body{background:var(--papier);color:var(--text);font-family:var(--sans);
       -webkit-font-smoothing:antialiased;display:flex;flex-direction:column;padding:64px 64px 56px}

  .kopf{display:flex;justify-content:space-between;align-items:baseline;
        border-bottom:1px solid var(--linie);padding-bottom:18px}
  .wortmarke{font-family:var(--mono);font-size:26px;letter-spacing:.06em;font-weight:500}
  .kopf .datum{font-family:var(--mono);font-size:18px;color:var(--text-5)}

  .enbez{font-family:var(--mono);font-size:64px;font-weight:500;line-height:1.05;margin-top:44px}
  .normtitel{font-family:var(--serif);font-size:40px;font-weight:300;line-height:1.22;
             color:var(--text-2);margin-top:14px}
  .gliederung{font-family:var(--mono);font-size:17px;color:var(--text-5);margin-top:14px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .legende{display:flex;gap:22px;margin-top:34px;font-family:var(--mono);font-size:17px;color:var(--text-3)}
  .lg{display:flex;align-items:center;gap:9px}
  .lg i{width:22px;height:14px;border-radius:3px;display:inline-block}

  /* Die Karte ist der begrenzte Raum: Was hier nicht hineinpasst, wird
     satzweise weggenommen, bevor das Bild entsteht. */
  .karte{flex:1;min-height:0;overflow:hidden;margin-top:22px;padding-top:22px;
         border-top:1px solid var(--linie-schwach)}
  .auszug{font-family:var(--serif);font-size:34px;line-height:1.52;text-wrap:pretty;hyphens:auto}
  mark{background:none;color:inherit;border-radius:3px;padding:1px 0}
  .s-tatbestand{background:var(--tb-voll);box-shadow:0 0 0 2px var(--tb-voll)}
  .s-rechtsfolge{background:var(--rf-voll);box-shadow:0 0 0 2px var(--rf-voll)}
  .s-ausnahme{background:var(--au-voll);box-shadow:0 0 0 2px var(--au-voll)}
  .lg .s-tatbestand{box-shadow:inset 0 0 0 1px var(--tb-rand)}
  .lg .s-rechtsfolge{box-shadow:inset 0 0 0 1px var(--rf-rand)}
  .lg .s-ausnahme{box-shadow:inset 0 0 0 1px var(--au-rand)}

  .verwaltung{margin-top:26px;padding:18px 22px;border-left:3px solid #D9CFEA;background:#F3F0F8;
              font-family:var(--serif);font-size:24px;line-height:1.45;color:var(--text-2)}
  .verwaltung .fundstelle{display:block;font-family:var(--mono);font-size:16px;color:#6A4C93;
                          margin-bottom:8px;letter-spacing:.02em}

  .fuss{border-top:1px solid var(--linie);padding-top:18px;margin-top:22px;
        display:flex;justify-content:space-between;gap:24px;align-items:flex-end}
  .fuss p{font-family:var(--mono);font-size:15px;line-height:1.5;color:var(--text-5);max-width:640px}
  .fuss .stand{font-family:var(--mono);font-size:15px;color:var(--text-5);text-align:right;white-space:nowrap}
</style></head>
<body>
  <div class="kopf">
    <span class="wortmarke">steuernorm</span>
    <span class="datum">${schutz(datum)}</span>
  </div>

  <div class="enbez">${schutz(beitrag.norm.enbez)} ${schutz(beitrag.gesetz.abk)}</div>
  ${beitrag.norm.titel ? `<div class="normtitel">${schutz(beitrag.norm.titel)}</div>` : ""}
  ${beitrag.norm.gliederung ? `<div class="gliederung">${schutz(beitrag.norm.gliederung)}</div>` : ""}

  ${legende ? `<div class="legende">${legende}</div>` : ""}

  <div class="karte">
    <p class="auszug" id="auszug">${auszugMitFarbe(wortlaut.text, wortlaut.spannen)}</p>
    ${verwaltung && verwaltung.punkte.length ? `<div class="verwaltung" id="verwaltung">
      <span class="fundstelle">${schutz([verwaltung.punkte[0].quelle, verwaltung.punkte[0].fundstelle].filter(Boolean).join(" · "))}</span>
      ${schutz(verwaltung.punkte[0].text)}
    </div>` : ""}
  </div>

  <div class="fuss">
    <p>Wortlaut amtlich. Einfärbung maschinell erkannt, nicht redaktionell geprüft.
       Keine Rechtsberatung.</p>
    <span class="stand">${schutz(beitrag.gesetz.abk)} · Volltext auf steuernorm</span>
  </div>

<script>
  /* Kürzen von hinten, satzweise. Zuerst geht der Verwaltungsauszug (er ist
     Beiwerk), dann der Wortlaut — und der nur bis auf einen Satz. Bleibt es
     dann noch zu groß, meldet der Lauf es; ein abgeschnittener Satz im Bild
     wäre schlimmer als ein enges Bild. */
  window.satzWegnehmen = function(){
    const vw = document.getElementById("verwaltung");
    if (vw){
      const knoten = [...vw.childNodes];
      const text = knoten[knoten.length - 1];
      const roh = (text.textContent || "").trim();
      const saetze = roh.split(/(?<=[.!?])\\s+/).filter(Boolean);
      if (saetze.length > 1){ text.textContent = saetze.slice(0, -1).join(" "); return true; }
      vw.remove(); return true;
    }
    const p = document.getElementById("auszug");
    const kinder = [...p.childNodes];
    if (kinder.length <= 1 && (p.textContent || "").length < 120) return false;
    /* Der letzte Satz endet im letzten Knoten; der ganze Knoten geht weg,
       wenn er nur noch einen Satz trägt. */
    const letzter = kinder[kinder.length - 1];
    const inhalt = letzter.textContent || "";
    const saetze = inhalt.split(/(?<=[.!?])\\s+/).filter(Boolean);
    if (saetze.length > 1){
      const rest = saetze.slice(0, -1).join(" ");
      if (letzter.nodeType === 3) letzter.textContent = rest; else letzter.textContent = rest;
      return true;
    }
    if (kinder.length <= 1) return false;
    letzter.remove();
    /* Trennzeichen zwischen zwei Spannen nicht stehen lassen. */
    const neuLetzter = p.childNodes[p.childNodes.length - 1];
    if (neuLetzter && neuLetzter.nodeType === 3 && !/\\S/.test(neuLetzter.textContent)) neuLetzter.remove();
    return true;
  };
</script>
</body></html>`;
}

/* ── Lauf ──────────────────────────────────────────────────────────────── */
const index = JSON.parse(await readFile(path.join(WURZEL, "beitraege/index.json"), "utf8"));
let auswahl = index.beitraege;
if (nurId && nurId !== true) auswahl = auswahl.filter((b) => b.id === String(nurId));
if (!alle && !nurId) {
  const gefiltert = [];
  for (const b of auswahl) if (!(await da(path.join(WURZEL, b.bild)))) gefiltert.push(b);
  auswahl = gefiltert;
}
if (!auswahl.length) {
  console.log("Kein Bild zu rendern.");
  process.exit(0);
}

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const schriftenUrl = pathToFileURL(path.join(WURZEL, "schriften/schriften.css")).href;
let fehler = 0;

for (const zeile of auswahl) {
  const beitrag = JSON.parse(await readFile(path.join(WURZEL, zeile.datei), "utf8"));
  const kontext = await browser.newContext({
    viewport: { width: BREITE, height: HOEHE },
    deviceScaleFactor: 1,
  });
  const seite = await kontext.newPage();
  await seite.setContent(seiteBauen(beitrag, schriftenUrl), { waitUntil: "load" });
  await seite.evaluate(() => document.fonts.ready);

  const gekuerzt = await passendKuerzen(seite);
  if (gekuerzt === -1) {
    console.error(`  ${beitrag.id}: passt auch nach 40 Kürzungen nicht — Bild übersprungen.`);
    fehler++;
    await kontext.close();
    continue;
  }

  const ziel = path.join(WURZEL, beitrag.bild);
  await mkdir(path.dirname(ziel), { recursive: true });
  const bild = await seite.screenshot({ type: "jpeg", quality: 92 });
  await writeFile(ziel, bild);
  console.log(`${beitrag.bild} — ${(bild.length / 1024).toFixed(0)} kB`
    + (gekuerzt ? `, ${gekuerzt}× gekürzt` : ""));
  await kontext.close();
}

await browser.close();
process.exit(fehler ? 1 : 0);
