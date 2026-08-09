#!/usr/bin/env node
/**
 * browser-pruefen.mjs — prüft die Seite in einem echten Browser.
 *
 * `frontend-pruefen.mjs` läuft in jsdom und sieht deshalb kein Layout. Genau
 * dort saß der schwerste Fehler dieser Fassung: `text-wrap:pretty` brachte den
 * Renderer von Chromium zum Absturz, sobald ein Absatz viele ineinander­
 * greifende Markierungen enthielt. Betroffen waren unter anderem § 1 EStG,
 * § 3 SolzG und § 4 UStG — weiße Seite statt Normtext, in jsdom unsichtbar,
 * weil dort nichts gesetzt wird.
 *
 * Geprüft werden deshalb drei Dinge, die nur ein Browser beantworten kann:
 * dass keine Norm den Renderer abstürzen lässt, dass die Spalten bündig
 * stehen, und dass die Seite ohne Netz weiterarbeitet.
 *
 *   npm install --no-save playwright
 *   python3 -m http.server 8123 &
 *   node tools/browser-pruefen.mjs [http://localhost:8123]
 */

import { chromium } from "playwright";

const WURZEL = process.argv[2] || "http://localhost:8123";

/* Eine Auswahl über alle Gesetze, mit den Normen, die zuvor abstürzten. */
const PROBEN = [
  "/", "#/estg/1", "#/estg/15", "#/solzg/3", "#/ustg/4", "#/ao/1",
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

/* ── 1. Kein Absturz, und der Normtext steht wirklich da ── */
let abgestuerzt = 0;
let leer = 0;
for (const ziel of PROBEN) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const seite = await ctx.newPage();
  let krachte = false;
  seite.on("crash", () => { krachte = true; });
  try {
    await seite.goto(WURZEL + "/" + ziel, { waitUntil: "domcontentloaded", timeout: 20000 });
    await seite.waitForTimeout(1800);
    const marken = (await seite.$$("#haupt mark")).length;
    const ueberschrift = (await seite.textContent("h1")) || "";
    if (!ueberschrift.trim()) leer++;
    if (!marken && !ueberschrift.trim()) leer++;
  } catch (fehler) {
    krachte = true;
  }
  if (krachte) { abgestuerzt++; console.log(`     ✗ ${ziel} — Renderer abgestürzt`); }
  await ctx.close();
}
ok("Keine Norm bringt den Renderer zum Absturz", abgestuerzt === 0, `${PROBEN.length} Proben`);
ok("Jede Probe zeigt ihren Normkopf", leer === 0);

/* ── 2. Die Spalten stehen bündig ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/estg/15", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1200);
  const kanten = await seite.evaluate(() => {
    const links = (wahl) => {
      const knoten = document.querySelector(wahl);
      return knoten ? Math.round(knoten.getBoundingClientRect().left) : null;
    };
    return {
      h1: links("h1"),
      text: links("#haupt .text"),
      werkzeuge: links(".werkzeuge button"),
      status: links(".plakette"),
    };
  });
  const werte = Object.values(kanten).filter((x) => x !== null);
  const bündig = werte.length >= 3 && Math.max(...werte) - Math.min(...werte) <= 2;
  ok("Überschrift, Text und Werkzeuge stehen bündig", bündig, JSON.stringify(kanten));

  /* Waagerechtes Überlaufen der Seite ist immer ein Layoutfehler. */
  const ueberlauf = await seite.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok("Kein waagerechter Überlauf (1600 px)", !ueberlauf);
  await ctx.close();
}

/* ── 3. Dunkelmodus färbt die Kopfleiste mit ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/estg/15", { waitUntil: "networkidle" });
  await seite.waitForTimeout(900);
  const dunkel = await seite.evaluate(() => {
    const farbe = getComputedStyle(document.querySelector("header")).backgroundColor;
    const [r, g, b] = (farbe.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
    return { farbe, hell: (r + g + b) / 3 };
  });
  ok("Kopfleiste folgt dem Dunkelmodus", dunkel.hell < 90, dunkel.farbe);

  const ueberlauf = await seite.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok("Kein waagerechter Überlauf (dunkel)", !ueberlauf);
  await ctx.close();
}

/* ── 4. Schmales Fenster ── */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/estg/15", { waitUntil: "networkidle" });
  await seite.waitForTimeout(900);
  const ueberlauf = await seite.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok("Kein waagerechter Überlauf (390 px)", !ueberlauf);
  ok("Fußleiste sichtbar", await seite.isVisible(".fussleiste"));
  await ctx.close();
}

/* ── 5. Ohne Netz ── */
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
  await seite.waitForTimeout(2200);
  const kopf = (await seite.textContent("h1").catch(() => "")) || "";
  ok("Ohne Netz erscheint die gelesene Norm", kopf.includes("§ 2"), kopf.trim());
  ok("Ohne Netz kein Fehlerkasten", !(await seite.$(".melder")));
  ok("Ohne Netz sind die Markierungen da", (await seite.$$("#haupt mark")).length > 0);
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
