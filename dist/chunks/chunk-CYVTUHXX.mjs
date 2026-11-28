import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{a as l,c as a}from"./chunk-R6J4RKMI.mjs";import{posix as c}from"node:path";var e=o=>c.normalize(o.replace(/\\/g,"/")).replace(/(.)\/+$/,"$1");function p(o,r,t,n,i){return new Error(`The plan (${a}) says the ${o} is "${n}", but ${l} (from seam init ${t}) says "${i}". They have to name the same folder: set "${r}" in ${a} to "${i}", or change "${r}" in ${l} to "${n}".`)}function s(o,r){let t=e(o?.appRoot??"."),n=e(r?.appRoot??".");if(t==="."||t===n)return n==="."?t:n;if(n===".")return t;throw p("app folder","appRoot","--app-root",t,n)}function f(o,r){let t=o===null||o.legacyRoot===null?null:e(o.legacyRoot),n=r===null||r.legacyRoot===void 0?null:e(r.legacyRoot);if(t===null||t===n)return n??t;if(n===null)return t;throw p("old app","legacyRoot","--legacy",t,n)}function R(o,r){return{...o,appRoot:s(o,r),legacyRoot:f(o,r)}}export{s as a,f as b,R as c};
