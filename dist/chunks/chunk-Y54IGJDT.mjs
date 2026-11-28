import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{b as g,e as S}from"./chunk-3EDLPDSC.mjs";import{c as d}from"./chunk-PY57STUV.mjs";import{e as u}from"./chunk-ZMA37XTB.mjs";import{a,e as i,i as c,m as l,n as f}from"./chunk-HHZDTERO.mjs";import{join as x}from"node:path";var p=".seam/heartbeat.json",y=600*1e3,s=a.string().refine(t=>Number.isFinite(Date.parse(t)),"must be a date and time"),G=a.strictObject({from:s,to:s}),b=a.strictObject({lastSeen:s,gaps:a.array(G).default([])});function A(t){try{return c(t)?.phase==="build"}catch(e){if(e instanceof Error)return!0;throw e}}function k(t,e){f(t,()=>{let o=i(b,t,p),n=[...o?.gaps??[]];o!==null&&e.getTime()-Date.parse(o.lastSeen)>y&&A(t)&&n.push({from:new Date(o.lastSeen).toISOString(),to:e.toISOString()}),l(x(t,p),`${JSON.stringify({lastSeen:e.toISOString(),gaps:n},null,2)}
`)})}function B(t){return i(b,t,p)}import{resolve as E}from"node:path";function L(t,e,o,n){let h=u(t),r=d(t),m=g(t),R=r!==null&&r.appRoot!=="."?r.appRoot:m?.appRoot??r?.appRoot??".";return{root:t,appRoot:E(t,R),dataDir:e,pluginRoot:o,state:h,plan:r,lock:S(t),now:n,legacyRoot:r?.legacyRoot??m?.legacyRoot??null}}export{y as a,k as b,B as c,L as d};
