import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{createHash as r}from"node:crypto";function e(t){return t.replace(/^\uFEFF/,"").replace(/\r\n?/g,`
`)}function i(t){return r("sha256").update(e(t)).digest("hex")}export{e as a,i as b};
