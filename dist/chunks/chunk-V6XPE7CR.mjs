import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
var t=["CLAUDE_PLUGIN_DATA","CLAUDE_PLUGIN_ROOT","SEAM_TEST_FORCE_THROW","SEAM_TEST_FORCE_HANG","SEAM_TEST_FORCE_INERT_HANG","SEAM_TEST_TIMEOUT_MS"];function c(){return process.env}function u(n){let r={};for(let o of t)n[o]!==void 0&&(r[o]=n[o]);return r}var E=n=>n===void 0||n===""?null:n;function _(n){let r=Number(n);return Number.isInteger(r)&&r>=1&&r<2e4?r:2e4}function S(n){return{dataDir:E(n.CLAUDE_PLUGIN_DATA),pluginRoot:E(n.CLAUDE_PLUGIN_ROOT),forceThrow:n.SEAM_TEST_FORCE_THROW==="1",forceHang:n.SEAM_TEST_FORCE_HANG==="1",forceInertHang:n.SEAM_TEST_FORCE_INERT_HANG==="1",timeoutMs:_(n.SEAM_TEST_TIMEOUT_MS)}}export{c as a,u as b,S as c};
