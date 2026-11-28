// R58: everything Windows runs by name is a code file, so the main AI cannot plant a `vitest.vbs` or `npm.com` that
// `npm test` (cmd.exe looks in the current folder first) would run. The default PATHEXT, plus the other launchers.
import { describe, expect, test } from 'vitest';
import { asMain } from '../helpers/app.ts';
import { isCodeFile } from '../../src/lib/paths.ts';
import { reasonOf, scene, writes } from '../helpers/decide.ts';
import { project } from '../helpers/project.ts';

const p = project();
const RUNNABLE = ['com', 'exe', 'bat', 'cmd', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msc', 'hta', 'scr', 'lnk', 'ps1'];

describe('R58: every default Windows PATHEXT extension, and the other launchers, are code files', () => {
  test.each(RUNNABLE)('.%s', (ext) => {
    expect(isCodeFile(`vitest.${ext}`)).toBe(true);
    expect(isCodeFile(`tools/x.${ext.toUpperCase()}`)).toBe(true);
    expect(isCodeFile(`vitest.${ext}.`)).toBe(true);
    expect(p.at(`vitest.${ext}`)).toBe('app-code');
    expect(p.at(`src/deep/vitest.${ext}`)).toBe('app-code');
  });
  test.each(RUNNABLE.filter((ext) => ext !== 'js').map((ext) => `vitest.${ext}x`).concat(RUNNABLE.map((ext) => `vitest.${ext}.txt`)))('%s is not', (path) => {
    expect(isCodeFile(path)).toBe(false);
  });
  test.each(['vitest.vbs', 'vitest.wsf', 'vitest.com', 'vitest.exe', 'vitest.hta', 'vitest.lnk', 'npm.cmd', 'node.exe'])(
    'the main AI cannot write %s at the app root (it is not in the plan)', async (rel) => {
      const s = await scene();
      expect(await reasonOf(writes(s, rel, 'x\n', asMain()))).toMatch(/not in the plan/);
    },
  );
  test('a launcher in a folder git ignores is still refused when it is in node_modules or build output', async () => {
    const s = await scene();
    expect(await reasonOf(writes(s, 'node_modules/.bin/vitest.cmd', 'x\n', asMain()))).toMatch(/node_modules and build output/);
  });
});
