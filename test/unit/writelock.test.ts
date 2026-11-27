import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadLock } from '../../src/formats/lock.ts';
import { loadPlan, parsePlan } from '../../src/formats/plan.ts';
import type { Plan } from '../../src/formats/plan.ts';
import { fingerprintCode, hash, writeLock } from '../../src/lib/fingerprint.ts';
import { FIXTURE, TOTAL, planFile, skeleton } from '../helpers/code.ts';
import { put, tempDir } from '../helpers/project.ts';

const GREETING = 'src/greeting/Greeting.tsx';
const plan = loadPlan(FIXTURE)!;
const total = planFile(TOTAL);
const greeting = planFile(GREETING);

/** A seam project folder holding the practice plan and a skeleton for every planned file. */
function app(thePlan: Plan = plan, prefix = ''): string {
  const root = tempDir();
  cpSync(FIXTURE, root, { recursive: true });
  mkdirSync(join(root, '.seam'));
  for (const seam of thePlan.seams) for (const f of seam.files) put(root, `${prefix}${f.path}`, skeleton(seam.id, f));
  return root;
}
const planWith = (changes: Record<string, unknown>): Plan => parsePlan({ ...plan, ...changes });

describe('writeLock', () => {
  test('writes .seam/lock.json: code files by named item, the plan whole', () => {
    const root = app();
    const lock = writeLock(root, plan);
    expect(Object.keys(lock.files).sort()).toEqual(['plan/plan.json', GREETING, TOTAL].sort());
    expect(lock.files[TOTAL]).toEqual(fingerprintCode(TOTAL, skeleton(total.seam, total.file)));
    expect(lock.files[GREETING]).toEqual(fingerprintCode(GREETING, skeleton(greeting.seam, greeting.file)));
    expect(lock.files['plan/plan.json']).toEqual({ kind: 'whole', hash: hash(readFileSync(join(root, 'plan/plan.json'), 'utf8')) });
    expect(loadLock(root)).toEqual(lock);
  });

  test('the file on disk is valid JSON the lock reader accepts, and nothing else is left in .seam', () => {
    const root = app();
    writeLock(root, plan);
    expect(readdirSync(join(root, '.seam'))).toEqual(['lock.json']);
    expect(readFileSync(join(root, '.seam/lock.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  test('locking twice gives the same lock, and a rewrite replaces the old one', () => {
    const root = app();
    const first = writeLock(root, plan);
    put(root, 'contracts/pricing.json', '{}\n');
    const second = writeLock(root, plan);
    expect(Object.keys(second.files)).toContain('contracts/pricing.json');
    expect(writeLock(root, plan)).toEqual(second);
    expect(Object.keys(first.files)).not.toContain('contracts/pricing.json');
  });

  test('contracts, tests and fixtures are locked whole, at any depth', () => {
    const root = app();
    put(root, 'contracts/pricing.json', '{"a":1}\n');
    put(root, 'tests/unit/total.test.ts', 'test();\n');
    put(root, 'fixtures/data/cart.csv', 'a,b\n');
    put(root, 'test/helpers/x.ts', 'x\n');
    const lock = writeLock(root, plan);
    for (const path of ['contracts/pricing.json', 'tests/unit/total.test.ts', 'fixtures/data/cart.csv', 'test/helpers/x.ts']) {
      expect(lock.files[path], path).toEqual({ kind: 'whole', hash: hash(readFileSync(join(root, path), 'utf8')) });
    }
  });

  test('node_modules and .git inside a frozen folder are left out', () => {
    const root = app();
    put(root, 'tests/node_modules/pkg/index.js', 'x\n');
    put(root, 'tests/.git/config', 'x\n');
    put(root, 'tests/a.test.ts', 'x\n');
    expect(Object.keys(writeLock(root, plan).files)).toContain('tests/a.test.ts');
    expect(Object.keys(writeLock(root, plan).files).filter((p) => /node_modules|\.git/.test(p))).toEqual([]);
  });

  test('config files named in the plan are locked whole when they exist, and skipped when they do not', () => {
    const root = app();
    put(root, 'package.json', '{"name":"x"}\n');
    const lock = writeLock(root, plan);
    expect(lock.files['package.json']).toEqual({ kind: 'whole', hash: hash('{"name":"x"}\n') });
    expect(Object.keys(lock.files)).not.toContain('tsconfig.json');
  });

  test('a config folder in the plan locks everything under it', () => {
    const root = app();
    put(root, 'config/a.json', '1\n');
    put(root, 'config/deep/b.json', '2\n');
    expect(Object.keys(writeLock(root, planWith({ config: ['config'] })).files)).toEqual(
      expect.arrayContaining(['config/a.json', 'config/deep/b.json']));
  });

  test('line endings do not change a whole-file hash, but binary content is hashed as it is', () => {
    const root = app();
    put(root, 'contracts/a.json', '{\n"a":1\n}\n');
    put(root, 'contracts/b.json', '{\r\n"a":1\r\n}\r\n');
    mkdirSync(join(root, 'fixtures'), { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x00, 0x0d, 0x0a, 0xff]);
    writeFileSync(join(root, 'fixtures/logo.png'), bytes);
    const { files } = writeLock(root, plan);
    expect(files['contracts/a.json']).toEqual(files['contracts/b.json']);
    expect(files['fixtures/logo.png']).toEqual({ kind: 'whole', hash: createHash('sha256').update(bytes).digest('hex') });
  });

  test('a planned code file that is missing is a plain error naming it', () => {
    const root = app();
    rmSync(join(root, TOTAL));
    expect(() => writeLock(root, plan)).toThrow(`${TOTAL} is in the plan but isn't on disk, so it can't be locked.`);
    expect(existsSync(join(root, '.seam/lock.json'))).toBe(false);
  });

  test('a plan file that is missing is a plain error, not a lock without it', () => {
    const root = app();
    rmSync(join(root, 'plan'), { recursive: true });
    expect(() => writeLock(root, plan)).toThrow("plan/plan.json is missing, so the plan can't be locked.");
  });

  test('a planned path that points outside the project is refused', () => {
    const root = app();
    const elsewhere = tempDir();
    put(elsewhere, 'x.ts', 'x\n');
    const outside = relative(root, join(elsewhere, 'x.ts')).replace(/\\/g, '/');
    const out = planWith({ seams: [{ ...plan.seams[0], files: [{ ...total.file, path: outside }] }] });
    expect(outside.startsWith('../')).toBe(true);
    expect(() => writeLock(root, out)).toThrow(/isn't inside the project folder/);
  });

  test('a folder that is not a seam project is refused', () => {
    const root = app();
    rmSync(join(root, '.seam'), { recursive: true });
    expect(() => writeLock(root, plan)).toThrow(/seam records folder is missing/);
  });

  test('a planned data file (not a script) is locked whole', () => {
    const data = planWith({ seams: [{ ...plan.seams[0], files: [...plan.seams[0].files, { ...total.file, path: 'src/pricing/rates.json', kind: 'code' }] }] });
    const root = app();
    put(root, 'src/pricing/rates.json', '{"a":1}\n');
    expect(writeLock(root, data).files['src/pricing/rates.json']).toEqual({ kind: 'whole', hash: hash('{"a":1}\n') });
  });

  test('a plan with an app folder finds the files there and names them from the repo root', () => {
    const inApp = planWith({ appRoot: 'seam-app' });
    const root = app(inApp, 'seam-app/');
    put(root, 'src/pricing/total.ts', 'legacy();\n');
    put(root, 'seam-app/tests/a.test.ts', 'x\n');
    const lock = writeLock(root, inApp);
    expect(Object.keys(lock.files).sort()).toEqual(
      ['plan/plan.json', 'seam-app/src/greeting/Greeting.tsx', 'seam-app/src/pricing/total.ts', 'seam-app/tests/a.test.ts'].sort());
    expect(lock.files['seam-app/src/pricing/total.ts']).toEqual(fingerprintCode(TOTAL, skeleton(total.seam, total.file)));
  });
});
