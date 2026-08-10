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

/* Eine Auswahl über alle Gesetze, mit den Normen, die früher abstürzten.
   Dazu die drei Ansichten ohne Normtext — sie tragen keine `.lesespalte`. */
const PROBEN = [
  "#/solzg/3", "#/estg/1", "#/estg/15", "#/ustg/4", "#/ao/1",
  "#/astg/2", "#/fgo/1", "#/bewg/1", "#/kstg/1", "#/erbstg/1", "#/gewstg/1",
];
const PROBEN_OHNE_TEXT = ["/", "#/solzg", "#/suche/Vorsteuer"];

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
      /* `$eval` würde bei fehlendem Knoten werfen und einen Absturz vortäuschen. */
      const inhalt = await seite.evaluate(() => ({
        kopf: (document.querySelector("h1") || {}).textContent || "",
        text: (document.querySelector(".lesespalte") || {}).textContent || "",
      }));
      if (!inhalt.kopf.trim() || inhalt.text.trim().length < 20) leer++;
    } catch (fehler) {
      krachte = true;
    }
    if (krachte) { abgestuerzt++; console.log(`     ✗ ${ziel} — Renderer abgestürzt`); }
    await ctx.close();
  }
  ok("Keine Norm bringt den Renderer zum Absturz", abgestuerzt === 0, `${PROBEN.length} Proben`);
  ok("Jede Probe zeigt Normkopf und Wortlaut", leer === 0);

  /* Die Ansichten ohne Normtext: Startseite, Gesetzesübersicht, Trefferliste. */
  let ohneKopf = 0;
  for (const ziel of PROBEN_OHNE_TEXT) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const seite = await ctx.newPage();
    let krachte = false;
    seite.on("crash", () => { krachte = true; });
    try {
      await seite.goto(WURZEL + "/" + ziel, { waitUntil: "domcontentloaded", timeout: 20000 });
      await seite.waitForTimeout(1400);
      const kopf = await seite.evaluate(() => (document.querySelector("h1") || {}).textContent || "");
      if (!kopf.trim()) ohneKopf++;
    } catch (fehler) { krachte = true; }
    if (krachte) { abgestuerzt++; console.log(`     ✗ ${ziel} — Renderer abgestürzt`); }
    await ctx.close();
  }
  ok("Startseite, Übersicht und Trefferliste tragen eine Überschrift", ohneKopf === 0);
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

/* ── 4d. Verwaltungsstellen ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1500);

  const imText = await seite.evaluate(() => ({
    punktlinien: [...document.querySelectorAll(".lesespalte .vw")].map((x) => x.textContent),
    chips: [...document.querySelectorAll(".lesespalte .vw-chip")].map((x) => x.textContent),
    // Der Chip darf nicht in die Zwischenablage geraten.
    chipAuswahl: getComputedStyle(document.querySelector(".lesespalte .vw-chip")).userSelect,
    stil: getComputedStyle(document.querySelector(".lesespalte .vw")).borderBottomStyle,
  }));
  ok("Verwaltungsstellen im Text verankert",
    imText.punktlinien.length === 2, imText.punktlinien.join(" · "));
  ok("Fundstellen-Chips gesetzt", imText.chips.join(" · ") === "R 39b.2 · BMF 2021", imText.chips.join(" · "));
  ok("Punktlinie als Kodierung", imText.stil === "dotted", imText.stil);
  ok("Chip bleibt aus der Zwischenablage", imText.chipAuswahl === "none", imText.chipAuswahl);

  await seite.click(".lesespalte .vw-chip");
  await seite.waitForTimeout(700);
  const nachher = await seite.evaluate(() => ({
    register: [...document.querySelectorAll(".register button")]
      .find((b) => b.getAttribute("aria-selected") === "true").textContent,
    karten: document.querySelectorAll(".apparat .vw-karte").length,
    aktiv: Boolean(document.querySelector(".apparat .vw-karte.aktiv")),
    warnung: (document.querySelector(".apparat .fehlmeldung .mono-etikett") || {}).textContent,
    beleg: (document.querySelector(".apparat .vw-beleg") || {}).textContent,
  }));
  ok("Chip öffnet das Register „Verwaltung“", nachher.register === "Verwaltung", nachher.register);
  ok("Beide Stellen als Karten", nachher.karten === 2, String(nachher.karten));
  ok("Angeklickte Karte ist hervorgehoben", nachher.aktiv);
  ok("Beispieldatensatz sagt es von sich aus",
    nachher.warnung === "Beispieldatensatz", String(nachher.warnung));
  ok("Belegnachweis vorhanden",
    nachher.beleg === "Lohnsteuer-Richtlinien 2023", String(nachher.beleg));
  await ctx.close();
}

/* ── 4e. Ein Gesetz ohne Verwaltungsdatensatz degradiert sauber ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/astg/2", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);
  await seite.click('.register button:nth-child(3)');
  await seite.waitForTimeout(400);
  const ohne = await seite.evaluate(() => ({
    text: (document.querySelector(".apparat .registerinhalt") || {}).textContent || "",
    punktlinien: document.querySelectorAll(".lesespalte .vw").length,
  }));
  ok("Ohne Datensatz sagt das Register es",
    ohne.text.includes("keine Zuordnung von Verwaltungsanweisungen"), ohne.text.slice(0, 60));
  ok("Ohne Datensatz keine Punktlinien", ohne.punktlinien === 0);
  await ctx.close();
}

/* ── 4f. Die Mappe ──
   Geprüft wird, was jsdom nicht sieht: dass das Feld überhaupt sichtbar wird,
   am Knopf hängt, beim Klick daneben wieder zugeht — und dass eine markierte
   Stelle den Neustart in der Mappe übersteht. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);

  ok("Mappenknopf nicht mehr gesperrt", !(await seite.isDisabled("#knopf-mappe")));

  await seite.click("#knopf-mappe");
  await seite.waitForTimeout(400);
  const auf = await seite.evaluate(() => {
    const feld = document.getElementById("mappe");
    const knopf = document.getElementById("knopf-mappe");
    const fk = feld.getBoundingClientRect();
    const kk = knopf.getBoundingClientRect();
    return {
      sichtbar: getComputedStyle(feld).display !== "none",
      breite: Math.round(fk.width),
      unterDemKnopf: fk.top > kk.bottom && fk.top - kk.bottom < 20,
      rechtsbuendig: Math.abs(fk.right - kk.right) < 20,
      angesagt: knopf.getAttribute("aria-expanded"),
      zeilen: document.querySelectorAll(".mappe-zeile").length,
      fuss: (document.querySelector(".mappe-fuss") || {}).textContent || "",
    };
  });
  ok("Mappe wird sichtbar", auf.sichtbar);
  ok("Mappe ist 392 px breit", auf.breite === 392, String(auf.breite));
  ok("Mappe hängt unter ihrem Knopf", auf.unterDemKnopf && auf.rechtsbuendig, JSON.stringify(auf));
  ok("Zustand für Vorleseprogramme angesagt", auf.angesagt === "true", String(auf.angesagt));
  ok("Mindestens eine Mappe angelegt", auf.zeilen >= 1, String(auf.zeilen));
  ok("Fuß sagt, wo die Mappen liegen", auf.fuss.includes("nur in diesem Browser"));

  /* Norm hineinlegen. */
  await seite.click(".mappe-knoepfe button:nth-child(1)");
  await seite.waitForTimeout(400);
  const mitNorm = await seite.evaluate(() => ({
    eintraege: document.querySelectorAll(".mappe-eintrag").length,
    stelle: (document.querySelector(".mappe-eintrag-stelle") || {}).textContent || "",
    art: (document.querySelector(".mappe-eintrag-art") || {}).textContent || "",
  }));
  ok("Norm landet in der Mappe", mitNorm.eintraege === 1, String(mitNorm.eintraege));
  ok("Eintrag trägt die echte Fundstelle",
    mitNorm.stelle === "§ 3 SolzG" && mitNorm.art === "Norm", mitNorm.stelle + " · " + mitNorm.art);

  /* Klick daneben schließt. */
  await seite.click(".lesespalte", { position: { x: 5, y: 5 } });
  await seite.waitForTimeout(300);
  ok("Klick daneben schließt die Mappe",
    !(await seite.evaluate(() => document.getElementById("mappe").classList.contains("offen"))));

  /* Eine Markierung anlegen — sie muss von selbst in der Mappe landen. */
  await seite.evaluate(() => {
    const satz = document.querySelector(".lesespalte .s");
    const bereich = document.createRange();
    bereich.selectNodeContents(satz);
    const auswahl = window.getSelection();
    auswahl.removeAllRanges();
    auswahl.addRange(bereich);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await seite.waitForTimeout(400);
  await seite.click(".auswahlleiste .farbkreis:nth-child(2)");
  await seite.waitForTimeout(600);

  await seite.click("#knopf-mappe");
  await seite.waitForTimeout(400);
  const mitMarkierung = await seite.evaluate(() => ({
    eintraege: document.querySelectorAll(".mappe-eintrag").length,
    arten: [...document.querySelectorAll(".mappe-eintrag-art")].map((x) => x.textContent),
  }));
  ok("Markierung landet von selbst in der Mappe",
    mitMarkierung.eintraege === 2 && mitMarkierung.arten.includes("Markierung"),
    mitMarkierung.arten.join(" · "));

  /* Neustart: Mappen liegen im Browserspeicher. */
  await seite.reload({ waitUntil: "networkidle" });
  await seite.waitForTimeout(1600);
  await seite.click("#knopf-mappe");
  await seite.waitForTimeout(400);
  ok("Mappe übersteht den Neustart",
    (await seite.evaluate(() => document.querySelectorAll(".mappe-eintrag").length)) === 2);

  /* Esc schließt. */
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(300);
  ok("Esc schließt die Mappe",
    !(await seite.evaluate(() => document.getElementById("mappe").classList.contains("offen"))));
  ok("Kein waagerechter Überlauf mit offener Mappe", !(await ueberlauf(seite)));
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

/* ── 5b. Mobil: der Apparat als Blatt ── */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);

  const zu = await seite.evaluate(() => ({
    griff: (document.querySelector(".blattgriff") || {}).textContent || "",
    werkzeuge: [...document.querySelectorAll(".werkzeugleiste button")].map((b) => b.textContent),
    rinne: getComputedStyle(document.querySelector(".rinne")).flexDirection,
  }));
  ok("Blattgriff nennt den Inhalt", zu.griff.includes("Apparat"), zu.griff.trim());
  /* Vier Schalter: Einfärben, Apparat, Mappe, Gesetze. Die Mappe muss dabei
     sein — die Kopfzeile der Knöpfe ist auf dem Telefon ausgeblendet, die
     Leiste ist dort der einzige Weg dorthin. */
  ok("Werkzeugleiste am Fuß", zu.werkzeuge.length === 4, zu.werkzeuge.join(" · "));
  ok("Mappe von der Werkzeugleiste erreichbar", zu.werkzeuge.includes("Mappe"));
  ok("Absatzmarken laufen waagerecht", zu.rinne === "row", zu.rinne);

  await seite.click(".blattgriff");
  await seite.waitForTimeout(700);
  const offen = await seite.evaluate(() => {
    const kasten = document.querySelector(".apparat").getBoundingClientRect();
    return {
      zustand: document.body.dataset.blatt,
      oben: Math.round(kasten.top),
      hoehe: Math.round(kasten.height),
      festgehalten: getComputedStyle(document.body).overflow,
      register: document.querySelectorAll(".apparat .register button").length,
    };
  });
  ok("Blatt fährt hoch", offen.zustand === "offen" && offen.oben > 100, JSON.stringify(offen));
  ok("Blatt ist rund 78 % hoch", Math.abs(offen.hoehe - 844 * 0.78) < 12, String(offen.hoehe));
  ok("Text dahinter wird festgehalten", offen.festgehalten === "hidden", offen.festgehalten);
  ok("Register im Blatt erreichbar", offen.register === 5, String(offen.register));

  /* Die Mappe ist auf dem Telefon ebenfalls ein Blatt von unten — 392 px
     hängen an keinem Telefonrand. */
  await seite.keyboard.press("Escape");
  await seite.waitForTimeout(400);
  await seite.click("#leiste-mappe");
  await seite.waitForTimeout(500);
  const mappeMobil = await seite.evaluate(() => {
    const feld = document.getElementById("mappe");
    const k = feld.getBoundingClientRect();
    return {
      lage: getComputedStyle(feld).position,
      links: Math.round(k.left),
      breite: Math.round(k.width),
      amBoden: Math.round(window.innerHeight - k.bottom),
      schleier: getComputedStyle(document.querySelector(".verdunkelung")).display,
    };
  });
  ok("Mappe auf Mobil als Blatt", mappeMobil.lage === "fixed" && mappeMobil.links === 0,
    JSON.stringify(mappeMobil));
  ok("Mappe füllt die Breite", mappeMobil.breite === 390, String(mappeMobil.breite));
  ok("Mappe sitzt am unteren Rand", mappeMobil.amBoden === 0, String(mappeMobil.amBoden));
  ok("Schleier hinter der Mappe", mappeMobil.schleier === "block", mappeMobil.schleier);
  ok("Kein waagerechter Überlauf mit offener Mappe (390 px)", !(await ueberlauf(seite)));
  await ctx.close();
}

/* ── 5c. Druckfassung ── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1400);
  await seite.emulateMedia({ media: "print" });
  await seite.waitForTimeout(400);

  const druck = await seite.evaluate(() => {
    const sichtbar = (wahl) => {
      const k = document.querySelector(wahl);
      if (!k) return false;
      const stil = getComputedStyle(k);
      return stil.display !== "none" && stil.visibility !== "hidden";
    };
    const s = document.querySelector(".lesespalte .s");
    return {
      kopfleiste: sichtbar("header"),
      navspalte: sichtbar(".navspalte"),
      legende: sichtbar(".legende"),
      druckkopf: sichtbar(".druckkopf"),
      druckfuss: sichtbar(".druckfuss"),
      apparat: sichtbar(".apparat"),
      strukturGrund: s ? getComputedStyle(s).backgroundColor : "",
      fussText: (document.querySelector(".druckfuss") || {}).textContent || "",
      haftung: (document.querySelector(".apparat .haftung") || {}).textContent || "",
    };
  });
  ok("Druck ohne Kopfleiste", !druck.kopfleiste);
  ok("Druck ohne Normenverzeichnis", !druck.navspalte);
  ok("Druck ohne Legende", !druck.legende);
  ok("Druckkopf erscheint", druck.druckkopf);
  ok("Druckfuß erscheint", druck.druckfuss);
  ok("Apparat wird zum Fußapparat", druck.apparat);
  ok("Struktur-Einfärbung wird nicht gedruckt",
    /rgba\(0, 0, 0, 0\)|transparent/.test(druck.strukturGrund), druck.strukturGrund);
  ok("Druckfuß nennt Quelle und Vorbehalt",
    druck.fussText.includes("Gesetze im Internet") && druck.fussText.includes("Bundesgesetzblatt"));
  ok("Haftungssatz auch im Druck", druck.haftung.includes("keine Rechtsberatung"));
  await seite.emulateMedia({ media: "screen" });
  await ctx.close();
}

/* ── 5d. Dunkelmodus ──
   Die Spezifikation verlangt beide Paletten als Variablen, den Dreischalter,
   `prefers-color-scheme` als Voreinstellung und eine immer helle Druckfassung.
   Und sie warnt vor festen Hellwerten, die den Moduswechsel überstehen —
   genau daran ist der Bestand gescheitert. */
{
  const graustufe = (farbe) => {
    const [r, g, b] = (String(farbe).match(/[\d.]+/g) || [255, 255, 255]).map(Number);
    return (r + g + b) / 3;
  };
  /* Relative Leuchtdichte nach WCAG, für den Kontrastwert. */
  const leuchte = (farbe) => {
    const [r, g, b] = (String(farbe).match(/[\d.]+/g) || [0, 0, 0]).map(Number)
      .map((x) => { const k = x / 255; return k <= 0.03928 ? k / 12.92 : ((k + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const kontrast = (a, b) => {
    const [h, d] = [leuchte(a), leuchte(b)].sort((x, y) => y - x);
    return (h + 0.05) / (d + 0.05);
  };

  /* Systemvorgabe dunkel, ohne ausdrückliche Wahl. */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: "dark" });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1500);

  const dunkel = await seite.evaluate(() => {
    const g = (wahl, eigenschaft) => getComputedStyle(document.querySelector(wahl))[eigenschaft];
    return {
      kopf: g("header .kopf", "backgroundColor"),
      papier: g("body", "backgroundColor"),
      text: g(".lesespalte", "color"),
      tb: g(".lesespalte .s-tatbestand", "backgroundColor"),
      rf: g(".lesespalte .s-rechtsfolge", "backgroundColor"),
      au: g(".lesespalte .s-ausnahme", "backgroundColor"),
      deckkraft: getComputedStyle(document.documentElement).getPropertyValue("--eigen-deckkraft").trim(),
      gewaehlt: [...document.querySelectorAll("#darstellung button")]
        .find((b) => b.getAttribute("aria-checked") === "true").textContent,
    };
  });
  ok("Systemvorgabe dunkel greift", graustufe(dunkel.papier) < 40, dunkel.papier);
  ok("Kopfleiste folgt dem Dunkelmodus", graustufe(dunkel.kopf) < 50, dunkel.kopf);
  ok("Schalter steht auf System", dunkel.gewaehlt === "System", dunkel.gewaehlt);
  ok("Marker-Deckkraft sinkt auf .22", dunkel.deckkraft === ".22", dunkel.deckkraft);

  /* Die Spezifikation fordert 7:1 für Normtext über den „voll“-Tönen. */
  for (const [name, ton] of [["Tatbestand", dunkel.tb], ["Rechtsfolge", dunkel.rf], ["Ausnahme", dunkel.au]]) {
    const wert = kontrast(dunkel.text, ton);
    ok(`Kontrast über ${name} hält 7:1 (dunkel)`, wert >= 7, wert.toFixed(1) + ":1");
  }

  /* Die ausdrückliche Wahl schlägt die Systemvorgabe — in beide Richtungen. */
  await seite.click('#darstellung button[data-modus=hell]');
  await seite.waitForTimeout(500);
  const erzwungenHell = await seite.evaluate(() => ({
    papier: getComputedStyle(document.body).backgroundColor,
    kopf: getComputedStyle(document.querySelector("header .kopf")).backgroundColor,
    merker: localStorage.getItem("sn.darstellung"),
  }));
  ok("Wahl „hell“ schlägt die dunkle Systemvorgabe",
    graustufe(erzwungenHell.papier) > 200 && graustufe(erzwungenHell.kopf) > 200,
    erzwungenHell.papier + " / " + erzwungenHell.kopf);
  ok("Wahl wird gemerkt", erzwungenHell.merker === '"hell"', String(erzwungenHell.merker));

  /* Die Druckfassung ist immer hell — auch bei ausdrücklicher Wahl „dunkel“. */
  await seite.click('#darstellung button[data-modus=dunkel]');
  await seite.waitForTimeout(400);
  await seite.emulateMedia({ media: "print" });
  await seite.waitForTimeout(400);
  const druck = await seite.evaluate(() => ({
    text: getComputedStyle(document.querySelector(".lesespalte")).color,
    papier: getComputedStyle(document.documentElement).getPropertyValue("--papier").trim(),
  }));
  ok("Druck bleibt hell trotz Wahl „dunkel“",
    graustufe(druck.text) < 60 && druck.papier === "#FCFCFC",
    druck.text + " auf " + druck.papier);
  await seite.emulateMedia({ media: "screen" });
  await ctx.close();
}

/* ── 5e. Keine festen Hellwerte, die den Moduswechsel überstehen ──
   Gemessen wird stumpf: Im Dunkelmodus darf keine sichtbare Fläche der
   Oberfläche hell bleiben. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: "dark" });
  const seite = await ctx.newPage();
  await seite.goto(WURZEL + "/#/solzg/3", { waitUntil: "networkidle" });
  await seite.waitForTimeout(1500);

  const helleFlecken = await seite.evaluate(() => {
    const raus = [];
    for (const knoten of document.querySelectorAll("body *")) {
      const stil = getComputedStyle(knoten);
      if (stil.display === "none" || stil.visibility === "hidden") continue;
      const [r, g, b, a] = (stil.backgroundColor.match(/[\d.]+/g) || []).map(Number);
      if (a === 0 || r === undefined) continue;
      // Eine helle Fläche im Dunkelmodus ist entweder Absicht (aktiver
      // Schalter, invertiert) oder ein vergessener fester Wert.
      if ((r + g + b) / 3 > 200 && knoten.getAttribute("aria-checked") !== "true") {
        raus.push(knoten.tagName + "." + String(knoten.className).slice(0, 30) + " → " + stil.backgroundColor);
      }
    }
    return raus.slice(0, 6);
  });
  ok("Keine vergessene helle Fläche im Dunkelmodus",
    helleFlecken.length === 0, helleFlecken.join(" | "));
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
