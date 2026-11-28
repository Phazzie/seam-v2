import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
var n={"seam-v2:builder":"builder","seam-v2:describer":"describer","seam-v2:checker":"checker","seam-v2:surveyor":"surveyor","seam-v2:design":"design"};function o(r){let e=r.agent_type;return e===void 0?r.agent_id===void 0?"main":"readonly":typeof e=="string"&&Object.hasOwn(n,e)?n[e]:"readonly"}export{o as a};
