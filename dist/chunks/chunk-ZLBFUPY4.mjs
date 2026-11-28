import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{b as f,c as k,d as b,e as g,j as H,m as T}from"./chunk-Y42ZL3NP.mjs";import{a as n,c as l}from"./chunk-MQWJNHK4.mjs";import{a as i,c as m}from"./chunk-FYI4CRQB.mjs";import{c as p,e as d}from"./chunk-HFYXFA4S.mjs";import{f as c,n as u}from"./chunk-OFJTSZBC.mjs";function s(r){try{return r(),!1}catch(t){if(t instanceof Error)return!0;throw t}}function L(r,t,o){let e=Object.keys(t.files).find(P=>f(P)===f(o));if(e===void 0)return!1;let a=H(r,k(r,e),t.files[e]);return typeof a=="string"?!1:(t.files[e]=a,!0)}function w(r){let t=b(r),o=[];t!==null&&(s(()=>m(r.root))&&L(r,t,i)&&o.push(i),s(()=>l(r.root))&&L(r,t,n)&&o.push(n),o.length>0&&g(r,t)),s(()=>d(r.root))&&T(r)&&o.push(c);for(let e of o)p(r.root,`Put back ${e}: it had been overwritten with text the guard cannot read.`);return o}function v(r){return u(r.root,()=>w(r))}export{w as a,v as b};
