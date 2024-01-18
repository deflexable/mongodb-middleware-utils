const s=new Set(".,?!-_;()[]:+=^<>|/".split("")),t=(t="")=>t.toLowerCase().split("").map(((t,a,e)=>s.has(t)&&a&&" "!==e[a-1]?` ${t}`:t)).join("");export{s as S,t};
