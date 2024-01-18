import{MongoClient as t}from"mongodb";import{Worker as e}from"worker_threads";import{fileURLToPath as r}from"url";import{dirname as n}from"path";import{t as i}from"./peripherals-OVxn8NYu.js";const a="undefined"!=typeof __dirname?__dirname:n(r(import.meta.url)),o="__fta_",s="__rdz";class l extends t{constructor({map:t,url:e,options:r}){super(e,r),this.interceptMap=t}get db(){return c(super.db.bind(this),this.interceptMap)}__intercepted=!0}const f=t=>e=>{if(e.__intercepted)throw"this MongoClient instance was previously intercepted";const r=e.db.bind(e);e.db=c(r,t),e.__intercepted=!0},c=(t,e)=>function(){const r=t(...arguments),[n]=[...arguments];let i=function(){const t=[...arguments],i=r.collection(...t),a={},l=t[0];return Object.entries(e).forEach((([t,e])=>{const[r,f]=t.split("::");if(n===r&&l===f&&(e?.fulltext||e?.random)){const{fulltext:r,random:n}=e;if(r)if(Array.isArray(r)){if(r.filter((t=>"string"!=typeof t||t.includes("."))).length)throw`invalid intercept value in ${t}, fulltext array must contain a string without "." value but got ${JSON.stringify(r)}`;if(!r.length)throw`invalid intercept value in ${t}, fulltext array must not be empty`;if(r.filter(((t,e,r)=>r.indexOf(t)===e)).length!==r.length)throw`invalid intercept value in ${t}, fulltext array must not contain duplicate value but got ${r}`}else{if("string"!=typeof r||r.includes("."))throw`invalid intercept value in ${t}, fulltext must either be a string without "." or array but got ${r}`;if(!r.trim())throw`invalid intercept value in ${t}, fulltext must not be empty`}if(n&&"boolean"!=typeof n)throw`invalid intercept value in ${t}, random should be a boolean value but got ${e}`;const l=t=>{if(t?.$text?.$search&&r){const e=t.$text.$field||r,n=Array.isArray(e)?e:[e];if(n.filter(((t,e,r)=>r.indexOf(t)===e)).length!==n.length)throw"$field must not contain duplicate values";delete(t={...t,$or:[...t?.$or||[],...n.map((e=>({[`${o}${e}`]:{$in:[d(t?.$text?.$search)]}})))]}).$text}return t},f=t=>{let e=t;if(Buffer.isBuffer(e)&&(e=Buffer.from(e).toJSON()),!e)return Buffer.isBuffer(t)?t:e;let r=(Array.isArray(e)?e:[e]).map((t=>{const e={...t};return Object.keys(t).forEach((t=>{(t.startsWith(o)||t===s)&&delete e[t]})),e}));return r=Array.isArray(e)?r:r[0],Buffer.isBuffer(t)?Buffer.from(JSON.stringify(r),"utf8"):r},c=async t=>(y(t)&&((t={...t}).$set&&(t.$set=await m(t.$set,e)),t.$unset&&(Array.isArray(r)?r:[r]).forEach((e=>{t.$unset[e]&&(t.$unset[`${o}${e}`]=!0)}))),t);a.insertOne=async function(){return await i.insertOne(await m([...arguments][0],e),[...arguments][1])},a.insertMany=async function(){return await i.insertMany(await Promise.all([...arguments][0].map((t=>m(t,e)))),[...arguments][1])},["updateOne","updateMany"].forEach((t=>{a[t]=async function(){const e=[...arguments];return await i[t](l(e[0]),c(e[1]),e[2])}})),a.replaceOne=async function(){return await i.replaceOne(l([...arguments][0]),await m([...arguments][1],e),[...arguments][2])},a.bulkWrite=async function(){let[t,...r]=[...arguments];return await i.bulkWrite(await Promise.all(t.map((async t=>{const r={};return await Promise.all(Object.entries(t).map((async([t,n])=>{r[t]={...n,...n.filter?{filter:l(n.filter)}:{},...n.arrayFilters?{}:{arrayFilters:n.arrayFilters.map(l)},...n.document?{document:await m(n,e)}:{},...n.replacement?{replacement:await m(n,e)}:{},...n.update?{update:await c(n)}:{}}}))),r}))),...r)},a.find=function(){let[t,...e]=[...arguments];const r=i.find(l(t),...e),n=r.toArray.bind(r);return r.toArray=async()=>f(await n()),r},a.findOne=async function(){let[t,...e]=[...arguments];const r=await i.findOne(l(t),...e);return f(r)},a.watch=function(){const[t,...e]=[...arguments],r=i.watch(Array.isArray(t)?t.map(l):l(t),...e),n={};let a=0,o={};return["on","once","prependListener","addListener","prependOnceListener"].forEach((t=>{n[t]=(e,n)=>{if("change"===e){const e=""+ ++a;return o[e]=t=>{const e=Buffer.isBuffer(t)?Buffer.from(t).toJSON():t;e.fullDocument&&(e.fullDocument=f(e.fullDocument)),e.fullDocumentBeforeChange&&(e.fullDocumentBeforeChange=f(e.fullDocumentBeforeChange)),e.updateDescription?.updatedFields&&(e.updateDescription=f(e.updateDescription.updatedFields)),n?.(Buffer.isBuffer(t)?Buffer.from(JSON.stringify(e),"utf8"):e)},n.prototype||(n.prototype={}),n.prototype.__cloneMongodbListener||(n.prototype.__cloneMongodbListener=[]),n.prototype.__cloneMongodbListener.push(e),r[t]("change",o[e])}return r[t](e,n)}})),["off","removeListener"].forEach((t=>{n[t]=(e,n)=>{if("change"===e){const i=n.prototype?.__cloneMongodbListener;i&&(i.forEach((n=>{r[t](e,o[n]),o[n]&&delete o[n]})),delete n.prototype.__cloneMongodbListener)}else r[t](e,t)}})),new Proxy({},{get:(t,e)=>n[e]?n[e]:"function"==typeof r[e]?r[e].bind(r):r[e],set(t,e,i){n[e]?n[e]=i:r[e]=i}})},a.aggregate=function(){const[t,e]=[...arguments],[r,a]=t,o=r?.$sample?.size,c=l(a?.$match),d=Number.isInteger(o)&&o>0&&n,m=i.aggregate(t.map((t=>t?.$match?{...t,$match:l(t.$match)}:t)),e),y=m.toArray.bind(m);m.toArray=async()=>f(await y());let h=async()=>{const[t,e]=await Promise.all(["asc","desc"].map((t=>i.find({...c}).sort(s,t).limit(1).toArray()))),[r,n]=[t[0]?.[s],e[0]?.[s]];if(isNaN(r)||isNaN(n))return[];if(r===n)return f(t);{const t=o+0,e=(n-r)/t,a=[];let l=r;Array(t).fill().forEach((()=>{a.push(p(l+=e,l))}));const d=await Promise.all(a.map((t=>i.find({...c,[`${s}`]:{$gte:t}}).sort(s,"asc").limit(3).toArray()))),m=u(d.flat().filter(((t,e,r)=>r.findIndex((e=>e._id===t._id))===e)));if(m.length>=o)return f(m.slice(0,o));{const t=await Promise.all(["asc","desc"].map((t=>i.find({...c}).sort(s,t).limit(Math.ceil(o/2)).toArray()))),e=[...m,...u(t.flat().filter(((t,e,r)=>r.findIndex((e=>e._id===t._id))===e)))].filter(((t,e,r)=>r.findIndex((e=>e._id===t._id))===e));return f(e.slice(0,o))}}};return new Proxy({},{get:(t,e)=>"toArray"===e&&d?h:"function"==typeof m[e]?m[e].bind(m):m[e],set(t,e,r){"toArray"===e&&d?h=r:m[e]=r}})}}})),new Proxy({},{get:(t,e)=>a[e]?a[e]:"function"==typeof i[e]?i[e].bind(i):i[e],set:(t,e,r)=>{a[e]?a[e]=r:i[e]=r}})};return new Proxy({},{get:(t,e)=>"collection"===e?i:"function"==typeof r[e]?r[e].bind(r):r[e],set(t,e,n){"collection"===e?i=n:r[e]=n}})},u=t=>{const e=[...t];let r,n=e.length;for(;0!=n;)r=Math.floor(Math.random()*n),n--,[e[n],e[r]]=[e[r],e[n]];return e},p=(t=70,e=0)=>(t-e)*Math.random()+e,d=t=>i(t.trim()),m=async(t,{fulltext:e,random:r})=>{if(!y(t))return t;const n={...t};if(e){e=Array.isArray(e)?e:[e];const r=Date.now();console.log("building fulltext"),await Promise.all(e.map((async e=>{const r=t[e];"string"==typeof r&&r.trim()&&(n[`${o}${e}`]=await h(r))}))),console.log("index completed in:",Date.now()-r)}return r&&(n[s]=Math.random()),n},y=t=>null!==t&&"object"==typeof t&&!Array.isArray(t),h=async t=>{const e=await Promise.all($(t).map((t=>g(`${a}/worker.js`,{text:t}))));return[...new Set(e.map((t=>t.indexes)).flat())]},g=(t,r)=>new Promise((n=>{const i=new e(t);i.on("message",(t=>{n(t)})),i.postMessage(r)})),w=2e4,$=(t="")=>{t=t.split(" ");let e=[[]],r=0,n=0;for(let i=0;i<t.length;i++){const a=t[i];n+=a.length,++r<=2700&&n<w||!e[e.length-1].length?e[e.length-1].push(a):(e.push([a]),n=a.length,r=1)}const i=[];return e.forEach((t=>{t.length&&(t[0].length>w?Array(Math.ceil(t[0].length/w)).fill().forEach(((e,r)=>{i.push(t[0].substring(r*w,(r+1)*w))})):i.push(t.join(" ")))})),i};export{l as MongoClientHack,h as getFulltextArray,f as proxyClient};