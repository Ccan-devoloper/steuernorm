/** Prüft, ob jede Markierung wörtlich im amtlichen Text vorkommt. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const W = path.resolve(import.meta.dirname, "..");
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g, " ");
let fehl = 0, ok = 0;
for (const f of (await readdir(path.join(W, "annotations"))).filter(f=>f.endsWith(".json"))) {
  const a = JSON.parse(await readFile(path.join(W, "annotations", f), "utf8"));
  const g = JSON.parse(await readFile(path.join(W, "data", f), "utf8"));
  for (const [id, an] of Object.entries(a.normen)) {
    const n = g.normen.find((x) => x.id === id);
    if (!n) { console.log(`FEHLT   ${a.abk} § ${id} — Norm nicht in den Daten`); fehl++; continue; }
    const t = text(n.abs.map((x) => x.html).join(" "));
    for (const art of ["tb", "rf"]) for (const p of an[art] || []) {
      if (t.includes(p)) ok++;
      else { fehl++; console.log(`NICHT   ${a.abk} § ${id} [${art}] "${p.slice(0,70)}"`); }
    }
  }
}
console.log(`\n${ok} Markierungen treffen, ${fehl} nicht.`);
