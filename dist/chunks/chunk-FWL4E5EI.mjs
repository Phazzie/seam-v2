import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{posix as e}from"node:path";var f=/\.(?:[cm]?[jt]s|[jt]sx)$/i,a=n=>n.replace(f,"");function c(n){let s=n.split("/");return n.startsWith("@")?s.slice(0,2).join("/"):s[0]}var l=(n,s)=>e.join(n.appRoot.replace(/\\/g,"/"),s);function d(n,s){let o=new Set,r=[...n.seams.flatMap(i=>i.files.map(t=>t.path)),...s];for(let i of r){let t=a(l(n,i));o.add(t),e.basename(t)==="index"&&o.add(e.dirname(t))}return o}var m=/^\.\.?(?:\/|$)/;function g(n,s,o){if(n.includes("\\"))return!1;let i=o.seams.flatMap(t=>t.files).find(t=>l(o,t.path)===s)?.imports??[];return m.test(n)?d(o,i).has(a(e.join(e.dirname(s),n))):n.split("/").some(t=>t===""||t==="."||t===".."||t==="node_modules"||t.includes("%"))?!1:i.includes(n)||o.packages.includes(n)||o.packages.includes(c(n))}export{c as a,g as b};
