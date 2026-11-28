import { createRequire as __seamCreateRequire } from 'node:module';
import { fileURLToPath as __seamFileURLToPath } from 'node:url';
import { dirname as __seamDirname } from 'node:path';
const require = __seamCreateRequire(import.meta.url);
const __filename = __seamFileURLToPath(import.meta.url);
const __dirname = __seamDirname(__filename);
import{a as t,d as e,e as o}from"./chunk-HHZDTERO.mjs";var s=".seam/env.json",c=t.strictObject({dataDir:t.string().min(1),appRoot:t.string().optional(),legacyRoot:t.string().optional()}),d=r=>o(c,r,s);var a=".seam/lock.json",p=t.discriminatedUnion("kind",[t.strictObject({kind:t.literal("code"),header:t.string(),exports:t.record(t.string(),t.string()),fixed:t.record(t.string(),t.string()),typeRefs:t.array(t.string()),steps:t.record(t.string(),t.array(t.string())),plannedImports:t.array(t.string())}),t.strictObject({kind:t.literal("whole"),hash:t.string()})]),n=t.strictObject({version:t.literal(1),files:t.record(t.string(),p)});function h(r,i="the lock"){return e(n,r,i)}function x(r){return o(n,r,a)}export{s as a,d as b,a as c,h as d,x as e};
