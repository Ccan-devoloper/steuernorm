/**
 * ausnahmen.mjs — Erkennung von Ausnahmen, Rückausnahmen und Vorrangregeln.
 *
 * Die bisherige Lösung war ein einziger Ausdruck mit einem `exec`-Aufruf. Eine
 * Messung über den Gesamtbestand zeigte drei Fehler, die zusammen dafür sorgten,
 * dass Ausnahmen die schwächste der vier Kategorien blieben:
 *
 *   1. NUR DIE ERSTE Ausnahme je Rechtssatz wurde gefunden (`exec` ohne Schleife).
 *      In 16 709 Rechtssätzen fanden sich 866 Ausnahmen — rund 5 %. Im Steuerrecht
 *      ist das um ein Vielfaches zu wenig.
 *   2. DIE GRENZEN waren falsch. Die Spanne lief vom letzten Komma vor dem Signal
 *      bis zum NÄCHSTEN Komma. Bei „es sei denn, dass X" ist das nächste Komma
 *      genau das nach „denn" — übrig blieb das nackte Signalwort. Unter den
 *      häufigsten Ausnahmen standen deshalb „ausgenommen" (7×), „entfällt" (5×)
 *      und „ist nicht anzuwenden" (19×): Signalwörter ohne jeden Merkmalsgehalt.
 *   3. VORRANGREGELN GALTEN ALS AUSNAHMEN. „unbeschadet", „vorbehaltlich" und
 *      „ungeachtet" ordnen ein Konkurrenzverhältnis zwischen zwei Normen, sie
 *      nehmen nichts vom Tatbestand aus. Sie erzeugten 467 Überlappungen mit der
 *      Rechtsfolge, in der sie stehen.
 *
 * Dieses Modul unterscheidet stattdessen drei Bauformen der Ausnahme und hält
 * die Vorrangregel ausdrücklich davon getrennt.
 *
 * Deterministisch, kein Modellaufruf, kein Netz.
 */

/* ─────────────────────── Bauform A: Bedingungsausnahme ─────────────────────── */

/**
 * Nachgestellter Ausnahmesatz mit eigener Bedingung. Er reicht bis zum Ende des
 * Rechtssatzes oder bis zum nächsten Semikolon — NICHT bis zum nächsten Komma,
 * denn das steht bei „es sei denn, dass …" mitten im Signal.
 *
 *   „Die Steuer entsteht nicht, ES SEI DENN, DASS der Erwerber die Anzeige erstattet."
 *   „Der Abzug ist zulässig, SOWEIT NICHT § 4 Absatz 5 entgegensteht."
 */
const BEDINGUNG = /\b(es sei denn|außer wenn|außer in den Fällen|außer im Fall(?:e)?|außer für|außer bei|außer in|sofern nicht|soweit nicht|solange nicht|wenn nicht|falls nicht|nicht jedoch|jedoch nicht für|dies gilt nicht für|gilt nicht für|gelten nicht für|es sei)\b/gi;

/* ─────────────────────── Bauform B: Bereichsausnahme ─────────────────────── */

/**
 * Ausnahme innerhalb einer Nominalphrase — sie nimmt einen Gegenstand aus dem
 * Anwendungsbereich heraus und endet mit dieser Nominalphrase.
 *
 *   „Für die Umsatzsteuer MIT AUSNAHME DER EINFUHRUMSATZSTEUER ist …"
 *   „… Kraftfahrzeuge, AUSGENOMMEN TEILE UND ZUBEHÖR, …"
 */
const BEREICH = /\b(mit Ausnahme(?:\s+(?:der|des|von|dem|den))?|hiervon ausgenommen(?:\s+(?:ist|sind))?|davon ausgenommen(?:\s+(?:ist|sind))?|ausgenommen|ausschließlich der|außer(?!\s+(?:Ansatz|Betracht|Kraft|Stande|acht|Acht|dem|den|der|Zweifel))|mit der Maßgabe, dass nicht)\b/gi;

/* ─────────────────────── Bauform C: Satzausnahme ─────────────────────── */

/**
 * Ein ganzer Rechtssatz, dessen einziger Inhalt die Ausnahme ist. Er verweist
 * zurück auf die Regel und hebt sie für bestimmte Fälle auf.
 *
 *   „DIES GILT NICHT, WENN der Steuerpflichtige den Nachweis erbringt."
 *   „SATZ 1 IST NICHT ANZUWENDEN, soweit …"
 *   „ABSATZ 1 FINDET KEINE ANWENDUNG auf Erwerbe von Todes wegen."
 */
const SATZAUSNAHME = /(?:^|;\s*)((?:dies|das|die(?:se)?s?|satz\s?\d+[a-z]?|sätze\s?\d+|absatz\s?\d+[a-z]?|absätze\s?\d+|nummer\s?\d+|buchstabe\s?[a-z]|§\s?\d+[a-z]?)(?:\s+(?:und|bis|sowie)\s+(?:satz|absatz|nummer)?\s?\d+[a-z]?)?)\s+(gilt nicht|gelten nicht|ist nicht anzuwenden|sind nicht anzuwenden|findet keine Anwendung|finden keine Anwendung|bleibt außer Betracht|bleiben außer Betracht|entfällt|gilt nicht für|gelten nicht für)\b/i;

/* ─────────────────────── Rückausnahme ─────────────────────── */

/**
 * Die Ausnahme von der Ausnahme. Sie stellt die ursprüngliche Regel wieder her
 * und wird im Normtext regelmäßig mit „jedoch", „gleichwohl" oder einem zweiten
 * Verneinungssignal angeschlossen.
 *
 *   „Dies gilt nicht für …; SATZ 1 IST JEDOCH ANZUWENDEN, wenn …"
 */
const RUECKAUSNAHME = /\b(gilt jedoch|gelten jedoch|ist jedoch anzuwenden|sind jedoch anzuwenden|bleibt jedoch|bleiben jedoch|dies gilt jedoch|gilt gleichwohl|findet jedoch Anwendung|abweichend hiervon jedoch|es sei denn wiederum)\b/i;

/* ─────────────────────── Vorrangregel — KEINE Ausnahme ─────────────────────── */

/**
 * Konkurrenzregeln. Sie ordnen das Verhältnis zweier Normen zueinander und
 * nehmen nichts aus dem Tatbestand heraus.
 *
 *   „… sind die Vorschriften dieses Gesetzes VORBEHALTLICH DES RECHTS DER
 *     EUROPÄISCHEN UNION sinngemäß anwendbar."
 *
 * Der Anwendungsbereich bleibt unverändert; es wird nur gesagt, welche Norm im
 * Kollisionsfall weicht. Als „Ausnahme" markiert erzeugte das bisher eine Spanne
 * mitten in der Rechtsfolge — zwei Kategorien auf denselben Zeichen.
 */
export const VORRANG = /\b(unbeschadet|vorbehaltlich|ungeachtet|nach Maßgabe|im Rahmen|in Verbindung mit|unberührt)\b/i;

/**
 * Derogationsanzeiger: Der Rechtssatz stellt eine Sonderregel gegenüber einer
 * anderen auf. Das ist eine Eigenschaft DES SATZES, keine Spanne im Text — die
 * Wendung selbst („Abweichend von Absatz 1") ist ein reiner Verweis ohne
 * Merkmalsgehalt und wird deshalb nicht markiert.
 */
export const DEROGATION = /^(abweichend von|abweichend hiervon|entgegen|anstelle (?:des|der)|an Stelle (?:des|der))\b/i;

/* ─────────────────────── Hilfen ─────────────────────── */

/** Signalwörter, die für sich genommen keine Ausnahme sind. */
const NUR_SIGNAL = /^(es sei denn|ausgenommen|entfällt|gilt nicht|gelten nicht|ist nicht anzuwenden|sind nicht anzuwenden|findet keine Anwendung|finden keine Anwendung|mit Ausnahme|soweit nicht|sofern nicht|außer wenn|abweichend von(?:\s+(?:satz|absatz|nummer|buchstabe)\s?\d*[a-z]?)?)[.,;]?$/i;

/** Zeichen, an denen eine Ausnahmeklausel spätestens endet. */
function klauselEnde(satz, ab) {
  const semikolon = satz.indexOf(";", ab);
  return semikolon === -1 ? satz.length : semikolon;
}

/**
 * Beginn der Klausel: das Komma oder Semikolon unmittelbar vor dem Signal.
 * Ohne diesen Schritt beginnt die Ausnahme mitten in der Regel.
 */
function klauselBeginn(satz, signalVon) {
  const komma = Math.max(satz.lastIndexOf(",", signalVon - 1), satz.lastIndexOf(";", signalVon - 1));
  if (komma === -1) return signalVon;
  // Zwischen Komma und Signal darf nur Füllmaterial stehen, sonst gehört der
  // Text davor noch zur Regel und nicht zur Ausnahme.
  const dazwischen = satz.slice(komma + 1, signalVon).trim();
  return dazwischen.length <= 3 ? komma + 1 : signalVon;
}

/**
 * Ende einer Nominalphrase ab `von`. Sie endet am nächsten Komma, Semikolon oder
 * am finiten Verb des Hauptsatzes — je nachdem, was zuerst kommt.
 */
function nominalphraseEnde(satz, von, verbIndex = -1) {
  const kandidaten = [satz.indexOf(",", von), satz.indexOf(";", von), satz.length]
    .filter((i) => i > von);
  // Eine Bereichsausnahme steht INNERHALB einer Nominalphrase und endet damit
  // spätestens am finiten Verb — sonst verschluckt „mit Ausnahme der
  // Einfuhrumsatzsteuer" den halben Hauptsatz („… ist das Finanzamt zuständig").
  if (verbIndex > von) kandidaten.push(verbIndex);
  return Math.min(...kandidaten, satz.length);
}

/**
 * Signalwörter zum Ausblenden vor der Gehaltsprüfung.
 *
 * BEWUSST EIGENE AUSDRÜCKE statt BEDINGUNG/BEREICH: Jene tragen das g-Flag und
 * damit einen wandernden `lastIndex`. Sie hier in `replace` zu verwenden setzt
 * den Zähler der laufenden `exec`-Schleife zurück — die Schleife läuft dann
 * endlos, weil sie immer wieder denselben Treffer findet.
 */
const SIGNAL_AUSBLENDEN = /\b(es sei denn|außer wenn|sofern nicht|soweit nicht|solange nicht|wenn nicht|falls nicht|mit Ausnahme(?:\s+(?:der|des|von|dem|den))?|ausgenommen|ausschließlich der|gilt|gelten|nicht|ist|sind|anzuwenden|findet|finden|keine|Anwendung|entfällt|dies|das|satz|absatz|nummer)\b/gi;

/** Enthält die Spanne über das Signal hinaus überhaupt Inhalt? */
function hatGehalt(text) {
  if (NUR_SIGNAL.test(text.trim())) return false;
  const inhalt = text
    .replace(SIGNAL_AUSBLENDEN, " ")
    .match(/[A-Za-zÄÖÜäöüß§]{3,}/g) || [];
  // Eine Bereichsausnahme besteht regelmäßig aus genau einem Substantiv
  // („mit Ausnahme der Einfuhrumsatzsteuer"). Das nackte Signalwort ohne jeden
  // Zusatz fängt bereits NUR_SIGNAL ab.
  return inhalt.length >= 1;
}

/* ─────────────────────── Hauptfunktion ─────────────────────── */

/**
 * Findet ALLE Ausnahmen eines Rechtssatzes.
 *
 * @param {string} satz
 * @param {{verbIndex?: number}} kontext  Position des finiten Hauptsatzverbs
 * @returns {Array<{von:number, bis:number, text:string, klasse:string, rueck:boolean, grund:string}>}
 */
export function ausnahmeSpannen(satz, kontext = {}) {
  const raus = [];
  const belegt = (von, bis) => raus.some((r) => von < r.bis && r.von < bis);

  // ── Bauform C zuerst: Sie beansprucht den ganzen Rechtssatz und macht die
  //    Suche nach eingebetteten Signalen in derselben Klausel gegenstandslos.
  const satzM = SATZAUSNAHME.exec(satz);
  if (satzM) {
    // Nach einem Semikolon beginnt die Ausnahme dort, nicht am Satzanfang.
    const von = satzM.index === 0 ? 0 : satzM.index + satzM[0].indexOf(satzM[1]);
    const bis = klauselEnde(satz, von + satzM[0].length);
    const text = satz.slice(von, bis).replace(/^[\s;]+|[.,;]\s*$/g, "").trim();
    if (hatGehalt(text)) {
      raus.push({
        von, bis, text, klasse: "satz",
        rueck: RUECKAUSNAHME.test(satz),
        grund: `Satzausnahme: „${satzM[1]} ${satzM[2]}"`,
      });
    }
  }

  // ── Bauform A: nachgestellter Ausnahmesatz mit eigener Bedingung
  BEDINGUNG.lastIndex = 0;
  let m;
  while ((m = BEDINGUNG.exec(satz)) !== null) {
    if (BEDINGUNG.lastIndex <= m.index) BEDINGUNG.lastIndex = m.index + 1;
    const von = klauselBeginn(satz, m.index);
    const bis = klauselEnde(satz, m.index + m[0].length);
    if (belegt(von, bis)) continue;
    const text = satz.slice(von, bis).replace(/^[\s,;]+|[.,;\s]+$/g, "");
    if (!hatGehalt(text)) continue;
    raus.push({
      von, bis, text, klasse: "bedingung",
      rueck: RUECKAUSNAHME.test(text),
      grund: `Bedingungsausnahme mit „${m[1].toLowerCase()}"`,
    });
  }

  // ── Bauform B: Ausnahme innerhalb einer Nominalphrase
  BEREICH.lastIndex = 0;
  while ((m = BEREICH.exec(satz)) !== null) {
    if (BEREICH.lastIndex <= m.index) BEREICH.lastIndex = m.index + 1;
    const von = m.index;
    const bis = nominalphraseEnde(satz, m.index + m[0].length, kontext.verbIndex ?? -1);
    if (belegt(von, bis)) continue;
    const text = satz.slice(von, bis).replace(/^[\s,;]+|[.,;\s]+$/g, "");
    if (!hatGehalt(text)) continue;
    raus.push({
      von, bis, text, klasse: "bereich",
      rueck: false,
      grund: `Bereichsausnahme mit „${m[1].toLowerCase()}"`,
    });
  }

  // ── Rückausnahme: eigenständige Klausel, die die Regel wiederherstellt
  const rueckM = RUECKAUSNAHME.exec(satz);
  if (rueckM) {
    const von = klauselBeginn(satz, rueckM.index);
    const bis = klauselEnde(satz, rueckM.index + rueckM[0].length);
    if (!belegt(von, bis)) {
      const text = satz.slice(von, bis).replace(/^[\s,;]+|[.,;\s]+$/g, "");
      if (hatGehalt(text)) {
        raus.push({ von, bis, text, klasse: "rueck", rueck: true, grund: "Rückausnahme: stellt die Regel wieder her" });
      }
    }
  }

  return raus.sort((a, b) => a.von - b.von);
}

/**
 * Zieht die Ausnahmespannen aus einer Regelspanne heraus.
 *
 * Ohne diesen Schritt liegen zwei Kategorien auf denselben Zeichen: „Für die
 * Umsatzsteuer mit Ausnahme der Einfuhrumsatzsteuer" wäre gleichzeitig ganz
 * Tatbestand und in seinem hinteren Teil Ausnahme. Im Bestand traf das 467
 * Spannen. Übrig bleiben die Reststücke der Regel.
 *
 * @param {{von:number, bis:number}} spanne
 * @param {Array<{von:number,bis:number}>} ausnahmen
 * @returns {Array<{von:number,bis:number}>} verbleibende Stücke
 */
export function ausnahmeAbziehen(spanne, ausnahmen) {
  let stuecke = [{ von: spanne.von, bis: spanne.bis }];
  for (const a of ausnahmen) {
    const neu = [];
    for (const s of stuecke) {
      if (a.bis <= s.von || a.von >= s.bis) { neu.push(s); continue; }
      if (a.von > s.von) neu.push({ von: s.von, bis: a.von });
      if (a.bis < s.bis) neu.push({ von: a.bis, bis: s.bis });
    }
    stuecke = neu;
  }
  return stuecke;
}
