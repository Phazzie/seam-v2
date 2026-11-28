import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{c as u}from"./chunk-MQWJNHK4.mjs";import{c as g}from"./chunk-FYI4CRQB.mjs";import{e as l}from"./chunk-YZC7IT7R.mjs";import{a,e as o,i as m,m as c,n as f}from"./chunk-OFJTSZBC.mjs";import{join as b}from"node:path";var i=".seam/heartbeat.json",h=600*1e3,s=a.string().refine(t=>Number.isFinite(Date.parse(t)),"must be a date and time"),x=a.strictObject({from:s,to:s}),S=a.strictObject({lastSeen:s,gaps:a.array(x).default([])});function y(t){try{return m(t)?.phase==="build"}catch(e){if(e instanceof Error)return!0;throw e}}function j(t,e){f(t,()=>{let r=o(S,t,i),n=[...r?.gaps??[]];r!==null&&e.getTime()-Date.parse(r.lastSeen)>h&&y(t)&&n.push({from:new Date(r.lastSeen).toISOString(),to:e.toISOString()}),c(b(t,i),`${JSON.stringify({lastSeen:e.toISOString(),gaps:n},null,2)}
`)})}function R(t){return o(S,t,i)}import{resolve as G}from"node:path";function P(t,e,r,n){let d=l(t),p=g(t);return{root:t,appRoot:G(t,p?.appRoot??"."),dataDir:e,pluginRoot:r,state:d,plan:p,lock:u(t),now:n}}export{h as a,j as b,R as c,P as d};
