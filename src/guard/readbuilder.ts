// What a builder may read. Only its own file, the contracts, the files its file imports, the type files of the
// planned packages and, when its file is a mock or an adapter, its own seam's fixtures; never a test. A Glob or
// Grep must have a `path` inside that, and a pattern that reaches out of it (an absolute one, or one that climbs
// with `..`) is refused. The order of the checks: tests first (so the refusal says why), then whose turn it is,
// then the allowlist, place by place.
import { basename, dirname, posix, resolve } from 'node:path';
import type { FilePlan, SeamPlan } from '../formats/plan.ts';
import { classify, rel, resolveReal } from '../lib/paths.ts';
import type { PathClass } from '../lib/paths.ts';
import type { Ctx, Decision, HookInput } from '../types.ts';
import type { Look } from './readlook.ts';
import * as why from './readwhy.ts';

const ALLOW: Decision = { kind: 'allow' };
const deny = (reason: string): Decision => ({ kind: 'deny', reason });

/** `ok`: readable. `types`: a folder of a planned package, searchable only for its `.d.ts` files. `no`: not readable. */
type Verdict = 'ok' | 'types' | 'no';

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\//i;
/** A pattern that names tests: a `.test` or `.spec` part (also in braces), or a `tests`, `test` or `__tests__` folder. */
const TEST_FILTER = /(?:^|[\\/])(?:tests?|__tests__)(?:[\\/]|$)|\.(?:\{[^}]*)?\b(?:test|spec)\b/i;
const TYPE_FILE = /\.d\.[cm]?ts$/i;
const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const RELATIVE = /^\.\.?(?:\/|$)/;
/** Where the probe script keeps a fixture module: `fixtures/<name>` or `probes/fixtures/<name>`. */
const FIXTURE = /^(?:probes\/)?fixtures\/(.+)$/;
const bare = (path: string): string => path.replace(SCRIPT, '');

/** The planned file this builder is filling, and the seam it is in. The plan's paths may be from the repo or from the app folder (as in importrules.ts). */
function ownEntry(ctx: Ctx, turnFile: string): { file: FilePlan; seam: SeamPlan } | null {
  const turn = posix.normalize(turnFile.replace(/\\/g, '/'));
  const appRoot = (ctx.plan?.appRoot ?? '.').replace(/\\/g, '/');
  for (const seam of ctx.plan?.seams ?? []) {
    const file = seam.files.find((f) => posix.normalize(f.path) === turn || posix.join(appRoot, f.path) === turn);
    if (file !== undefined) return { file, seam };
  }
  return null;
}

/** Is `p` a file the planned file imports? A relative import is from its folder; a folder import stands for its index file. */
function isImported(ctx: Ctx, turnFile: string, imports: readonly string[], p: string): boolean {
  const from = dirname(resolve(ctx.root, turnFile));
  return imports.filter((spec) => RELATIVE.test(spec)).some((spec) => {
    const target = resolveReal(from, spec);
    const named = basename(spec).includes('.');
    return (p === target && named) || (p !== target && bare(p) === bare(target)) || (dirname(p) === bare(target) && bare(basename(p)) === 'index');
  });
}

/** Is `p` in a fixtures folder, under a name that is this seam's (`orders`, `orders.ts`, `orders-list.ts`, `orders/page.ts`)? */
function isOwnFixture(ctx: Ctx, seam: string, p: string): boolean {
  const root = resolveReal(ctx.root, '.');
  const appDir = resolveReal(root, ctx.appRoot || '.');
  return [rel(root, p), rel(appDir, p)].some((inside) => {
    const name = FIXTURE.exec(inside ?? '')?.[1].split('/')[0].split('.')[0] ?? '';
    return name === seam || name.startsWith(`${seam}-`) || name.startsWith(`${seam}_`);
  });
}

/** `@scope/kit` has its types in `@types/scope__kit`; `react` in `@types/react`. */
const typesFolder = (pkg: string): string => `@types/${pkg.startsWith('@') ? pkg.slice(1).replace('/', '__') : pkg}`;

/** `node_modules/**` of a planned package: its `.d.ts` files are readable, and the folder is searchable for them. */
function inPlannedPackage(ctx: Ctx, p: string, searching: boolean): Verdict {
  const parts = p.split('/');
  const at = parts.lastIndexOf('node_modules');
  if (at === -1) return 'no';
  const inside = parts.slice(at + 1).join('/').toLowerCase();
  const folders = (ctx.plan?.packages ?? []).flatMap((pkg) => [pkg, typesFolder(pkg)]).map((folder) => folder.toLowerCase());
  if (!folders.some((folder) => inside === folder || inside.startsWith(`${folder}/`))) return 'no';
  if (TYPE_FILE.test(inside)) return 'ok';
  return searching ? 'types' : 'no';
}

/** What a builder whose turn it is may read: its file, what the plan gives it, and where it is. */
interface Allowed {
  ctx: Ctx;
  turnFile: string;
  ownReal: string;
  own: { file: FilePlan; seam: SeamPlan } | null;
  classOf: (p: string) => PathClass;
}

/** May the builder read (or search) `place`? */
function verdictOf(a: Allowed, place: string, searching: boolean): Verdict {
  if (place === a.ownReal || a.classOf(place) === 'contracts') return 'ok';
  if (a.own !== null && isImported(a.ctx, a.turnFile, a.own.file.imports, place)) return 'ok';
  if (a.own !== null && (a.own.file.kind === 'mock' || a.own.file.kind === 'adapter') && isOwnFixture(a.ctx, a.own.seam.id, place)) return 'ok';
  return inPlannedPackage(a.ctx, place, searching);
}

/** The decision for a builder's Read, Glob or Grep. `look` says where the call goes (readlook.ts). */
export function decideBuilderRead(input: HookInput, ctx: Ctx, look: Look): Decision {
  const { file: turnFile, agentId } = ctx.state.turn;
  const ownReal = turnFile === null ? null : resolveReal(ctx.root, turnFile);
  const classes = new Map<string, PathClass>();
  const classOf = (p: string): PathClass => {
    let known = classes.get(p);
    if (known === undefined) {
      known = classify(ctx, p);
      classes.set(p, known);
    }
    return known;
  };
  const places = [...look.roots, ...look.reaches];
  if (look.filter !== undefined && TEST_FILTER.test(look.filter)) return deny(why.BUILDER_TESTS);
  const repo = resolveReal(ctx.root, '.');
  if (places.some((p) => p !== ownReal && (classOf(p) === 'tests' || TEST_FILE.test(rel(repo, p) ?? p)))) return deny(why.BUILDER_TESTS);
  if (turnFile === null || ownReal === null || typeof input.agent_id !== 'string' || input.agent_id !== agentId) return deny(why.NOT_ITS_TURN);
  if (look.roots.length === 0) return deny(look.searching ? why.NEEDS_PATH : why.NO_FILE);
  const allowed: Allowed = { ctx, turnFile, ownReal, own: ownEntry(ctx, turnFile), classOf };
  const typesOnly = look.filter !== undefined && TYPE_FILE.test(look.filter.split(/[\\/]/).at(-1) ?? '');
  for (const place of places) {
    const verdict = verdictOf(allowed, place, look.searching);
    if (verdict === 'no') return deny(look.roots.includes(place) ? why.notReadable((rel(repo, place) ?? place) || '.') : why.patternEscapes(look.filter ?? ''));
    if (verdict === 'types' && !typesOnly) return deny(why.TYPES_ONLY);
  }
  return look.unfollowable ? deny(why.patternEscapes(look.filter ?? '')) : ALLOW;
}
