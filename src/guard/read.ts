// decideRead: who may read what (the role table). Every Read, Glob and Grep comes here. It reads no code and
// loads no parser (R29): a read is decided by where it goes and who is asking.
//   1. an env file (`.env`, `.env.*`, but not `.env.example`) is refused for every role, the main AI too, so
//      secrets stay out of the AI's context (R55). That covers naming the file, a Glob pattern or Grep glob that
//      could match it, and an absolute pattern that goes straight to it;
//   2. a builder reads its allowlist only, never a test (readbuilder.ts);
//   3. a describer reads only the comment-stripped copy under .seam/review;
//   4. everyone else (main, surveyor, checker, design, read-only agents) reads freely.
import { basename } from 'node:path';
import { rel, resolveReal } from '../lib/paths.ts';
import { roleOf } from '../lib/roles.ts';
import type { Ctx, Decision, HookInput } from '../types.ts';
import { decideBuilderRead } from './readbuilder.ts';
import { lookOf } from './readlook.ts';
import type { Look } from './readlook.ts';
import * as why from './readwhy.ts';

const ALLOW: Decision = { kind: 'allow' };
const deny = (reason: string): Decision => ({ kind: 'deny', reason });

/** The name of an env file: `.env` and `.env.<anything>`. */
const ENV_FILE = /^\.env(?:\..*)?$/i;
/** A pattern that can match one: `.env`, `.env*`, `.env.local`, `**.env`, or one of several in braces (not `.envrc` or `.environment`). */
const ENV_PATTERN = /(?:^|[{,])\*{0,2}\.env(?![\w-])/i;
const EXAMPLE = /^\.env\.example$/i;
/** Where the stage 3 script puts the stripped copy a describer reads. */
const REVIEW = '.seam/review';

/** Does the call name an env file, by its path or in a pattern that could match one? */
function namesEnvFile(look: Look): boolean {
  const named = [...look.roots, ...look.reaches].map((place) => basename(place));
  const pattern = look.filter?.split(/[\\/]/).at(-1) ?? '';
  return named.some((name) => ENV_FILE.test(name) && !EXAMPLE.test(name)) || (ENV_PATTERN.test(pattern) && !EXAMPLE.test(pattern));
}

/** A describer reads only inside the review folder, and a search of it must say where. */
function decideDescriberRead(ctx: Ctx, look: Look): Decision {
  if (look.roots.length === 0) return deny(look.searching ? why.DESCRIBER_NEEDS_PATH : why.NO_FILE);
  const root = resolveReal(ctx.root, '.');
  const folder = resolveReal(root, REVIEW);
  const outside = [...look.roots, ...look.reaches].find((place) => rel(folder, place) === null);
  if (outside !== undefined) return deny(why.describerOnly((rel(root, outside) ?? outside) || '.'));
  return look.unfollowable ? deny(why.describerOnly(look.filter ?? '')) : ALLOW;
}

/** May this tool call read or search what it names? A refusal says why, in plain words. */
export function decideRead(input: HookInput, ctx: Ctx): Decision {
  const look = lookOf(input);
  if (namesEnvFile(look)) return deny(why.ENV_FILES);
  switch (roleOf(input)) {
    case 'builder': return decideBuilderRead(input, ctx, look);
    case 'describer': return decideDescriberRead(ctx, look);
    default: return ALLOW;
  }
}
