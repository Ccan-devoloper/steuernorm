/**
 * modell.mjs — Anbindung an GitHub Models mit MEHRFACH-SAMPLING.
 *
 * Der entscheidende Unterschied zur bisherigen Fassung: Jede Norm wird k-mal
 * unabhängig analysiert (unterschiedliche Temperatur, optional unterschiedliche
 * Modelle). Als gesichert gilt nur, was in mindestens `KONSENS_ANTEIL` der Läufe
 * gleich herauskommt. Damit tritt die Übereinstimmung mehrerer Läufe an die Stelle
 * der menschlichen Durchsicht — und die Konfidenz misst etwas Reales statt der
 * Selbsteinschätzung eines einzelnen Laufs.
 *
 * Zusätzlich läuft eine GEGENPROBE: Ein zweiter Aufruf bekommt nur die extrahierten
 * Spannen ohne die erste Begründung und muss unabhängig entscheiden, ob eine Spanne
 * Voraussetzung oder Folge ist. Weicht sie ab, wird die Spanne verworfen.
 */

const ENDPUNKT = "https://models.github.ai/inference/chat/completions";
const TIMEOUT_MS = 90_000;

export class ModellKontingentErschoepft extends Error {}
export class ModellBudgetErschoepft extends Error {}

/* ─────────────────────────── Systemvorgaben ─────────────────────────── */

const SYSTEM_EXTRAKTION = `Du zerlegst deutsche Steuerrechtsnormen in Tatbestand und Rechtsfolge. Du erteilst keine Rechtsberatung und gibst ausschließlich valides JSON zurück.

GRUNDREGEL DER DEUTSCHEN SYNTAX
Im Hauptsatz steht das finite Verb an zweiter Stelle. Was davor steht (Vorfeld), ist genau ein Satzglied. Prüfe für jeden Rechtssatz zuerst, WAS im Vorfeld steht:
- Prädikatives Adjektiv oder Partizip ("Abgabepflichtig sind …", "Steuerfrei sind …", "Maßgebend ist …") → das Vorfeld ist die RECHTSFOLGE, das Nachfeld enthält die Voraussetzungen.
- Konditionales Adverbial ("Bei der Veranlagung …", "Beim Abzug vom Arbeitslohn …", "Im Falle des …") → das Vorfeld ist der TATBESTAND (Anwendungsfall).
- Bloßes Satzsubjekt, das den Normgegenstand nennt ("Der Solidaritätszuschlag", "Die Steuer") → KEIN Merkmal, gar nicht erfassen.
- Verberststellung ("Ist die Steuer abgegolten, gilt …") → der vorangestellte Teil ist ein uneingeleiteter Bedingungssatz, also TATBESTAND.

NORMTYPEN
Nicht jede Vorschrift hat Tatbestand und Rechtsfolge. Ordne jedem Rechtssatz genau einen Typ zu:
konditional | tarif | definition | fiktion | verweisung | rechenregel | anwendung | aussage
- tarif: setzt nur einen Satz oder Betrag fest. Hat KEINEN eigenen Tatbestand. tb bleibt leer.
- anwendung: zeitlicher Geltungsbereich einer Fassung ("… ist erstmals für den Veranlagungszeitraum 2026 anzuwenden"). Gib WEDER tb NOCH rf zurück, beide Listen leer.
- rechenregel: Rundung und Ähnliches. Vollständig Rechtsfolge.
- verweisung: ordnet die Anwendung anderer Vorschriften an.

HARTE ANFORDERUNGEN
1. Jede Spanne ist eine wörtliche, zusammenhängende Teilzeichenkette GENAU DES Rechtssatzes, dem du sie zuordnest. Nicht aus einem anderen Absatz.
2. Keine Spanne beginnt mit einem Monatsnamen, einer Konjunktion oder einem Satzzeichen.
3. Keine Spanne besteht nur aus einer Fundstelle (BGBl., BStBl.) oder einer Datumsangabe.
4. Keine Spanne umfasst mehr als 45 Wörter. Zerlege stattdessen.
5. Ausnahmen ("mit Ausnahme", "es sei denn", "abweichend von") gehören in ausnahmen, nicht in tb.
6. Bei Aufzählungen: gib jede Nummer einzeln zurück und setze junktor auf "und" (kumulativ) oder "oder" (alternativ).

Begründe jede Zuordnung in einem Satz über das Satzglied, nicht über den Inhalt.`;

const SYSTEM_GEGENPROBE = `Du bekommst einen Rechtssatz aus einem deutschen Steuergesetz und einzelne wörtliche Ausschnitte daraus. Entscheide für jeden Ausschnitt UNABHÄNGIG, ob er
- eine Voraussetzung der Norm beschreibt (tb),
- eine Rechtswirkung anordnet (rf),
- eine Ausnahme oder Rückausnahme ist (ausn),
- oder gar kein normatives Merkmal ist (kein).

Achte besonders auf vorangestellte Rechtsfolgen: In "Abgabepflichtig sind natürliche Personen …" ist "Abgabepflichtig" die Rechtsfolge und "natürliche Personen …" die Voraussetzung.

Antworte ausschließlich mit valider JSON. Keine Begründung, keine Markdown-Blöcke.`;

/* ─────────────────────────── Antwortschemata ─────────────────────────── */

const TYPEN = ["konditional", "tarif", "definition", "fiktion", "verweisung", "rechenregel", "anwendung", "aussage"];

const SCHEMA_EXTRAKTION = {
  name: "normzerlegung",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      saetze: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            pfad: { type: "string" },
            typ: { type: "string", enum: TYPEN },
            vorfeld: { type: "string", enum: ["rechtsfolge", "tatbestand", "normsubjekt", "verberst", "keines"] },
            junktor: { type: "string", enum: ["und", "oder", "keiner"] },
            tb: { type: "array", items: { type: "string" } },
            rf: { type: "array", items: { type: "string" } },
            ausnahmen: { type: "array", items: { type: "string" } },
            begruendung: { type: "string", maxLength: 200 },
          },
          required: ["pfad", "typ", "vorfeld", "junktor", "tb", "rf", "ausnahmen", "begruendung"],
        },
      },
    },
    required: ["saetze"],
  },
};

const SCHEMA_GEGENPROBE = {
  name: "gegenprobe",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      urteile: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            i: { type: "integer" },
            art: { type: "string", enum: ["tb", "rf", "ausn", "kein"] },
          },
          required: ["i", "art"],
        },
      },
    },
    required: ["urteile"],
  },
};

/* ─────────────────────────── Aufruf ─────────────────────────── */

async function einAufruf({ system, nutzer, schema, modell, temperatur, token, budget }) {
  if (budget && budget.verbraucht >= budget.maximum) {
    throw new ModellBudgetErschoepft(`Budget von ${budget.maximum} Modellaufrufen erschöpft`);
  }
  if (budget) budget.verbraucht++;

  const body = {
    model: modell,
    messages: [
      { role: "system", content: system },
      { role: "user", content: nutzer },
    ],
    temperature: temperatur,
    max_tokens: 6_000,
    response_format: { type: "json_schema", json_schema: schema },
  };

  for (let versuch = 1; versuch <= 5; versuch++) {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), TIMEOUT_MS);
    let antwort, text;
    try {
      antwort = await fetch(ENDPUNKT, {
        method: "POST",
        signal: abbruch.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      text = await antwort.text();
    } catch (fehler) {
      clearTimeout(uhr);
      if (versuch >= 3) throw new ModellKontingentErschoepft(`Netzfehler: ${fehler.message}`);
      await warte(2_000 * versuch);
      continue;
    }
    clearTimeout(uhr);

    if (antwort.ok) {
      try {
        const roh = JSON.parse(text);
        const inhalt = roh.choices?.[0]?.message?.content ?? "";
        return JSON.parse(String(inhalt).replace(/^```json\s*|```\s*$/g, "").trim());
      } catch (fehler) {
        if (versuch >= 3) throw new ModellKontingentErschoepft(`Ungültige Antwort: ${fehler.message}`);
        await warte(2_000 * versuch);
        continue;
      }
    }

    if (antwort.status === 429) {
      const warten = Number(antwort.headers.get("retry-after") || 0) * 1_000 || 20_000 * versuch;
      if (versuch >= 4) throw new ModellKontingentErschoepft("GitHub-Models-Kontingent erschöpft");
      await warte(warten);
      continue;
    }
    if ((antwort.status === 400 || antwort.status === 422) && body.response_format) {
      body.response_format = { type: "json_object" };
      continue;
    }
    throw new ModellKontingentErschoepft(`HTTP ${antwort.status}: ${text.slice(0, 200)}`);
  }
  throw new ModellKontingentErschoepft("Alle Versuche erschöpft");
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── Öffentliche API ─────────────────────────── */

/**
 * Analysiert eine Norm k-mal unabhängig.
 * @returns {Array} k Antworten der Form { saetze: [...] }
 */
export async function extrahiereMehrfach({ gesetz, norm, einheiten, vorschlag, modelle, laeufe, token, budget }) {
  const nutzer = JSON.stringify({
    gesetz: { abk: gesetz.abk, titel: gesetz.titel },
    norm: { enbez: norm.enbez, titel: norm.titel, gegenstand: gesetz.titel },
    rechtssaetze: einheiten.map((e) => ({ pfad: e.pfad, text: e.text })),
    syntaktischer_vorschlag: vorschlag,
    aufgabe: "Prüfe den syntaktischen Vorschlag und korrigiere ihn, wo er falsch liegt. Übernimm ihn nicht ungeprüft.",
  });

  const antworten = [];
  for (let i = 0; i < laeufe; i++) {
    const modell = modelle[i % modelle.length];
    const temperatur = i === 0 ? 0 : 0.35;
    try {
      antworten.push(await einAufruf({
        system: SYSTEM_EXTRAKTION, nutzer, schema: SCHEMA_EXTRAKTION,
        modell, temperatur, token, budget,
      }));
    } catch (fehler) {
      if (fehler instanceof ModellBudgetErschoepft) throw fehler;
      if (antworten.length === 0) throw fehler;
      break; // mit weniger Läufen weiterarbeiten, Konfidenz sinkt entsprechend
    }
  }
  return antworten;
}

/**
 * Gegenprobe: kategorisiert vorgelegte Spannen ohne Kenntnis der ersten Begründung.
 * @returns {Map<number,string>} Index → art
 */
export async function gegenprobe({ satztext, spannen, modell, token, budget }) {
  if (!spannen.length) return new Map();
  const nutzer = JSON.stringify({
    rechtssatz: satztext,
    ausschnitte: spannen.map((s, i) => ({ i, text: s.text })),
  });
  const antwort = await einAufruf({
    system: SYSTEM_GEGENPROBE, nutzer, schema: SCHEMA_GEGENPROBE,
    modell, temperatur: 0, token, budget,
  });
  return new Map((antwort.urteile || []).map((u) => [u.i, u.art]));
}
