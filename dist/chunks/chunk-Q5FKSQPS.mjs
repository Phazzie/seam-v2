import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{a as f}from"./chunk-RUY2TN43.mjs";import{f as c,m}from"./chunk-B6GECIS6.mjs";import{h as p}from"./chunk-JEWKEWC6.mjs";var l=80;function d(o,i,t){let[e]=m(o),n=o.tool_input?.command,r="";e!==void 0?r=` on ${e}`:typeof n=="string"&&(r=` "${n.slice(0,l)}"`);let s=`${o.tool_name??"a tool"}${r}`;return i==="PostToolUse"?`${s} left a problem: ${t}`:`tried ${s}: ${t}`}function k(o,i,t,e,n){try{return p(o,i,f(t),d(t,e,n)),""}catch(r){return`this block could not be recorded: ${c(r)}`}}export{d as a,k as b};
