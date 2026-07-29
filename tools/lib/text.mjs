import { createHash } from "node:crypto";

const ENT = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"],
  ["nbsp", " "], ["sect", "§"], ["auml", "ä"], ["ouml", "ö"], ["uuml", "ü"],
  ["Auml", "Ä"], ["Ouml", "Ö"], ["Uuml", "Ü"], ["szlig", "ß"],
]);

export const TB_SIGNAL = /\b(wenn|soweit|sofern|falls|wer|wem|wessen|welche[rns]?|bei Vorliegen|unter der Voraussetzung|vorausgesetzt|nachdem|solange|bevor|durch|auf Antrag|im Fall(?:e)?|für den Fall)\b/i;
export const AUSNAHME_SIGNAL = /\b(es sei denn|ausgenommen|außer|vorbehaltlich|abweichend von|dies gilt nicht|nicht anzuwenden|entfällt|unbeschadet)\b/i;
export const RF_SIGNAL = /\b(ist|sind|gilt|gelten|hat|haben|muss|müssen|darf|dürfen|kann|können|wird|werden|unterliegt|unterliegen|beträgt|entsteht|entstehen|erlischt|erlöschen|erhöht|vermindert|festzusetzen|festgesetzt|abzuziehen|hinzuzurechnen|zu gewähren|zu versagen|verpflichtet|berechtigt|steuerfrei|steuerpflichtig|zulässig|unzulässig)\b/i;
const REINER_VERWEIS = /^(§+|Artikel|Art\.)\s*\d|nach Maßgabe|entsprechend anzuwenden|bleibt unberührt/i;
const SATZPUNKT_SCHUTZ = "\uE000";
const ABKUERZUNG = /\b(Abs|Art|Nr|Buchst|S|vgl|bzw|ca|Bek|BGBl|BStBl|z|B|i|d|v|u|a)\./g;

export function dekodiere(s = "") {
  return s.replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e.startsWith("#x") || e.startsWith("#X")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENT.get(e) ?? m;
  });
}

/**
 * Erzeugt denselben kanonischen Suchtext, den die Website aus ihren Textknoten bildet:
 * Tags und Blockgrenzen werden zu genau einem Leerzeichen, vorhandene Satzzeichen bleiben unverändert.
 */
export function textAusHtml(h = "") {
  return dekodiere(
    h
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function textDerNorm(n) {
  return n.abs
    .map((a) => textAusHtml(a.html))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function hashText(s) {
  return createHash("sha256").update(s).digest("hex");
}

export function eindeutig(a) {
  const gesehen = new Set();
  return a.filter((x) => {
    const k = typeof x === "string" ? x : JSON.stringify(x);
    if (!k || gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
}

export function sauberePhrase(s, volltext) {
  if (typeof s !== "string") return null;
  const p = s
    .replace(/^\s*[„“"']|[„“"']\s*$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  if (p.length < 3 || p.length > 700 || !volltext.includes(p)) return null;
  if (/[.!?]{2,}/.test(p)) return null;
  // Verhindert durch Abkürzungstrennung entstandene Fragmente wie „1 Satz 3 der Abgabenordnung“.
  if (/^\d+\s+(?:Satz|Abs(?:atz|\.)|Nummer|Nr\.)\b/i.test(p)) return null;
  return p;
}

export function satzSegmente(volltext) {
  const vorbereitet = volltext.replace(ABKUERZUNG, (_m, wort) => `${wort}${SATZPUNKT_SCHUTZ}`);
  const segmenter = new Intl.Segmenter("de", { granularity: "sentence" });
  return [...segmenter.segment(vorbereitet)]
    .map((x) => x.segment.replaceAll(SATZPUNKT_SCHUTZ, ".").trim())
    .filter((x) => x.length > 2);
}

function trenne(satz) {
  const r = { tb: [], rf: [], ausnahmen: [] };
  if (AUSNAHME_SIGNAL.test(satz)) r.ausnahmen.push(satz);

  const komma = satz.indexOf(",");
  if (komma > 3) {
    const links = satz.slice(0, komma).trim();
    const rechts = satz.slice(komma + 1).trim();
    if (TB_SIGNAL.test(links) && RF_SIGNAL.test(rechts)) {
      r.tb.push(links);
      r.rf.push(rechts);
      return r;
    }
  }

  const signal = RF_SIGNAL.exec(satz);
  if (signal && signal.index > 1) {
    const links = satz.slice(0, signal.index).trim().replace(/[,:;]$/, "");
    const rechts = satz.slice(signal.index).trim();
    if (links.length >= 3 && rechts.length >= 3) {
      r.tb.push(links);
      r.rf.push(rechts);
      return r;
    }
  }

  if (TB_SIGNAL.test(satz)) r.tb.push(satz);
  else if (RF_SIGNAL.test(satz)) r.rf.push(satz);
  return r;
}

export function logikAnalyse(norm) {
  const volltext = textDerNorm(norm);
  const tb = [];
  const rf = [];
  const ausnahmen = [];
  for (const satz of satzSegmente(volltext)) {
    const r = trenne(satz);
    tb.push(...r.tb);
    rf.push(...r.rf);
    ausnahmen.push(...r.ausnahmen);
  }

  let klassifikation = "no_classic_rule";
  if (tb.length && rf.length) klassifikation = "rule";
  else if (/\b(ist|sind|gilt|gelten)\b/.test(volltext) && /\b(Begriff|im Sinne|bezeichnet|Definition)\b/i.test(`${norm.titel} ${volltext}`)) klassifikation = "definition";
  else if (/\b(gilt als|gelten als|wird behandelt als)\b/i.test(volltext)) klassifikation = "fiction";
  else if (/\b(muss|müssen|ist verpflichtet|sind verpflichtet|hat zu|haben zu)\b/i.test(volltext)) klassifikation = "obligation";
  else if (/\b(darf nicht|dürfen nicht|ist unzulässig|sind unzulässig)\b/i.test(volltext)) klassifikation = "prohibition";
  else if (/\b(darf|dürfen|kann|können|ist berechtigt|sind berechtigt)\b/i.test(volltext)) klassifikation = "permission";
  else if (/\b(beträgt|berechnet|Bemessungsgrundlage|Steuersatz|Prozent|Euro)\b/i.test(`${norm.titel} ${volltext}`)) klassifikation = "calculation";
  else if (/\b(Zuständigkeit|zuständig|Verfahren|Antrag|Frist|Klage|Einspruch)\b/i.test(`${norm.titel} ${volltext}`)) klassifikation = "procedure";
  else if (REINER_VERWEIS.test(volltext)) klassifikation = "reference_only";

  return {
    klassifikation,
    tb: eindeutig(tb).slice(0, 20),
    rf: eindeutig(rf).slice(0, 20),
    ausnahmen: eindeutig(ausnahmen).slice(0, 12),
    staerke: tb.length && rf.length ? 0.72 : (tb.length || rf.length ? 0.45 : 0.2),
  };
}

function tokens(s) {
  return new Set(
    (s.toLowerCase().match(/[a-zäöüß]{4,}/g) || [])
      .filter((x) => ![
        "diese", "dieser", "dieses", "einer", "eines", "einem", "einen", "sowie",
        "werden", "wurde", "sind", "oder", "nach", "durch", "wenn", "soweit", "nicht",
        "auch", "kann", "haben",
      ].includes(x)),
  );
}

export function passtZuLogik(p, kandidaten) {
  return kandidaten.some((k) => {
    if (k.includes(p) || p.includes(k)) return true;
    const a = tokens(p);
    const b = tokens(k);
    if (!a.size || !b.size) return false;
    let gemeinsam = 0;
    for (const x of a) if (b.has(x)) gemeinsam++;
    return gemeinsam / (a.size + b.size - gemeinsam) >= 0.48;
  });
}
