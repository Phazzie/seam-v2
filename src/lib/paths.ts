// The one place the guard imports path logic from. The pieces live in three files so each stays
// small: realpath.ts (canonical spelling), registry.ts (project discovery and the project list),
// classify.ts (what kind of path it is).
export { classify, isCodeFile } from './classify.ts';
export type { PathClass } from './classify.ts';
export { rel, resolveReal } from './realpath.ts';
export { findProject, registerProject } from './registry.ts';
export type { ProjectLookup } from './registry.ts';
