import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
async function T(r,t,i){let e,o=new Promise(n=>{e=setTimeout(()=>n(i()),t)});try{return await Promise.race([r(),o])}finally{clearTimeout(e)}}export{T as a};
