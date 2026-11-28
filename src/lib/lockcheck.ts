// Check a proposed version of a locked code file against the lock. The answer is a list of plain
// problems, empty when the change only fills in function bodies (and adds private helpers).
import { posix } from 'node:path';
import type { Lock } from '../formats/lock.ts';
import type { Plan } from '../formats/plan.ts';
import { fingerprintSource, parseProblem, parseSource } from './codeprint.ts';
import type { CodeLock } from './codeprint.ts';
import { importAllowed } from './importrules.ts';
import { analyzeSteps } from './stepprint.ts';
import { topLevelProblems } from './toplevel.ts';

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

/**
 * What a signature can lean on is fixed too: local types, classes, constants and what each import stands
 * for. A new one is fine (an exported one is caught as a new export); a changed or missing one is not.
 */
function fixedProblems(locked: CodeLock, now: CodeLock): string[] {
  return Object.entries(locked.fixed)
    .filter(([key, sig]) => own(now.fixed, key) !== sig && own(locked.exports, key.slice(key.indexOf(' ') + 1)) === undefined) // an exported one is reported as an export
    .map(([key]) => `${key} was changed or removed`);
}

const NAMES_A_TYPE = /^(?:type|interface|class|enum|import) /;

/**
 * A new type or import binding can't take a name that a locked signature or fixed thing uses as a type:
 * `handle(r: Response)` keeps its words when `interface Response {}` or `import { Response }` appears
 * above it. A new one with a name nothing locked uses is fine.
 */
function shadowProblems(locked: CodeLock, now: CodeLock): string[] {
  const used = new Set(locked.typeRefs);
  const names = Object.keys(now.fixed)
    .filter((key) => own(locked.fixed, key) === undefined && NAMES_A_TYPE.test(key))
    .map((key) => key.slice(key.indexOf(' ') + 1));
  return [...new Set(names.filter((name) => used.has(name)))].sort()
    .map((name) => `'${name}' is used by a locked signature, so a new declaration of it isn't allowed`);
}

function stepProblems(locked: CodeLock, now: CodeLock, ambiguous: readonly string[]): string[] {
  return Object.entries(locked.steps).flatMap(([fn, wanted]) => {
    const have = own(now.steps, fn) ?? [];
    const problems = ambiguous.includes(fn) ? [`more than one function is called '${fn}', so its steps can't be told apart`] : [];
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
 * A file that doesn't parse is reported as that and nothing else. Otherwise: the header, every
 * export's signature, the local types, the step markers of each function, the imports, and whatever
 * sits outside every function. New private helpers are fine; a new export is not. An empty list means
 * the change is allowed.
 */
export function checkAgainstLock(path: string, proposed: string, lock: Lock, plan: Plan): string[] {
  const key = posix.normalize(path.replace(/\\/g, '/'));
  const entry = own(lock.files, key);
  if (entry === undefined) return [`${key} isn't a file the lock covers`];
  if (entry.kind === 'whole') return [`${key} is locked whole and can't be changed`];
  const sf = parseSource(key, proposed);
  const broken = parseProblem(sf);
  if (broken !== null) return [broken];
  const steps = analyzeSteps(sf);
  const now = fingerprintSource(sf, steps);
  return [
    ...(entry.header === now.header ? [] : ['the header was changed']),
    ...exportProblems(entry, now),
    ...fixedProblems(entry, now),
    ...shadowProblems(entry, now),
    ...stepProblems(entry, now, steps.ambiguous),
    ...importProblems(key, entry, now, plan),
    ...topLevelProblems(sf),
  ];
}
