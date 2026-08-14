import { readFile } from "node:fs/promises";
import { einheiten } from "./tools/lib/gliederung.mjs";
for (const [d,e,f] of [["solzg.json","§ 3",/^Abs\. (1|4|4a)\b/],["invstg.json","§ 5",/^Abs\. 2\b/]]){
  const g = JSON.parse(await readFile("data/"+d,"utf8"));
  const n = g.normen.find(x=>x.enbez===e);
  console.log("=== "+d+" "+e);
  for (const u of einheiten(n)) if (f.test(u.pfad)) console.log("  "+u.pfad.padEnd(26)+" | "+u.text);
}
