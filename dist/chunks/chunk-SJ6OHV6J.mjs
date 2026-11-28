import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{f as s,h as c,i as S,k as f,m,n as a}from"./chunk-OFJTSZBC.mjs";import{g as p}from"./chunk-DCEPY3W4.mjs";import{appendFileSync as L}from"node:fs";import{join as y}from"node:path";import{existsSync as x}from"node:fs";import{join as h}from"node:path";function n(t,e){let r=h(t,".seam");if(!x(r))throw new Error(`The seam records folder is missing (${r}), so ${e}.`)}var g=".seam/log.md",u=t=>String(t).padStart(2,"0");function d(t,e,r=new Date){n(t,"nothing can be logged");let o=e.replace(/\s*[\r\n]+\s*/g," "),i=`${u(r.getHours())}:${u(r.getMinutes())} ${o}
`;f(`add to ${g}`,()=>L(y(t,g),i))}import{createHash as k}from"node:crypto";import{mkdirSync as w}from"node:fs";import{dirname as $,join as l}from"node:path";function T(t){return k("sha256").update(p(t,".")).digest("hex").slice(0,16)}function b(t){let e=S(t);if(e===null)throw new Error(`${s} is missing, so this project's state cannot be read.`);return e}function v(t,e,r){let o=`${JSON.stringify(c(r,"The state to write"),null,2)}
`;n(t,"the state cannot be written");let i=l(e,"mirror",T(t),"state.json");w($(i),{recursive:!0}),m(i,o),m(l(t,s),o)}function j(t,e,r){let o=r(b(t));return v(t,e,o),o}function D(t,e,r){return a(t,()=>j(t,e,r))}function Q(t,e,r,o){D(t,e,i=>({...i,blocks:i.blocks+1})),d(t,`Blocked: ${r} ${o}`)}export{n as a,g as b,d as c,T as d,b as e,v as f,j as g,Q as h};
