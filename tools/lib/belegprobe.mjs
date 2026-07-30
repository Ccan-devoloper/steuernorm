/**
 * belegprobe.mjs — Tragfähigkeitsprüfung von Belegen.
 *
 * Der bisherige Belegvalidator in konsens.mjs prüft, ob eine vom Modell genannte
 * Fundstelle ÜBERHAUPT VORLAG. Damit sind erfundene Fundstellen ausgeschlossen —
 * aber nicht der zweite, tückischere Fehlertyp: eine echte Fundstelle, die die
 * Zuordnung gar nicht hergibt. Genau diesen Fall hat die Stanford-Untersuchung als
 * „misgrounded" bezeichnet und bei den kommerziellen Werkzeugen am häufigsten gefunden.
 *
 * Dieses Modul schließt die Lücke: Ein getrennter Aufruf bekommt NUR den Belegtext und
 * die Behauptung, ohne den Normtext und ohne die Begründung des ersten Laufs, und muss
 * entscheiden, ob der Beleg die Behauptung stützt, ihr widerspricht oder nichts dazu sagt.
 *
 * Ergebnis je Spanne:
 *   "stuetzt"      → Beleg bleibt, Konfidenz steigt
 *   "neutral"      → Beleg wird entfernt, Spanne bleibt
 *   "widerspricht" → Spanne wird herabgestuft und als strittig gekennzeichnet
 */

const SYSTEM = `Du prüfst, ob ein Auszug aus einer amtlichen Verwaltungsanweisung oder ein Leitsatz eine Behauptung über eine Rechtsnorm stützt.

Du bekommst:
- einen Belegtext (amtlicher Wortlaut),
- eine Behauptung der Form: "Die Wendung «X» ist ein Tatbestandsmerkmal / eine Rechtsfolge / eine Ausnahme dieser Norm."

Entscheide ausschließlich anhand des Belegtextes:
- "stuetzt"      — der Belegtext behandelt genau diese Wendung und bestätigt die Einordnung, etwa indem er sie als Voraussetzung, als Rechtsfolge oder als Ausnahme bezeichnet oder erkennbar so behandelt.
- "widerspricht" — der Belegtext ordnet die Wendung erkennbar anders ein.
- "neutral"      — der Belegtext äußert sich nicht zu dieser Wendung oder nicht zu ihrer Einordnung.

Sei streng. Thematische Nähe genügt nicht. Erwähnt der Beleg die Wendung nur beiläufig, ohne ihre Funktion in der Norm zu bestimmen, lautet die Antwort "neutral". Im Zweifel "neutral".

Antworte ausschließlich mit valider JSON.`;

const SCHEMA = {
  name: "belegprobe",
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
            urteil: { type: "string", enum: ["stuetzt", "neutral", "widerspricht"] },
            stelle: { type: "string", maxLength: 160 },
          },
          required: ["i", "urteil", "stelle"],
        },
      },
    },
    required: ["urteile"],
  },
};

const BEZEICHNUNG = { tb: "ein Tatbestandsmerkmal", rf: "eine Rechtsfolge", ausn: "eine Ausnahme" };

/**
 * @param {object} arg
 * @param {Array}  arg.spannen   [{ art, text, beleg }]
 * @param {object} arg.belege    Belegdatei-Eintrag der Norm
 * @param {Function} arg.aufrufen  einAufruf-kompatible Funktion aus modell.mjs
 * @returns {Promise<Map<number,{urteil:string,stelle:string}>>}
 */
export async function belegProbe({ spannen, belege, aufrufen, modell, token, budget }) {
  const zuPruefen = spannen
    .map((s, i) => ({ i, s }))
    .filter(({ s }) => s.beleg && s.beleg.fundstelle);
  if (!zuPruefen.length) return new Map();

  // Nach Fundstelle bündeln: ein Aufruf je Belegtext statt je Spanne.
  const nachFundstelle = new Map();
  for (const { i, s } of zuPruefen) {
    const schluessel = s.beleg.fundstelle;
    if (!nachFundstelle.has(schluessel)) nachFundstelle.set(schluessel, []);
    nachFundstelle.get(schluessel).push({ i, art: s.art, text: s.text });
  }

  const ergebnis = new Map();

  for (const [fundstelle, posten] of nachFundstelle) {
    const belegtext = belegtextZu(fundstelle, belege);
    if (!belegtext) {
      for (const p of posten) ergebnis.set(p.i, { urteil: "neutral", stelle: "" });
      continue;
    }

    const nutzer = JSON.stringify({
      beleg: { fundstelle, text: belegtext.slice(0, 6_000) },
      behauptungen: posten.map((p, k) => ({
        i: k,
        satz: `Die Wendung «${p.text}» ist ${BEZEICHNUNG[p.art] || "ein Merkmal"} dieser Norm.`,
      })),
    });

    let antwort = null;
    try {
      antwort = await aufrufen({
        system: SYSTEM, nutzer, schema: SCHEMA, modell, temperatur: 0, token, budget,
      });
    } catch {
      // Ohne Probe bleibt der Beleg unbestätigt — das ist die vorsichtige Seite.
      for (const p of posten) ergebnis.set(p.i, { urteil: "neutral", stelle: "" });
      continue;
    }

    const urteile = new Map((antwort?.urteile || []).map((u) => [u.i, u]));
    posten.forEach((p, k) => {
      const u = urteile.get(k);
      ergebnis.set(p.i, {
        urteil: u?.urteil || "neutral",
        stelle: pruefeStelle(u?.stelle, belegtext),
      });
    });
  }

  return ergebnis;
}

/** Die zitierte Stelle muss wörtlich im Belegtext stehen — sonst verworfen. */
function pruefeStelle(stelle, belegtext) {
  const t = String(stelle || "").trim();
  if (t.length < 12) return "";
  return belegtext.includes(t) ? t : "";
}

function belegtextZu(fundstelle, belege) {
  const ziel = String(fundstelle || "").toLowerCase();
  for (const b of belege?.verwaltung || []) {
    if (String(b.fundstelle || "").toLowerCase() === ziel) return b.text || "";
  }
  for (const e of belege?.rechtsprechung || []) {
    const kennung = [e.gericht, e.az].filter(Boolean).join(" ").toLowerCase();
    if (kennung && ziel.includes(kennung)) return e.leitsatz || "";
  }
  return null;
}

/**
 * Wendet die Urteile auf die Elemente an. Ändert Konfidenz und Beleg an Ort und Stelle.
 * @returns {{gestuetzt:number, entfernt:number, strittig:number}}
 */
export function probeAnwenden(elemente, urteile) {
  let gestuetzt = 0, entfernt = 0, strittig = 0;

  elemente.forEach((el, i) => {
    const u = urteile.get(i);
    if (!u || !el.beleg) return;

    if (u.urteil === "stuetzt") {
      el.beleg.geprueft = true;
      el.beleg.stelle = u.stelle || null;
      gestuetzt++;
      return;
    }
    if (u.urteil === "widerspricht") {
      el.beleg = { ...el.beleg, geprueft: false, widerspruch: true };
      el.konfidenz = Number(Math.max(0, el.konfidenz - 0.35).toFixed(3));
      el.strittig = true;
      strittig++;
      return;
    }
    // neutral: Der Beleg trägt nicht. Der Bonus wird zurückgenommen.
    el.konfidenz = Number(Math.max(0, el.konfidenz - 0.12).toFixed(3));
    el.beleg = null;
    entfernt++;
  });

  return { gestuetzt, entfernt, strittig };
}
