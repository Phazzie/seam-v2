import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{e as s,f as c,g as f,i as g,j as m,k as a}from"./chunk-Z2LODIXB.mjs";import{g as p}from"./chunk-DCEPY3W4.mjs";import{appendFileSync as y}from"node:fs";import{join as L}from"node:path";import{existsSync as x}from"node:fs";import{join as h}from"node:path";function n(t,r){let e=h(t,".seam");if(!x(e))throw new Error(`The seam records folder is missing (${e}), so ${r}.`)}var S=".seam/log.md",u=t=>String(t).padStart(2,"0");function d(t,r,e=new Date){n(t,"nothing can be logged");let o=r.replace(/\s*[\r\n]+\s*/g," "),i=`${u(e.getHours())}:${u(e.getMinutes())} ${o}
`;g(`add to ${S}`,()=>y(L(t,S),i))}import{createHash as w}from"node:crypto";import{mkdirSync as $}from"node:fs";import{dirname as k,join as l}from"node:path";function T(t){return w("sha256").update(p(t,".")).digest("hex").slice(0,16)}function b(t){let r=f(t);if(r===null)throw new Error(`${s} is missing, so this project's state cannot be read.`);return r}function v(t,r,e){let o=`${JSON.stringify(c(e,"The state to write"),null,2)}
`;n(t,"the state cannot be written");let i=l(r,"mirror",T(t),"state.json");$(k(i),{recursive:!0}),m(i,o),m(l(t,s),o)}function j(t,r,e){return a(t,()=>{let o=e(b(t));return v(t,r,o),o})}function z(t,r,e,o){j(t,r,i=>({...i,blocks:i.blocks+1})),d(t,`Blocked: ${e} ${o}`)}export{d as a,T as b,b as c,v as d,z as e};
