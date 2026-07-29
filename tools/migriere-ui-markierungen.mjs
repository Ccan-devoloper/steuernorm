#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const datei = path.resolve(import.meta.dirname, "..", "index.html");
let html = await readFile(datei, "utf8");

const markerBlock = `/* --------------------------- Markierungen --------------------------- */
/* Kanonischer Textindex mit Zuordnung jedes Suchzeichens zum ursprünglichen Textknoten. */
function textindex(wurzel){
  const gehe = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT, {
    acceptNode(n){
      if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (n.parentElement.closest(".sn")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const knoten = [], karte = [];
  let text = "", n;

  function leerzeichen(ref = null){
    if (text && !text.endsWith(" ")){
      text += " ";
      karte.push(ref);
    }
  }

  function zeichen(ch, ref){
    if (/\\s/.test(ch)){
      leerzeichen(ref);
      return;
    }
    if (/[,.;:!?]/.test(ch) && text.endsWith(" ")){
      text = text.slice(0, -1);
      karte.pop();
    }
    text += ch;
    karte.push(ref);
  }

  while ((n = gehe.nextNode())){
    if (knoten.length) leerzeichen();
    knoten.push(n);
    for (let i = 0; i < n.nodeValue.length; i++){
      zeichen(n.nodeValue[i], { n, i });
    }
  }
  if (text.endsWith(" ")){
    text = text.slice(0, -1);
    karte.pop();
  }
  return { text, karte, knoten };
}

function fundstellen(text, phrase){
  const treffer = [];
  if (typeof phrase !== "string" || !phrase) return treffer;
  let von = 0, start;
  while ((start = text.indexOf(phrase, von)) !== -1){
    treffer.push([start, start + phrase.length]);
    von = start + Math.max(1, phrase.length);
  }
  return treffer;
}

function markierungenAnlegen(wurzel, anm){
  const { text, karte, knoten } = textindex(wurzel);
  const klassen = new Map(knoten.map(n => [n, new Uint8Array(n.nodeValue.length)]));
  let verwaist = 0;

  for (const [art, bit] of [["tb", 1], ["rf", 2]]){
    for (const phrase of anm[art] || []){
      const treffer = fundstellen(text, phrase);
      if (!treffer.length){
        verwaist++;
        continue;
      }
      for (const [start, ende] of treffer){
        for (let pos = start; pos < ende; pos++){
          const ref = karte[pos];
          if (ref) klassen.get(ref.n)[ref.i] |= bit;
        }
      }
    }
  }

  for (const n of knoten){
    const roh = n.nodeValue;
    const bits = klassen.get(n);
    if (!bits.some(Boolean)) continue;
    const frag = document.createDocumentFragment();
    let start = 0;
    while (start < roh.length){
      const bit = bits[start];
      let ende = start + 1;
      while (ende < roh.length && bits[ende] === bit) ende++;
      const ausschnitt = roh.slice(start, ende);
      if (!bit){
        frag.appendChild(document.createTextNode(ausschnitt));
      } else {
        const mark = document.createElement("mark");
        mark.className = bit === 3 ? "tb rf" : (bit === 1 ? "tb" : "rf");
        mark.textContent = ausschnitt;
        frag.appendChild(mark);
      }
      start = ende;
    }
    n.parentNode.replaceChild(frag, n);
  }
  return verwaist;
}

/* --------------------------- Querverweise --------------------------- */`;

const blockMuster = /\/\* --------------------------- Markierungen --------------------------- \*\/[\s\S]*?\/\* --------------------------- Querverweise --------------------------- \*\//;
if (!blockMuster.test(html)) throw new Error("Alter Markierungsblock nicht gefunden");
html = html.replace(blockMuster, markerBlock);

const altAufruf = `  // Markierungen anlegen; nicht mehr passende Phrasen melden
  let verwaist = 0;
  if (anm){
    for (const p of anm.tb || []) if (!markieren(text, p, "tb")) verwaist++;
    for (const p of anm.rf || []) if (!markieren(text, p, "rf")) verwaist++;
  }
  verweiseSetzen(text, S.abk);`;
const neuAufruf = `  // Alle Markierungen in einem Durchgang gegen denselben kanonischen Text wie im Backend anlegen.
  const verwaist = anm ? markierungenAnlegen(text, anm) : 0;
  verweiseSetzen(text, S.abk);`;
if (!html.includes(altAufruf)) throw new Error("Alter Markierungsaufruf nicht gefunden");
html = html.replace(altAufruf, neuAufruf);

const cssAlt = `  body[data-tb=an] mark.tb{background:var(--tb);box-shadow:inset 0 -2px 0 var(--tb-kante)}
  body[data-rf=an] mark.rf{background:var(--rf);box-shadow:inset 0 -2px 0 var(--rf-kante)}`;
const cssNeu = `${cssAlt}
  body[data-tb=an][data-rf=an] mark.tb.rf{background:linear-gradient(180deg,var(--tb) 0 50%,var(--rf) 50% 100%);box-shadow:inset 0 -2px 0 var(--rf-kante)}`;
if (!html.includes(cssAlt)) throw new Error("Markierungs-CSS nicht gefunden");
html = html.replace(cssAlt, cssNeu);

await writeFile(datei, html);
console.log("index.html auf kanonische Mehrfachmarkierung migriert");
