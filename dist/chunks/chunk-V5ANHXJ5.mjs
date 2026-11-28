import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{a as h,b,c as x}from"./chunk-I6J63OMM.mjs";import{c as S}from"./chunk-X7WWZMRB.mjs";import{b as g,e as d}from"./chunk-ZEIVXO7F.mjs";import{e as u}from"./chunk-JEWKEWC6.mjs";import{a as o,e as s,i as c,m as f,n as l}from"./chunk-BE2TKDIW.mjs";import{join as A}from"node:path";var p=".seam/heartbeat.json",E=600*1e3,m=o.string().refine(t=>Number.isFinite(Date.parse(t)),"must be a date and time"),G=o.strictObject({from:m,to:m}),y=o.strictObject({lastSeen:m,gaps:o.array(G).default([])});function R(t){try{return c(t)?.phase==="build"}catch(e){if(e instanceof Error)return!0;throw e}}function C(t,e){l(t,()=>{let r=s(y,t,p),a=[...r?.gaps??[]];r!==null&&e.getTime()-Date.parse(r.lastSeen)>E&&R(t)&&a.push({from:new Date(r.lastSeen).toISOString(),to:e.toISOString()}),f(A(t,p),`${JSON.stringify({lastSeen:e.toISOString(),gaps:a},null,2)}
`)})}function I(t){return s(y,t,p)}import{resolve as H}from"node:path";function W(t,e,r,a){let v=u(t),n=d(t),i=g(t);return{root:t,appRoot:H(t,h(n,i)),dataDir:e,pluginRoot:r,state:v,now:a,lock:S(t),plan:n===null?null:x(n,i),legacyRoot:b(n,i)}}export{E as a,C as b,I as c,W as d};
