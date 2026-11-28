import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{createHash as e}from"node:crypto";function n(t){return t.replace(/^\uFEFF/,"").replace(/\r\n?/g,`
`)}function i(t){return e("sha256").update(n(t)).digest("hex")}function o(t){let r=t.toString("utf8");return!t.includes(0)&&Buffer.from(r,"utf8").equals(t)?i(r):e("sha256").update(t).digest("hex")}export{n as a,i as b,o as c};
