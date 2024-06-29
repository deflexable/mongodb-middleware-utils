import{MongoClient as t}from"mongodb";import{Worker as e}from"worker_threads";import{fileURLToPath as n}from"url";import{dirname as r}from"path";import{S as i,g as a,t as o}from"./worker-eR1lX_Pr.js";const s="undefined"!=typeof __dirname?__dirname:r(n(import.meta.url)),l="__fta_",c="__rdz";class f extends t{constructor({map:t,url:e,options:n}){super(e,n),this.interceptMap=t,d(super.db.bind(this),this.interceptMap)}get db(){return p(super.db.bind(this),this.interceptMap)}__intercepted=!0}const u=t=>e=>{if(e.__intercepted)throw"this MongoClient instance was previously intercepted";d(e.db.bind(e),t);const n=e.db.bind(e);e.db=p(n,t),e.__intercepted=!0},d=(t,e)=>{Object.entries(e).forEach((([e,n])=>{Object.entries(n).forEach((([n,r])=>{const a=`dbName(${e}), collectionName(${n})`,{fulltext:o,random:s,safeOverhead:f,overhead:u}=r||{};if(o)if(Array.isArray(o)){if(o.filter((t=>"string"!=typeof t||t.includes(".")||!t.trim())).length)throw`invalid interception value in ${a}, fulltext array must contain a non empty string without "." value but got ${JSON.stringify(o)}`;if(!o.length)throw`invalid interception value in ${a}, fulltext array must not be empty`;if(o.filter(((t,e,n)=>n.indexOf(t)===e)).length!==o.length)throw`invalid interception value in ${a}, fulltext array must not contain duplicate value but got ${o}`}else{if("string"!=typeof o||o.includes("."))throw`invalid interception value in ${a}, fulltext must either be a string without "." or array but got ${o}`;if(!o.trim())throw`invalid interception value in ${a}, fulltext must not be empty`}if(void 0!==s&&"boolean"!=typeof s)throw`invalid interception value in ${a}, random should be a boolean value but got ${r}`;if(f&&!u)throw'"safeOverhead" should only be true when "overhead" is true';if(u&&!i.listeningFulltext[a]&&(o||s)){i.listeningFulltext[a]=!0;const r=t(e).collection(n),u=r.watch(),d=o?Array.isArray(o)?o:[o]:[];console.log("listening overhead:",n),u.on("change",(async({operationType:t,fullDocument:e,updateDescription:n,documentKey:i})=>{if("delete"===t)return;const{_id:a}=i,u=e||await r.findOne({_id:a});if(!u)return;const p=o?"insert"===t?d.filter((t=>!u[`${l}${t}`])):Object.keys(n?.updatedFields||{}).filter((t=>d.includes(t))):[];if(p.length||s&&!u[c])if(console.log("overhead working"),f){const t=15728640-JSON.stringify({...u,...Object.fromEntries(p.map((t=>[t])))}).length;if(t>0){const e=await Promise.all(p.map((async t=>[t,await $(u[t])]))),n=e.map((([t])=>[t,new Set([])]));let i,o=0;for(let r=0;r<e.length&&!i;r++)for(let a=0;a<e[r][1].length;a++){const s=e[r][1][a];if(i=(o+=s.length+4)>=t)break;n[r][1].add(s)}r.updateOne({_id:a},{$set:{...Object.fromEntries(n.map((([t,e])=>[`${l}${t}`,[...e]])).filter((t=>t[1].length))),...u[c]?{}:{[c]:Math.random()}}})}else u[c]||r.updateOne({_id:a},{$set:{[c]:Math.random()}})}else{const t=await Promise.all(p.map((async t=>[`${l}${t}`,await $(u[t])])));r.updateOne({_id:a},{$set:{...Object.fromEntries(t),...u[c]?{}:{[c]:Math.random()}}})}}))}}))}))},p=(t,e)=>function(){const n=t(...arguments),[r]=[...arguments];let i=function(){const t=[...arguments],i=n.collection(...t),a={},o=t[0];return Object.entries(e).forEach((([t,e])=>{Object.entries(e).forEach((([e,n])=>{if(r===t&&o===e&&(n?.fulltext||n?.random)){const{fulltext:t,random:e}=n,r=e=>{if(e?.$text?.$search&&t){const n=e.$text.$field||t,r=Array.isArray(n)?n:[n];if(r.filter(((t,e,n)=>n.indexOf(t)===e)).length!==r.length)throw"$field must not contain duplicate values";delete(e={...e,$or:[...e?.$or||[],...r.map((t=>({[`${l}${t}`]:{$in:[y(e?.$text?.$search)]}})))]}).$text}return e},o=t=>{let e=t;if(Buffer.isBuffer(e)&&(e=JSON.parse(Buffer.from(e).toString("utf-8"))),!e)return Buffer.isBuffer(t)?t:e;let n=(Array.isArray(e)?e:[e]).map((t=>{const e={...t};return Object.keys(t).forEach((t=>{(t.startsWith(l)||t===c)&&delete e[t]})),e}));return n=Array.isArray(e)?n:n[0],Buffer.isBuffer(t)?Buffer.from(JSON.stringify(n),"utf8"):n},s=async e=>(w(e)&&((e={...e}).$set&&(e.$set=await g(e.$set,n)),e.$setOnInsert&&(e.$setOnInsert=await g(e.$setOnInsert,n)),e.$unset&&(Array.isArray(t)?t:[t]).forEach((t=>{e.$unset[t]&&(e.$unset[`${l}${t}`]=!0)}))),e);a.insertOne=async function(){return await i.insertOne(await g([...arguments][0],n),[...arguments][1])},a.insertMany=async function(){return await i.insertMany(await Promise.all([...arguments][0].map((t=>g(t,n)))),[...arguments][1])},["updateOne","updateMany"].forEach((t=>{a[t]=async function(){const e=[...arguments];return await i[t](r(e[0]),await s(e[1]),e[2])}})),a.replaceOne=async function(){return await i.replaceOne(r([...arguments][0]),await g([...arguments][1],n),[...arguments][2])},a.bulkWrite=async function(){let[t,...e]=[...arguments];return await i.bulkWrite(await Promise.all(t.map((async t=>{const e={};return await Promise.all(Object.entries(t).map((async([t,i])=>{e[t]={...i,...i.filter?{filter:r(i.filter)}:{},...i.arrayFilters?{}:{arrayFilters:i.arrayFilters.map(r)},...i.document?{document:await g(i.document,n)}:{},...i.replacement?{replacement:await g(i.replacement,n)}:{},...i.update?{update:await s(i.update)}:{}}}))),e}))),...e)},a.find=function(){let[t,...e]=[...arguments];const n=i.find(r(t),...e),a=n.toArray.bind(n);return n.toArray=async()=>o(await a()),n},a.findOne=async function(){let[t,...e]=[...arguments];const n=await i.findOne(r(t),...e);return o(n)},a.watch=function(){const[t,...e]=[...arguments],n=i.watch(Array.isArray(t)?t.map(r):r(t),...e),a={};let s=0,l={};return["on","once","prependListener","addListener","prependOnceListener"].forEach((t=>{a[t]=(e,r)=>{if("change"===e){const e=""+ ++s;return l[e]=t=>{const e=Buffer.isBuffer(t)?JSON.parse(Buffer.from(t).toString("utf-8")):t;e.fullDocument&&(e.fullDocument=o(e.fullDocument)),e.fullDocumentBeforeChange&&(e.fullDocumentBeforeChange=o(e.fullDocumentBeforeChange)),e.updateDescription?.updatedFields&&(e.updateDescription.updatedFields=o(e.updateDescription.updatedFields)),r?.(Buffer.isBuffer(t)?Buffer.from(JSON.stringify(e),"utf8"):e)},r.prototype||(r.prototype={}),r.prototype.__cloneMongodbListener||(r.prototype.__cloneMongodbListener=[]),r.prototype.__cloneMongodbListener.push(e),n[t]("change",l[e])}return n[t](e,r)}})),["off","removeListener"].forEach((t=>{a[t]=(e,r)=>{if("change"===e){const i=r.prototype?.__cloneMongodbListener;i&&(i.forEach((r=>{n[t](e,l[r]),l[r]&&delete l[r]})),delete r.prototype.__cloneMongodbListener)}else n[t](e,t)}})),new Proxy({},{get:(t,e)=>a[e]?a[e]:"function"==typeof n[e]?n[e].bind(n):n[e],set(t,e,r){a[e]?a[e]=r:n[e]=r}})},a.aggregate=function(){const[t,n]=[...arguments],[a,s]=t,l=a?.$sample?.size,f=r(s?.$match),u=Number.isInteger(l)&&l>0&&e,d=i.aggregate(t.map((t=>t?.$match?{...t,$match:r(t.$match)}:t)),n),p=d.toArray.bind(d);d.toArray=async()=>o(await p());let y=async()=>{const[t,e]=await Promise.all(["asc","desc"].map((t=>i.find({...f}).sort(c,t).limit(1).toArray()))),[n,r]=[t[0]?.[c],e[0]?.[c]];if(isNaN(n)||isNaN(r))return[];if(n===r)return o(t);{const t=l+0,e=(r-n)/t,a=[];let s=n;Array(t).fill().forEach((()=>{a.push(h(s+=e,s))}));const u=await Promise.all(a.map((t=>i.find({...f,[`${c}`]:{$gte:t}}).sort(c,"asc").limit(3).toArray()))),d=m(u.flat().filter(((t,e,n)=>n.findIndex((e=>e._id===t._id))===e)));if(d.length>=l)return o(d.slice(0,l));{const t=await Promise.all(["asc","desc"].map((t=>i.find({...f}).sort(c,t).limit(Math.ceil(l/2)).toArray()))),e=[...d,...m(t.flat().filter(((t,e,n)=>n.findIndex((e=>e._id===t._id))===e)))].filter(((t,e,n)=>n.findIndex((e=>e._id===t._id))===e));return o(e.slice(0,l))}}};return new Proxy({},{get:(t,e)=>"toArray"===e&&u?y:"function"==typeof d[e]?d[e].bind(d):d[e],set(t,e,n){"toArray"===e&&u?y=n:d[e]=n}})}}}))})),new Proxy({},{get:(t,e)=>a[e]?a[e]:"function"==typeof i[e]?i[e].bind(i):i[e],set:(t,e,n)=>{a[e]?a[e]=n:i[e]=n}})};return new Proxy({},{get:(t,e)=>"collection"===e?i:"function"==typeof n[e]?n[e].bind(n):n[e],set(t,e,r){"collection"===e?i=r:n[e]=r}})},m=t=>{const e=[...t];let n,r=e.length;for(;0!=r;)n=Math.floor(Math.random()*r),r--,[e[r],e[n]]=[e[n],e[r]];return e},h=(t=70,e=0)=>(t-e)*Math.random()+e,y=t=>o(t.trim()),g=async(t,{fulltext:e,random:n,overhead:r})=>{if(r)return t;if(!w(t))return t;const i={...t};return e&&(e=Array.isArray(e)?e:[e],await Promise.all(e.map((async e=>{const n=t[e];"string"==typeof n&&n.trim()&&!t[`${l}${e}`]&&(i[`${l}${e}`]=await $(n))})))),n&&!t[c]&&(i[c]=Math.random()),i},w=t=>null!==t&&"object"==typeof t&&!Array.isArray(t),$=async t=>{if(!t?.trim?.())return[];const e=O(t),n=e.length>1?await Promise.all(e.map((t=>b(`${s}/worker.js`,{text:t})))):e.map((t=>({indexes:a(t)})));return[...new Set(n.map((t=>t.indexes)).flat())]},b=(t,n)=>new Promise((r=>{const i=new e(t);i.on("message",(t=>{r(t)})),i.postMessage(n)})),_=2e4,O=(t="")=>{t=t.split(" ");let e=[[]],n=0,r=0;for(let i=0;i<t.length;i++){const a=t[i];r+=a.length,++n<=2700&&r<_||!e[e.length-1].length?e[e.length-1].push(a):(e.push([a]),r=a.length,n=1)}const i=[];return e.forEach((t=>{t.length&&(t[0].length>_?Array(Math.ceil(t[0].length/_)).fill().forEach(((e,n)=>{i.push(t[0].substring(n*_,(n+1)*_))})):i.push(t.join(" ")))})),i};export{l as FULLTEXT_ARRAY_PREFIX,f as MongoClientHack,c as RANDOMIZER_FIELD,$ as getFulltextArray,d as overheadConfig,u as proxyClient};
