/**
 * modell.mjs — Anbindung an die Gemini-API (Google AI Studio) mit MEHRFACH-SAMPLING.
 *
 * GitHub Models wurde am 30.07.2026 vollständig abgeschaltet. Statt eines
 * kostenpflichtigen Ersatzes (OpenAI direkt) nutzt dieses Modul den DAUERHAFT
 * KOSTENLOSEN Zugang von Google AI Studio: kein Zahlungsmittel nötig, keine
 * Kartenprüfung, kein Ablaufdatum. Google veröffentlicht dafür einen zu OpenAI
 * kompatiblen Endpunkt (https://generativelanguage.googleapis.com/v1beta/openai),
 * der dasselbe Nachrichten- und Antwortformat spricht wie GitHub Models zuvor —
 * geändert haben sich nur Endpunkt, Modellnamen und die Art des Schlüssels.
 *
 * WICHTIGE EINSCHRÄNKUNG DER KOSTENLOSEN STUFE, die diesen Umbau von der
 * OpenAI-Fassung unterscheidet: Die Freistufe begrenzt nicht nur, wie schnell
 * angefragt werden darf (RPM), sondern auch, wie oft INSGESAMT PRO TAG (RPD).
 * Dieses Modul hält deshalb selbst eine Mindestpause zwischen zwei Anfragen ein
 * (siehe `MINDESTABSTAND_MS`) und behandelt eine wiederholte 429-Antwort als
 * Tagesgrenze, nicht als kurze Störung — der Lauf bricht dann kontrolliert ab
 * und der geplante Tageslauf setzt am nächsten Tag fort (siehe annotieren.mjs).
 * Außerdem kann Google Prompts der Freistufe zur Modellverbesserung verwenden;
 * bei öffentlichem Gesetzestext ist das unproblematisch, aber erwähnenswert.
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

const ENDPUNKT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const TIMEOUT_MS = 90_000;

/**
 * Mindestabstand zwischen zwei Anfragen. Gemini begrenzt die Freistufe je nach
 * Modell auf ungefähr 10–15 Anfragen pro Minute; die genaue Zahl schwankt und
 * wird von Google ohne Vorankündigung angepasst. 6500 ms (≈ 9,2 Anfragen/min)
 * ist bewusst vorsichtig gewählt — lieber langsamer als ständig 429-Fehler.
 * Überschreibbar über die Umgebungsvariable KI_MINDESTABSTAND_MS.
 */
const MINDESTABSTAND_MS = Number(globalThis.process?.env?.KI_MINDESTABSTAND_MS) || 6_500;
let LETZTE_ANFRAGE = 0;

async function pausiere() {
  const warten = MINDESTABSTAND_MS - (Date.now() - LETZTE_ANFRAGE);
  if (warten > 0) await new Promise((r) => setTimeout(r, warten));
  LETZTE_ANFRAGE = Date.now();
}

export class ModellKontingentErschoepft extends Error {}
export class ModellBudgetErschoepft extends Error {}
/** Tageskontingent der Freistufe erreicht. Erbt bewusst von ModellBudgetErschoepft,
 *  damit jede Stelle, die auf einen kontrollierten Gesamtabbruch reagiert, das
 *  automatisch mit erfasst — auch ohne dort eigens geändert zu werden. */
export class ModellTageslimitErschoepft extends ModellBudgetErschoepft {}

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

BELEGSTELLEN
Wenn dir Auszüge aus einer amtlichen Verwaltungsanweisung (AEAO, UStAE, EStR/EStH, KStR, GewStR) oder Leitsätze der Rechtsprechung vorgelegt werden, gilt:
- Benennt die Verwaltungsauffassung ein Tatbestandsmerkmal ausdrücklich, richte dich danach, auch wenn der syntaktische Vorschlag etwas anderes nahelegt.
- Trage in "belege" die Fundstelle EXAKT so ein, wie sie im vorgelegten Beleg steht (Feld "fundstelle"). Erfinde keine Fundstellen. Findest du keine passende Belegstelle, lass die Liste leer.
- Enthält der Beleg eine ausformulierte Prüfungsreihenfolge, richte die Reihenfolge deiner Merkmale danach aus.

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
            belege: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { text: { type: "string" }, fundstelle: { type: "string" } },
                required: ["text", "fundstelle"],
              },
            },
            begruendung: { type: "string", maxLength: 200 },
          },
          required: ["pfad", "typ", "vorfeld", "junktor", "tb", "rf", "ausnahmen", "belege", "begruendung"],
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

export async function einAufruf({ system, nutzer, schema, modell, temperatur, token, budget }) {
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

  let folge429 = 0;   // aufeinanderfolgende 429-Antworten TROTZ Wartezeit

  for (let versuch = 1; versuch <= 5; versuch++) {
    await pausiere();   // Mindestabstand zur letzten Anfrage einhalten (RPM-Grenze)
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
      folge429++;
      // Zwei 429-Antworten TROTZ eingehaltener Mindestpause sind kein kurzer
      // Ausreißer mehr, sondern deuten auf das Tageskontingent der Freistufe hin.
      // Weiterversuchen brächte nichts — es bräuchte Stunden, keine Sekunden.
      if (folge429 >= 2) {
        throw new ModellTageslimitErschoepft(
          `Gemini-Freistufe: Tages- oder Minutenkontingent erreicht (HTTP 429). ${text.slice(0, 150)}`,
        );
      }
      const warten = Number(antwort.headers.get("retry-after") || 0) * 1_000 || 15_000 * versuch;
      if (versuch >= 4) throw new ModellTageslimitErschoepft("Gemini-Freistufe: Kontingent wiederholt erschöpft (HTTP 429)");
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

/** Belege auf ein promptfreundliches Maß bringen. */
function belegeFuerPrompt(belege) {
  if (!belege) return null;
  const verwaltung = (belege.verwaltung || []).slice(0, 3).map((b) => ({
    fundstelle: b.fundstelle, quelle: b.quelle, text: String(b.text || "").slice(0, 1_800),
  }));
  const leitsaetze = (belege.rechtsprechung || []).filter((e) => e.leitsatz).slice(0, 4).map((e) => ({
    fundstelle: [e.gericht, e.az, e.datum].filter(Boolean).join(" "), text: e.leitsatz,
  }));
  if (!verwaltung.length && !leitsaetze.length) return null;
  return { verwaltungsauffassung: verwaltung, leitsaetze };
}

/* ─────────────────────────── Öffentliche API ─────────────────────────── */

/**
 * Analysiert eine Norm k-mal unabhängig.
 * @returns {Array} k Antworten der Form { saetze: [...] }
 */
export async function extrahiereMehrfach({ gesetz, norm, einheiten, vorschlag, belege, modelle, laeufe, token, budget }) {
  const nutzer = JSON.stringify({
    gesetz: { abk: gesetz.abk, titel: gesetz.titel },
    norm: { enbez: norm.enbez, titel: norm.titel, gegenstand: gesetz.titel },
    rechtssaetze: einheiten.map((e) => ({ pfad: e.pfad, text: e.text })),
    syntaktischer_vorschlag: vorschlag,
    belege: belegeFuerPrompt(belege),
    aufgabe: "Prüfe den syntaktischen Vorschlag gegen die Belegstellen und korrigiere ihn, wo er falsch liegt. Übernimm ihn nicht ungeprüft.",
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
