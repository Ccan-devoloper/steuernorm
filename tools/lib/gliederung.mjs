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
    for (const teil of teile) {
      if (teil.marke) {
        for (const [j, s] of saetze(teil.text).entries()) {
          raus.push({ pfad: `${praefix} ${teil.marke}`.trim() + (j ? ` Halbs. ${j + 1}` : ""), text: s, ebene: "nr", nr: teil.marke });
        }
      } else {
        for (const [j, s] of saetze(teil.text).entries()) {
          raus.push({ pfad: `${praefix} Satz ${j + 1}`.trim(), text: s, ebene: "satz", nr: null });
        }
      }
    }
  }
  return ankern(raus, volltextDerNorm(norm));
}

function zerlegeListe(html) {
  const teile = [];
  // Alles vor der ersten Liste ist der Einleitungssatz.
  const listen = [...html.matchAll(/<dl[^>]*class="[^"]*\bgl\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/g)];
  if (!listen.length) {
    const t = entkerne(html);
    if (t) teile.push({ marke: null, text: t });
    return teile;
  }
  let cursor = 0;
  for (const liste of listen) {
    const vor = entkerne(html.slice(cursor, liste.index));
    if (vor) teile.push({ marke: null, text: vor });
    const paare = [...liste[1].matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)];
    for (const [, dt, dd] of paare) {
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
    cursor = liste.index + liste[0].length;
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
