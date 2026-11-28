import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{b as a,c as H,d as T,e as P,j as A,m as L}from"./chunk-XOPSHAJG.mjs";import{a as i,b as k,c as f,e as b}from"./chunk-3EDLPDSC.mjs";import{a as s,c as g}from"./chunk-PY57STUV.mjs";import{c as l,e as m}from"./chunk-ZMA37XTB.mjs";import{f as u,n as d}from"./chunk-HHZDTERO.mjs";function n(r){try{return r(),!1}catch(t){if(t instanceof Error)return!0;throw t}}function c(r,t,o){let e=Object.keys(t.files).find(w=>a(w)===a(o));if(e===void 0)return!1;let p=A(r,H(r,e),t.files[e]);return typeof p=="string"?!1:(t.files[e]=p,!0)}function y(r){let t=T(r),o=[];t!==null&&(n(()=>g(r.root))&&c(r,t,s)&&o.push(s),n(()=>b(r.root))&&c(r,t,f)&&o.push(f),n(()=>k(r.root))&&c(r,t,i)&&o.push(i),o.length>0&&P(r,t)),n(()=>m(r.root))&&L(r)&&o.push(u);for(let e of o)l(r.root,`Put back ${e}: it had been overwritten with text the guard cannot read.`);return o}function j(r){return d(r.root,()=>y(r))}export{y as a,j as b};
