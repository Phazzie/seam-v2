// The silent-catch rule. A catch is silent unless it throws, or really uses the error it caught.
// `return` alone does not count (a catch that hands back a default has still swallowed the error), and
// neither does `void e;` or a bare `e;`. A throw inside a nested function does not leave the catch.
import { describe, expect, test } from 'vitest';
import { codeRuleProblems } from '../../src/lib/rules.ts';

const check = (body: string): string[] => codeRuleProblems('src/app/x.ts', body);
const tryCatch = (catchPart: string): string => `try { f(); } ${catchPart}\n`;
const SILENT = ['has a silent catch'];

describe('a silent catch', () => {
  test.each([
    'catch {}', 'catch (e) {}', 'catch (e) { /* ignore */ }', 'catch { return null; }', 'catch (e) { return 0; }',
    "catch (e) { console.log('failed'); }", 'catch (e) { void e; }', 'catch (e) { e; }', 'catch (e) { x.e = 1; }',
    'catch (e) { const y = { e: 1 }; }', 'catch (e) { setTimeout(() => { throw new Error("x"); }); }',
    'catch ({ message }) { log(1); }', 'catch (e) { if (ok) { return 1; } }',
  ])('%s is refused', (c) => expect(check(tryCatch(c))).toEqual(SILENT));

  test.each([
    'catch (e) { throw e; }', "catch { throw new Error('x'); }", 'catch (e) { console.error(e); }',
    'catch (e) { return fallback(e); }', 'catch ({ message }) { log(message); }', "catch (e) { if (!ok) throw new Error('x'); }",
    'catch (e) { list.forEach(() => log(e)); }', 'catch (e) { log({ e }); }', 'catch (e) { log(e.message); }',
    'catch (e: unknown) { return e instanceof Error ? e.message : "?"; }',
  ])('%s is fine', (c) => expect(check(tryCatch(c))).toEqual([]));

  test('a try with only a finally has no catch to judge', () => {
    expect(check('try { f(); } finally { g(); }\n')).toEqual([]);
  });

  test('the words in a comment or a string do not count', () => {
    expect(check("// catch (e) {}\nconst s = 'catch {}';\n")).toEqual([]);
  });

  test('one loud catch does not excuse a silent one', () => {
    expect(check(`${tryCatch('catch (e) { throw e; }')}${tryCatch('catch {}')}`)).toEqual(SILENT);
  });
});

describe('a silent promise catch', () => {
  test.each([
    'p.catch(() => {})', 'p.catch(() => null)', 'p.catch((e) => { return 0; })', 'p?.catch(function () {})',
    'p.then(ok).catch(() => undefined)',
  ])('%s is refused', (src) => expect(check(`${src};\n`)).toEqual(SILENT));

  test.each([
    'p.catch((e) => { throw e; })', 'p.catch((e) => log(e))', 'p.catch(handle)', 'p.catch(() => { throw new Error("x"); })',
    'p.catch(function (e) { report(e); })', 'p.then(ok)', 'p.catchy(() => {})', 'catchy(() => {})',
  ])('%s is fine', (src) => expect(check(`${src};\n`)).toEqual([]));
});
