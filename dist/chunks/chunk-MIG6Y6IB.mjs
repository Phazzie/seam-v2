import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{randomBytes as i}from"node:crypto";import{renameSync as c,rmSync as a,writeFileSync as p}from"node:fs";var s=10,n=20,m=new Set(["EPERM","EBUSY","EACCES"]);function y(r){return r.code??""}function S(r){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,r)}function u(r,o){for(let t=1;;t+=1){try{return o()}catch(e){if(!m.has(y(e)))throw e;if(t>=s)throw new Error(`Could not ${r}: it stayed busy for ${(s-1)*n} ms (${e.message}).`,{cause:e})}S(n)}}function f(r,o){let t=`${r}.${process.pid}.${i(4).toString("hex")}.tmp`;try{p(t,o),u(`replace ${r}`,()=>c(t,r))}catch(e){throw a(t,{force:!0,maxRetries:3,retryDelay:n}),e}}export{m as a,y as b,S as c,u as d,f as e};
