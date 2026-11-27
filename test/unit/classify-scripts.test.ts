// R54: files that make something run code or steer the AI, which the main AI must not write. Script and
// framework files are code (so "not in the plan" refuses them); the folders and files that run things at commit,
// build or editor time are config; the instruction files are Claude config in any folder, not only at the top.
import { describe, expect, test } from 'vitest';
import { asMain } from '../helpers/app.ts';
import { isCodeFile } from '../../src/lib/paths.ts';
import { reasonOf, scene, writes } from '../helpers/decide.ts';
import { project } from '../helpers/project.ts';

const p = project();

describe('R54: script and framework files are code files', () => {
  test.each(['run.sh', 'scripts/setup.ps1', 'build.bat', 'x.cmd', 'tools/gen.py', 'src/App.vue', 'src/Card.svelte', 'src/pages/index.astro', 'SCRIPTS/RUN.SH', 'a.sh.'])(
    '%s is code', (path) => expect(isCodeFile(path)).toBe(true),
  );
  test.each(['a.shx', 'a.pyc', 'a.sh.md', 'a.bat.txt', 'sh', 'a.vuex', 'a.astro.json.txt', 'notes.cmd.bak'])('%s is not', (path) => {
    expect(isCodeFile(path)).toBe(false);
  });
  test.each(['src/run.sh', 'src/setup.ps1', 'src/x.bat', 'src/x.cmd', 'src/gen.py', 'src/App.vue', 'src/Card.svelte', 'src/index.astro'])(
    '%s is app code to the classifier', (path) => expect(p.at(path)).toBe('app-code'),
  );
  test.each(['src/evil.sh', 'src/evil.ps1', 'src/evil.py', 'src/Evil.vue'])('the main AI cannot write %s (it is not in the plan)', async (rel) => {
    const s = await scene();
    expect(await reasonOf(writes(s, rel, 'x\n', asMain()))).toMatch(/not in the plan/);
  });
});

describe('R54: the folders and files that run things are config files', () => {
  test.each([
    '.husky/pre-commit', '.husky/_/husky.sh', '.github/workflows/ci.yml', '.github/CODEOWNERS', '.vscode/tasks.json', '.vscode/settings.json',
    '.devcontainer/devcontainer.json', 'Makefile', 'GNUmakefile', 'makefile', 'sub/Makefile', '.prettierrc', '.prettierrc.json', '.prettierrc.cjs',
    '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', 'bunfig.toml', 'pnpm-workspace.yaml', 'packages/a/pnpm-workspace.yaml',
  ])('%s', (path) => expect(p.at(path)).toBe('config-file'));

  test('the folders count at any depth, whatever the letter case', () => {
    for (const path of ['packages/app/.husky/pre-push', 'src/.vscode/tasks.json', 'a/b/.github/x.yml', '.GITHUB/workflows/ci.yml', '.Husky/pre-commit']) {
      expect(p.at(path)).toBe('config-file');
    }
  });

  test.each(['.husky.md', 'husky/pre-commit', 'github/workflows/ci.yml', 'vscode/x.json', 'src/Makefile.md', 'Makefile.bak', 'bunfig.json', 'pnpm-workspace.json', 'src/prettierrc.ts'])(
    '%s is not one of them', (path) => expect(p.at(path)).not.toBe('config-file'),
  );

  test('a script in .husky is a config file first, not code', () => expect(p.at('.husky/pre-commit.sh')).toBe('config-file'));

  test.each(['.husky/pre-commit', '.github/workflows/ci.yml', '.vscode/tasks.json', '.devcontainer/devcontainer.json', 'Makefile', '.prettierrc', '.eslintrc.cjs', 'bunfig.toml', 'pnpm-workspace.yaml'])(
    'the main AI cannot write %s', async (rel) => {
      const s = await scene();
      expect(await reasonOf(writes(s, rel, 'x\n', asMain()))).toMatch(/config files are frozen/);
    },
  );
});

describe('R54: the instruction files are Claude config in any folder', () => {
  test.each(['CLAUDE.md', 'docs/CLAUDE.md', 'src/AGENTS.md', 'packages/a/b/AGENTS.project.md', 'src/deep/er/claude.md', 'A/Agents.Project.MD'])(
    '%s is claude-config', (path) => expect(p.at(path)).toBe('claude-config'),
  );
  test.each(['README.md', 'docs/CLAUDE.md.bak', 'src/MYCLAUDE.md', 'src/AGENTS.local.md', 'docs/CLAUDE.mdx', 'CLAUDE/notes.md', 'src/claude-notes.md'])(
    '%s is not', (path) => expect(p.at(path)).not.toBe('claude-config'),
  );
  test('the app folder and the repo both count', () => {
    const q = project({ appRoot: 'seam-app' });
    expect(q.at('seam-app/src/CLAUDE.md')).toBe('claude-config');
    expect(q.at('seam-app/AGENTS.md')).toBe('claude-config');
  });
  test('every role is refused, with the reason said', async () => {
    const s = await scene();
    expect(await reasonOf(writes(s, 'src/deep/AGENTS.md', 'x\n', asMain()))).toMatch(/protected/);
  });
});
