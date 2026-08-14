/**
 * Strukturerhaltende Zerlegung einer Norm in Rechtssätze.
 * Nutzt die Auszeichnung, die in data/<gesetz>.json bereits vorhanden ist
 * (<dl class="gl"><dt>1.</dt><dd>…</dd>), statt sie vorher plattzumachen.
 */

const MONATE = "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";
const SCHUTZ = "\uE000";
const ABK = /(?<![a-zäöüß])(Abs|Art|Nr|Nrn|Buchst|Halbs|Alt|lit|S|Sätze|vgl|bzw|ca|Bek|BGBl|BStBl|ggf|evtl|inkl|entspr|z|B|i|d|u|a|v|f|ff|Hs|Tz|Rz|Anm|Nds|EStR|EStH)\./g;
const ORDINAL = new RegExp(`\\b(\\d{1,2})\\.(?=\\s*(?:${MONATE}))`, "g");

function entkerne(html = "") {
  return html
    // Satznummern <span class="sn">1</span> blendet auch das Frontend aus
    // (textindex verwirft Knoten innerhalb von .sn). Beide müssen dieselbe
    // Zeichenkette bilden, sonst stimmen die Positionsanker nicht.
    .replace(/<span[^>]*class="[^"]*\bsn\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&sect;/g, "§").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

/** Zerlegt genau einen Textblock in Sätze — ohne an „31. Dezember“ oder „Abs. 2“ zu zerbrechen. */
export function saetze(text) {
  const geschuetzt = text
    .replace(ABK, (_m, w) => `${w}${SCHUTZ}`)
    .replace(ORDINAL, (_m, z) => `${z}${SCHUTZ}`);
  const seg = new Intl.Segmenter("de", { granularity: "sentence" });
  return [...seg.segment(geschuetzt)]
    .map((x) => x.segment.replaceAll(SCHUTZ, ".").trim())
    .filter((x) => x.length > 2);
}

/**
 * Der kanonische Volltext einer Norm: genau die Verkettung der Einheiten mit
 * einem Leerzeichen. Frontend und Pipeline müssen dieselbe Zeichenkette bilden,
 * damit die Offsets stimmen.
 */
export function volltextDerNorm(norm) {
  return entkerne(norm.abs.map((a) => a.html).join(" "));
}

/**
 * Trägt in jede Einheit ihre Zeichenposition im DOM-Volltext ein.
 * Die Suche läuft mit einem fortlaufenden Cursor, damit wiederholte Wendungen
 * („Der Solidaritätszuschlag") die richtige und nicht die erste Stelle treffen.
 */
function ankern(liste, volltext) {
  // Pfade eindeutig machen: wird ein Satz von einer Aufzählung unterbrochen,
  // entstehen mehrere Stücke mit derselben Adresse. Sie bekommen einen Zusatz,
  // damit jede Spanne genau einem Rechtssatz zugeordnet bleibt.
  const gezaehlt = new Map();
  for (const e of liste) {
    const n = (gezaehlt.get(e.pfad) || 0) + 1;
    gezaehlt.set(e.pfad, n);
    if (n > 1) e.pfad = `${e.pfad} (Teil ${n})`;
  }

  let cursor = 0;
  for (const e of liste) {
    const i = volltext.indexOf(e.text, cursor);
    if (i === -1) { e.von = null; e.bis = null; continue; }
    e.von = i;
    e.bis = i + e.text.length;
    cursor = e.bis;
  }
  return liste;
}

/**
 * Liefert für einen Absatz eine flache Liste von Einheiten mit stabiler Adresse:
 *   { pfad: "Abs. 1 Satz 1 Nr. 3 Buchst. a", text, ebene, nr }
 */
export function einheiten(norm) {
  const raus = [];
  for (const [i, abs] of norm.abs.entries()) {
    const absNr = abs.n ?? (norm.abs.length > 1 ? String(i + 1) : null);
    const praefix = absNr ? `Abs. ${absNr}` : "";
    // Aufzählungen isolieren: <dt>1.</dt><dd>…</dd>
    const teile = zerlegeListe(abs.html);

    /* Die Satzzählung läuft über den ganzen ADRESSRAUM, nicht über das
       einzelne Stück. Eine Aufzählung unterbricht den Satz, sie beendet ihn
       nicht: „Der Umsatz wird bemessen 1. … 2. … 3. …" ist Satz 1, und „Die
       Umsatzsteuer gehört nicht zur Bemessungsgrundlage." dahinter ist Satz 2
       — nicht noch einmal Satz 1. Weil die Zählung bei jedem Stück neu bei 1
       begann, trugen 843 Sätze in 375 Normen die Nummer eines anderen.
       Dasselbe gilt eine Ebene tiefer für eine Nummer, die von einer
       Unteraufzählung unterbrochen wird. */
    const zaehler = new Map();     // Adressraum („" = Absatz, sonst die Marke)
    const roh = [];
    for (const teil of teile) {
      const schluessel = teil.marke || "";
      const schonDa = zaehler.has(schluessel);
      let nr = zaehler.get(schluessel) || 0;
      for (const [j, s] of saetze(teil.text).entries()) {
        /* Ein Stück, das denselben Adressraum FORTSETZT: Beginnt es klein,
           führt es den unterbrochenen Satz zu Ende und behält dessen Nummer —
           `ankern` hängt dann „(Teil 2)" an. Beginnt es groß oder mit „§", ist
           es ein neuer Satz. Im Deutschen ist die Großschreibung des ersten
           Wortes das verlässliche Zeichen dafür. */
        const fortsetzung = j === 0 && schonDa && nr > 0 && !/^[A-ZÄÖÜ§]/.test(s);
        if (!fortsetzung) nr++;
        roh.push({ schluessel, marke: teil.marke, nr, text: s });
      }
      zaehler.set(schluessel, nr);
    }

    for (const e of roh) {
      /* Innerhalb einer Nummer stehen SÄTZE, keine Halbsätze. Das Gesetz sagt
         es selbst: § 10 Abs. 4 Nr. 3 UStG verweist auf „Satz 1 Nr. 2 Sätze 2
         und 3". Wo nur ein Satz steht, braucht er keine Nummer — die Nummer
         der Aufzählung ist dort die ganze Adresse. */
      const mehrere = (zaehler.get(e.schluessel) || 0) > 1;
      raus.push({
        pfad: e.marke
          ? `${praefix} ${e.marke}`.trim() + (mehrere ? ` Satz ${e.nr}` : "")
          : `${praefix} Satz ${e.nr}`.trim(),
        text: e.text,
        ebene: e.marke ? "nr" : "satz",
        nr: e.marke || null,
      });
    }
  }
  return ankern(raus, volltextDerNorm(norm));
}

/**
 * Ende eines Elements, das sich selbst enthalten kann — `<dl>` in `<dd>`.
 *
 * Hier stand ein `([\s\S]*?)<\/dl>`. Das Fragezeichen macht die Suche
 * genügsam, und bei einer geschachtelten Aufzählung endete die äußere Liste
 * deshalb am `</dl>` der INNEREN. § 12 AO war das sichtbare Beispiel: Der Text
 * von Buchst. a verschwand in dem der Nr. 8, die Buchstaben b und c verloren
 * ihre Nummer, und „länger als sechs Monate dauern." landete als eigener Satz
 * hinter der Aufzählung statt als Schluss von Nr. 8. 151 der 1 537 Normen
 * tragen eine geschachtelte Aufzählung; in allen war die Zerlegung falsch.
 * Gezählt wird deshalb die Verschachtelungstiefe.
 */
function endeVon(html, tag, ab) {
  const muster = new RegExp(`<${tag}\\b[^>]*>|</${tag}\\s*>`, "gi");
  muster.lastIndex = ab;
  let tiefe = 0;
  let m;
  while ((m = muster.exec(html))) {
    if (m[0][1] === "/") {
      tiefe--;
      if (tiefe === 0) return { inhaltBis: m.index, nach: m.index + m[0].length };
    } else {
      tiefe++;
    }
  }
  return null;
}

/** Die `<dt>/<dd>`-Paare EINER Ebene — verschachtelte werden übersprungen. */
function listenpaare(inhalt) {
  const raus = [];
  const dt = /<dt\b[^>]*>([\s\S]*?)<\/dt\s*>/gi;
  let m;
  while ((m = dt.exec(inhalt))) {
    const ddAuf = /<dd\b[^>]*>/gi;
    ddAuf.lastIndex = dt.lastIndex;
    const auf = ddAuf.exec(inhalt);
    if (!auf) break;
    const ende = endeVon(inhalt, "dd", auf.index);
    if (!ende) break;
    raus.push([m[1], inhalt.slice(auf.index + auf[0].length, ende.inhaltBis)]);
    dt.lastIndex = ende.nach;
  }
  return raus;
}

function zerlegeListe(html) {
  const teile = [];
  const auf = /<dl\b[^>]*class="[^"]*\bgl\b[^"]*"[^>]*>/gi;
  let cursor = 0;
  let hatListe = false;
  let m;
  while ((m = auf.exec(html))) {
    const ende = endeVon(html, "dl", m.index);
    if (!ende) break;
    hatListe = true;
    // Alles vor der Liste ist der Einleitungssatz.
    const vor = entkerne(html.slice(cursor, m.index));
    if (vor) teile.push({ marke: null, text: vor });

    for (const [dt, dd] of listenpaare(html.slice(m.index + m[0].length, ende.inhaltBis))) {
      const marke = entkerne(dt).replace(/\.$/, "");
      const inner = zerlegeListe(dd);
      if (inner.length === 1 && !inner[0].marke) {
        teile.push({ marke: bezeichner(marke), text: inner[0].text });
      } else {
        for (const kind of inner) {
          teile.push({
            marke: kind.marke ? `${bezeichner(marke)} ${kind.marke}` : bezeichner(marke),
            text: kind.text,
          });
        }
      }
    }
    cursor = ende.nach;
    auf.lastIndex = ende.nach;
  }
  if (!hatListe) {
    const t = entkerne(html);
    if (t) teile.push({ marke: null, text: t });
    return teile;
  }
  const nach = entkerne(html.slice(cursor));
  if (nach) teile.push({ marke: null, text: nach });
  return teile;
}

function bezeichner(m) {
  if (/^\d+$/.test(m)) return `Nr. ${m}`;
  if (/^[a-z]\)?$/i.test(m)) return `Buchst. ${m.replace(/\)$/, "")}`;
  return m;
}
