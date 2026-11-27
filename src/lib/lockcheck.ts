// Check a proposed version of a locked code file against the lock. The answer is a list of plain
// problems, empty when the change only fills in function bodies (and adds private helpers).
import { posix } from 'node:path';
import type { Lock } from '../formats/lock.ts';
import type { Plan } from '../formats/plan.ts';
import { fingerprintCode } from './codeprint.ts';
import type { CodeLock } from './codeprint.ts';
import { importAllowed } from './importrules.ts';

const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

function exportProblems(locked: CodeLock, now: CodeLock): string[] {
  const changed = Object.entries(locked.exports).map(([name, sig]) => {
    const current = own(now.exports, name);
    if (current === undefined) return `export ${name} was removed`;
    return current === sig ? null : `export ${name}'s signature changed`;
  });
  const added = Object.keys(now.exports).filter((name) => own(locked.exports, name) === undefined).map((name) => `new export '${name}' isn't in the plan`);
  return [...changed.filter((p): p is string => p !== null), ...added];
}

function stepProblems(locked: CodeLock, now: CodeLock): string[] {
  return Object.entries(locked.steps).flatMap(([fn, wanted]) => {
    const have = own(now.steps, fn) ?? [];
    const problems: string[] = [];
    for (let i = 0; i < Math.max(wanted.length, have.length); i += 1) {
      if (wanted[i] === have[i]) continue;
      problems.push(wanted[i] === undefined ? `step ${i + 1} in ${fn} isn't in the plan` : `step ${i + 1} in ${fn} was changed or removed`);
    }
    return problems;
  });
}

function importProblems(path: string, locked: CodeLock, now: CodeLock, plan: Plan): string[] {
  const removed = locked.plannedImports.filter((spec) => !now.plannedImports.includes(spec)).map((spec) => `the planned import of '${spec}' was removed`);
  const added = now.plannedImports
    .filter((spec) => !locked.plannedImports.includes(spec) && !importAllowed(spec, path, plan))
    .map((spec) => `import of '${spec}' isn't in the plan`);
  return [...removed, ...added];
}

/**
 * What is wrong with `proposed` as the new text of the file at `path` (a path from the repo root)?
 * Checks the header, every export's signature, the step markers of each function, and the imports.
 * New private helpers are fine; a new export is not. An empty list means the change is allowed.
 */
export function checkAgainstLock(path: string, proposed: string, lock: Lock, plan: Plan): string[] {
  const key = posix.normalize(path.replace(/\\/g, '/'));
  const entry = own(lock.files, key);
  if (entry === undefined) return [`${key} isn't a file the lock covers`];
  if (entry.kind === 'whole') return [`${key} is locked whole and can't be changed`];
  const now = fingerprintCode(key, proposed);
  return [
    ...(entry.header === now.header ? [] : ['the header was changed']),
    ...exportProblems(entry, now),
    ...stepProblems(entry, now),
    ...importProblems(key, entry, now, plan),
  ];
}
