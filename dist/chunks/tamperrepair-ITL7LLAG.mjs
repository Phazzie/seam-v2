import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{b as f,c as k,d as b,e as g,i as T,l as H}from"./chunk-NEDPQTJ2.mjs";import{a as n,b as l,c as i,d as m}from"./chunk-3OE6DTYL.mjs";import{a as p,c as d}from"./chunk-5PLPSMQV.mjs";import{e as c,k as u}from"./chunk-U7MYMQUW.mjs";import"./chunk-DCEPY3W4.mjs";import"./chunk-FNSR2DX5.mjs";function a(r){try{return r(),!1}catch(t){if(t instanceof Error)return!0;throw t}}function P(r,t,o){let e=Object.keys(t.files).find(w=>f(w)===f(o));if(e===void 0)return!1;let s=T(r,k(r,e),t.files[e]);return typeof s=="string"?!1:(t.files[e]=s,!0)}function x(r){return u(r.root,()=>{let t=b(r),o=[];t!==null&&(a(()=>m(r.root))&&P(r,t,i)&&o.push(i),a(()=>l(r.root))&&P(r,t,n)&&o.push(n),o.length>0&&g(r,t)),a(()=>d(r.root))&&H(r)&&o.push(c);for(let e of o)p(r.root,`Put back ${e}: it had been overwritten with text the guard cannot read.`);return o})}export{x as restoreBroken};
