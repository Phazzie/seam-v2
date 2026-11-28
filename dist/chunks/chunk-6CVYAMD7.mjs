import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{a as r,e as t}from"./chunk-KOCL7EPX.mjs";var o=".seam/lock.json",i=r.discriminatedUnion("kind",[r.strictObject({kind:r.literal("code"),header:r.string(),exports:r.record(r.string(),r.string()),fixed:r.record(r.string(),r.string()),typeRefs:r.array(r.string()),steps:r.record(r.string(),r.array(r.string())),plannedImports:r.array(r.string())}),r.strictObject({kind:r.literal("whole"),hash:r.string()})]),n=r.strictObject({version:r.literal(1),files:r.record(r.string(),i)});function p(e){return t(n,e,o)}export{o as a,p as b};
