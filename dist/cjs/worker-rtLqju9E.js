"use strict";var t=require("worker_threads");const e=new Set(".,?!-_;()[]:+=^<>|/{}#$&%".split("")),r=(t="")=>t.toLowerCase().split("").map(((t,r,s)=>e.has(t)&&r&&" "!==s[r-1]?` ${t}`:t)).join("");function s(t=""){const s=(t=r(t)).split(/\s+/).filter((t=>t)),n=new Set;for(let t=0;t<s.length;t++){let r="",o=0;for(let a=t;a<s.length&&(e.has(s[a])||++o,o<10);a++){a!==t&&(r+=" ");for(let t=0;t<s[a].length;t++)r+=s[a][t],n.has(r)||n.add(r)}r=void 0,o=void 0}return[...n]}t.parentPort&&t.parentPort.on("message",(({text:e})=>{const r=s(e);t.parentPort.postMessage({indexes:r})})),exports.Scope={listeningFulltext:[]},exports.generateFulltextIndex=s,exports.transformPunctuation=r;
