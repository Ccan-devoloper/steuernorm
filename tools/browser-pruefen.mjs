#!/usr/bin/env node
/**
 * browser-pruefen.mjs — prüft die Oberfläche in einem echten Browser.
 *
 * jsdom berechnet kein Layout. Genau dort saß der schwerste Fehler der
 * vorigen Fassung: `text-wrap:pretty` brachte den Renderer von Chromium zum
 * Absturz, sobald ein Absatz viele ineinandergreifende Markierungen enthielt —
 * weiße Seite statt Normtext, in jsdom unsichtbar. Diese Prüfung fragt
 * deshalb, was nur ein Browser beantworten kann: Stürzt eine Norm ab? Stimmen
 * die Spaltenmaße? Läuft etwas waagerecht über? Arbeitet die Seite ohne Netz?
 *
 *   npm install --no-save playwright
 *   python3 -m http.server 8123 &
 *   node tools/browser-pruefen.mjs [http://localhost:8123]
 */

import { chromium } from "playwright";

const WURZEL = process.argv[2] || "http://localhost:8123";

/* Eine Auswahl über alle Gesetze, mit den Normen, die früher abstürzten. */
const PROBEN = [
  "/", "#/solzg/3", "#/estg/1", "#/estg/15", "#/ustg/4", "#/ao/1",
  "#/astg/2", "#/fgo/1", "#/bewg/1", "#/kstg/1", "#/erbstg/1", "#/gewstg/1",
];

const pruef = [];
const ok = (name, bedingung, zusatz = "") => pruef.push({ name, bestanden: Boolean(bedingung), zusatz });

/* In dieser Umgebung liegt Chromium unter PLAYWRIGHT_BROWSERS_PATH; ohne
   ausdrücklichen Pfad sucht Playwright die headless-shell-Variante, die nicht
   mitgeliefert ist. CHROMIUM_PFAD überschreibt beides. */
const CHROMIUM = process.env.CHROMIUM_PFAD
  || (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const ueberlauf = (seite) => seite.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

/* ── 1. Kein Absturz, und der Normtext steht wirklich da ── */
{
  let abgestuerzt = 0;
  let leer = 0;
  for (const ziel of PROBEN) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const seite = await ctx.newPage();
    let krachte = false;
    seite.on("crash", () => { krachte = true; });
    try {
      await seite.goto(WURZEL + "/" + ziel, { waitUntil: "domcontentloaded", timeout: 20000 });
      await seite.waitForTimeout(1500);
      const kopf = (await seite.textContent("h1")) || "";
      const text = (await seite.textContent(".lesespalte")) || "";
      if (!kopf.trim() || text.trim().length < 20) leer++;
    } catch (fehler) {
      krachte = true;
    }
    if (krachte) { abgestuerzt++; console.log(`     ✗ ${ziel} — Renderer abgestürzt`); }
    await ctx.close();
  }
  ok("Keine Norm bringt den Renderer zum Absturz", abgestuerzt === 0, `${PROBEN.length} Proben`);
  ok("Jede Probe zeigt Normkopf und Wortlaut", leer === 0);
}

/* ── 2. Das Grundraster hält die Maße der Spezifikation ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1200);

  const mass = await seite.evaluate(() => {
    const breite = (wahl) => {
      const knoten = document.querySelector(wahl);
      return knoten ? Math.round(knoten.getBoundingClientRect().width) : null;
    };
    return { nav: breite(".navspalte"), apparat: breite(".apparat"), lese: breite(".lesespalte") };
  });
  ok("Linke Spalte 216 px", mass.nav === 216, String(mass.nav));
  ok("Apparat 340 px", mass.apparat === 340, String(mass.apparat));
  ok("Lesespalte 36 rem (576 px)", mass.lese === 576, String(mass.lese));
  ok("Kein waagerechter Überlauf (1440 px)", !(await ueberlauf(seite)));
  await ctx.close();
}

/* ── 3. Die Daten stammen aus data/, nicht aus dem Entwurf ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1200);

  const daten = await seite.evaluate(() => ({
    etikett: (document.querySelector(".navspalte .mono-etikett") || {}).textContent,
    normen: document.querySelectorAll(".normzeile").length,
    rinne: [...document.querySelectorAll(".rinne button")].map((b) => b.textContent).join(" "),
    h1: (document.querySelector("h1") || {}).textContent,
  }));
  // SolzG hat ausweislich data/index.json genau sechs Normen; § 3 hat die
  // Absätze (1) (2) (2a) (3) (4) (4a) (5). Beides wird nicht gesetzt, sondern
  // aus den Daten gelesen — diese Prüfung hält das fest.
  ok("Normenzahl aus den Daten", daten.etikett === "SolzG · 6 Normen", daten.etikett);
  ok("Sechs Normzeilen", daten.normen === 6, String(daten.normen));
  ok("Absatzrinne aus den Daten", daten.rinne === "(1) (2) (2a) (3) (4) (4a) (5)", daten.rinne);
  ok("Überschrift aus den Daten", (daten.h1 || "").includes("Bemessungsgrundlage"), daten.h1);
  await ctx.close();
}

/* ── 4. Kein eingefügtes Wort im Normtext ──
   Die Zuordnung erklärt allein die Legende. Tauchen „Tatbestand“ oder
   „Rechtsfolge“ im Wortlaut auf, ist etwas hineingeschrieben worden. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1200);
  const wortlaut = (await seite.textContent(".lesespalte")) || "";
  ok("Keine Kategorienamen im Wortlaut",
    !/\b(Tatbestand|Rechtsfolge)\b/.test(wortlaut));
  ok("Wortlaut beginnt wie im Gesetz",
    wortlaut.trim().startsWith("Der Solidaritätszuschlag bemisst sich"),
    wortlaut.trim().slice(0, 46));
  await ctx.close();
}

/* ── 5. Die drei Stufen des Rasters ── */
for (const [name, breite, hoehe] of [["1200 px", 1200, 900], ["1024 px", 1024, 860], ["390 px", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: breite, height: hoehe } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1000);
  ok(`Kein waagerechter Überlauf (${name})`, !(await ueberlauf(seite)));
  await ctx.close();
}

/* ── 6. Ohne Netz ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/astg/2", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1800);
  const bereit = await seite.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => Boolean(r.active)).catch(() => false));
  ok("Service Worker aktiv", bereit);

  await ctx.setOffline(true);
  await seite.goto(WURZEL + "/#/astg/2", { waitUntil: "domcontentloaded" });
  await seite.waitForTimeout(2400);
  const kopf = (await seite.textContent("h1").catch(() => "")) || "";
  ok("Ohne Netz erscheint die gelesene Norm", kopf.includes("§ 2"), kopf.trim());
  ok("Ohne Netz kein Fehlerkasten", !(await seite.$(".melder")));
  await ctx.setOffline(false);
  await ctx.close();
}

await browser.close();

console.log("");
let fehler = 0;
for (const p of pruef) {
  if (!p.bestanden) fehler++;
  console.log(`  ${p.bestanden ? "✓" : "✗"} ${p.name}${p.zusatz ? "  — " + p.zusatz : ""}`);
}
console.log(`\n${pruef.length - fehler}/${pruef.length} bestanden`);
process.exit(fehler ? 1 : 0);
