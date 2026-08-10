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

/* ── 4b. Struktur-Einfärbung sitzt an der richtigen Stelle ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);

  const farben = await seite.evaluate(() => {
    const s = [...document.querySelectorAll(".lesespalte .s")];
    const finde = (klasse) => s.filter((x) => x.classList.contains(klasse)).map((x) => x.textContent);
    return {
      anzahl: s.length,
      rf: finde("s-rechtsfolge").slice(0, 1),
      au: finde("s-ausnahme").slice(0, 1),
      tb: finde("s-tatbestand").slice(0, 1),
      legende: (document.querySelector(".legende") || {}).textContent || "",
    };
  });
  // Die Zuordnung des Entwurfs für § 3 Abs. 1 SolzG: „bemisst sich“ =
  // Rechtsfolge, „vorbehaltlich der Absätze 2 bis 5“ = Ausnahme.
  ok("Einfärbung vorhanden", farben.anzahl > 20, farben.anzahl + " Spannen");
  ok("„bemisst sich“ ist Rechtsfolge", farben.rf[0] === "bemisst sich", String(farben.rf[0]));
  ok("„vorbehaltlich …“ ist Ausnahme",
    farben.au[0] === "vorbehaltlich der Absätze 2 bis 5", String(farben.au[0]));
  ok("„soweit …“ ist Tatbestand",
    String(farben.tb[0]).startsWith("soweit eine Veranlagung"), String(farben.tb[0]).slice(0, 32));
  ok("Legende erklärt die drei Kategorien",
    farben.legende.includes("Tatbestand") && farben.legende.includes("Rechtsfolge")
    && farben.legende.includes("Ausnahme / Vorbehalt"));
  ok("Legende weist die Maschine aus",
    farben.legende.includes("maschinell erkannt, nicht redaktionell geprüft"));

  /* Stufe „aus“ nimmt jede Tönung zurück. */
  await seite.click('.stufen button[data-stufe=aus]');
  await seite.waitForTimeout(500);
  const ausgeschaltet = await seite.evaluate(() => {
    const s = document.querySelector(".lesespalte .s");
    const grund = s ? getComputedStyle(s).backgroundColor : "";
    return { modus: document.body.dataset.struktur, grund,
      hinweis: (document.querySelector(".legende .anmerkung") || {}).textContent || "" };
  });
  ok("Stufe „aus“ nimmt die Tönung zurück",
    ausgeschaltet.modus === "aus" && /rgba\(0, 0, 0, 0\)|transparent/.test(ausgeschaltet.grund),
    ausgeschaltet.grund);
  ok("Stufe „aus“ sagt es auch",
    ausgeschaltet.hinweis.includes("reiner Wortlaut"), ausgeschaltet.hinweis);
  await ctx.close();
}

/* ── 4c. Eigene Markierungen ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);

  /* Auswählen wie beim Lesen: über eine bekannte Wendung. */
  await seite.evaluate(() => {
    const treffer = [...document.querySelectorAll(".lesespalte span")]
      .find((x) => x.textContent.trim() === "bemisst sich");
    const r = document.createRange();
    r.selectNodeContents(treffer);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await seite.waitForTimeout(400);
  ok("Werkzeugleiste erscheint bei Auswahl", await seite.isVisible(".auswahlleiste.offen"));

  await seite.click(".auswahlleiste .farbkreis:nth-child(3)");
  await seite.waitForTimeout(700);

  const nachher = await seite.evaluate(() => {
    const marke = document.querySelector(".lesespalte .eigen");
    return {
      wortlaut: marke ? marke.textContent : null,
      stil: marke ? marke.getAttribute("style") : "",
      // Liegt die Markierung ÜBER der Struktur, ohne sie zu löschen?
      beideEbenen: Boolean(document.querySelector(".lesespalte .eigen.s")),
      register: [...document.querySelectorAll(".register button")]
        .find((b) => b.getAttribute("aria-selected") === "true").textContent,
      karten: document.querySelectorAll(".apparat .karte").length,
      fundstelle: (document.querySelector(".apparat .karte-fundstelle") || {}).textContent,
      fuss: (document.querySelector(".apparat .haftung") || {}).textContent || "",
    };
  });
  ok("Markierung sitzt auf der Auswahl", nachher.wortlaut === "bemisst sich", String(nachher.wortlaut));
  ok("Marker mit farbiger Unterkante",
    /border-bottom:2px solid #3B7BD1/i.test(nachher.stil), nachher.stil);
  ok("Struktur bleibt unter der Markierung erhalten", nachher.beideEbenen);
  ok("Klick öffnet das Register „Markierungen“", nachher.register === "Markierungen", nachher.register);
  ok("Karte im Register angelegt", nachher.karten === 1, String(nachher.karten));
  ok("Fundstelle aus struktur/", nachher.fundstelle === "Abs. 1 Satz 1", String(nachher.fundstelle));
  ok("Fuß sagt, wo die Markierungen liegen",
    nachher.fuss.includes("nur in diesem Browser"));

  /* Der Klick auf einen Farbkreis darf die Karte nicht schließen. */
  await seite.click(".apparat .karte .farbkreis:nth-child(2)");
  await seite.waitForTimeout(500);
  const nachFarbwechsel = await seite.evaluate(() => ({
    offen: Boolean(document.querySelector(".apparat .karte.aktiv")),
    farbe: (document.querySelector(".apparat .hexwert") || {}).textContent,
  }));
  ok("Farbwechsel schließt die Karte nicht", nachFarbwechsel.offen);
  ok("Farbe übernommen", nachFarbwechsel.farbe === "#4E9A5F", String(nachFarbwechsel.farbe));

  /* Markierungen überdauern den Neuaufbau der Seite. */
  await seite.reload({ waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);
  ok("Markierung überdauert den Seitenaufbau",
    Boolean(await seite.$(".lesespalte .eigen")));

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
