// The two "builder code may not" rules: process.env outside src/config, and fs / require / dynamic
// import (with eval and the Function constructor, which reach the same places).
import { describe, expect, test } from 'vitest';
import { codeRuleProblems } from '../../src/lib/rules.ts';

const check = (text: string, path = 'src/app/x.ts'): string[] => codeRuleProblems(path, text);
const ENV = ['reads process.env outside src/config'];
const BANNED = ['uses fs/require/dynamic import, which builder code may not'];

describe('process.env', () => {
  test.each([
    'const a = process.env.HOME;', "const a = process['env'].HOME;", 'const { env } = process;', 'const { env: e } = process;',
    'const a = globalThis.process.env;', 'const a = process?.env.X;', "import { env } from 'node:process';",
    "import { env as e } from 'process';", 'const a = (process as NodeJS.Process).env;', 'const a = process!.env;',
    'const e = process.env;', 'const { a, env = {} } = process;',
  ])('%s is refused', (src) => expect(check(src)).toEqual(ENV));

  test.each([
    'const a = process.cwd();', '// process.env.HOME', "const s = 'process.env';", 'const env = { a: 1 }; const a = env.a;',
    "import { env } from './config/env.ts';", 'const a = config.process.env;', 'const { cwd } = process;', 'const a = x.env;',
    "import process from 'node:process';\nconst a = process.platform;",
  ])('%s is fine', (src) => expect(check(src)).toEqual([]));

  test.each(['src/config/env.ts', 'src/config/deep/env.ts', './src/config/env.ts', 'src\\config\\env.ts', 'src/config/../config/env.ts'])(
    'it is allowed in %s', (path) => expect(check('export const home = process.env.HOME;', path)).toEqual([]),
  );

  test.each(['src/configs/x.ts', 'src/config.ts', 'src/other/config/x.ts', 'src/config/../x.ts', 'config/x.ts', 'SRC/config/x.ts', 'x.ts'])(
    'it is refused in %s', (path) => expect(check('export const home = process.env.HOME;', path)).toEqual(ENV),
  );
});

describe('fs, require and dynamic import', () => {
  test.each([
    "import fs from 'fs';", "import * as fs from 'node:fs';", "import { readFile } from 'fs/promises';",
    "import { readFile } from 'node:fs/promises';", "export * from 'fs';", "import 'node:fs';", "import type { Stats } from 'fs';",
    "const x = require('fs');", "const x = require('./x');", "const x = module.require('x');", "import x = require('x');",
    "void import('./x');", 'const m = await import(name);', "import { createRequire } from 'node:module';",
    "import { createRequire } from 'module';", "eval('1');", "new Function('return 1');", "Function('return 1')();",
    'const r = require;', "process.binding('fs');", "process.mainModule!.require('fs');", "const { binding } = process;",
  ])('%s is refused', (src) => expect(check(src)).toEqual(BANNED));

  test.each([
    "import path from 'node:path';", "import { z } from 'zod';", "import x from './x.ts';", "import type { A } from './a.ts';",
    "import x from 'fsevents';", "import x from './fs';", 'const require2 = 1;', 'const o = { require: true };',
    'interface O { require: boolean }', 'const a = o.require;', "// require('fs')", "const s = \"import('fs')\";",
    "const s = `require('fs')`;", 'const a = { eval: 1 }; a.eval;', 'const f = (x: unknown) => x instanceof Function;',
    "import x from 'fs-like';", 'const a = process.platform;',
  ])('%s is fine', (src) => expect(check(src)).toEqual([]));

  test('the reason names what is banned, for each way in', () => {
    expect(check("const fs = require('fs');")[0]).toMatch(/\brequire\b/);
    expect(check("void import('fs');")[0]).toMatch(/dynamic import/);
    expect(check("import * as fs from 'node:fs';\nfs.writeFileSync('x', 'y');")[0]).toMatch(/fs\/require\/dynamic import/);
  });
});
