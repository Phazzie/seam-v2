// An export that is made with an imported name (`memo(...)`) leans on that import, but only on the one binding it uses:
// a builder who adds `useState` to the same import line has not changed what the export is. Changing where `memo`
// comes from, or what it is called, is still a change.
import { describe, expect, test } from 'vitest';
import { fingerprintCode } from '../../src/lib/fingerprint.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { P, lockOf, plan } from '../helpers/lockcheck.ts';

/** What `memo` wraps: a component with a typed parameter. */
const ARGS = '(props: { label: string }) => { return props.label; }';

/** The four ways a component built with `memo` can be exported; each takes the import line it is written with and the name it calls `memo`. */
const SHAPES: Record<string, { src: (imports: string, memo?: string) => string; name: string }> = {
  'export default of a constant': { name: 'default', src: (i, m = 'memo') => `${i}\nconst Inner = ${m}(${ARGS});\nexport default Inner;` },
  'an export clause': { name: 'Inner', src: (i, m = 'memo') => `${i}\nconst Inner = ${m}(${ARGS});\nexport { Inner };` },
  'an alias exported renamed': { name: 'Comp', src: (i, m = 'memo') => `${i}\nconst Inner = ${m}(${ARGS});\nconst Alias = Inner;\nexport { Alias as Comp };` },
  'an exported constant': { name: 'Comp', src: (i, m = 'memo') => `${i}\nexport const Comp = ${m}(${ARGS});` },
};

const SKELETON_IMPORT = "import { memo } from 'react';";

describe.each(Object.entries(SHAPES))('%s', (_label, { src, name }) => {
  const lock = lockOf(src(SKELETON_IMPORT));
  const verdict = (imports: string, memo?: string): string[] => checkAgainstLock(P, src(imports, memo), lock, plan);

  test.each([
    ['useState added to the import', "import { memo, useState } from 'react';"],
    ['useState added in front of it', "import { useState, memo } from 'react';"],
    ['several names added, over lines', "import {\n  memo,\n  useEffect,\n  useState,\n} from 'react';"],
    ['a second import line from the same module', "import { memo } from 'react';\nimport { useState } from 'react';"],
    ['a default import added', "import React, { memo } from 'react';"],
    ['a type added to it', "import { memo, type ReactNode } from 'react';"],
  ])('growing the react import is not a change: %s', (_what, imports) => {
    expect(verdict(imports)).toEqual([]);
  });

  test('the same fingerprint is kept for the export when only the import grows', () => {
    const before = fingerprintCode(P, src(SKELETON_IMPORT)).exports[name];
    expect(fingerprintCode(P, src("import { memo, useState } from 'react';")).exports[name]).toBe(before);
  });

  test('memo coming from another module is caught', () => {
    expect(verdict("import { memo } from 'preact/compat';")).toContain(`export ${name}'s signature changed`);
    expect(verdict("import { memo, useState } from 'preact/compat';")).toContain(`export ${name}'s signature changed`);
  });

  test('memo renamed on the way in is caught', () => {
    expect(verdict("import { memo as m } from 'react';", 'm')).toContain(`export ${name}'s signature changed`);
    expect(verdict("import { useState as memo } from 'react';")).toContain(`export ${name}'s signature changed`);
  });

  test('memo imported as a different kind of import is caught', () => {
    expect(verdict("import memo from 'react';")).toContain(`export ${name}'s signature changed`);
    expect(verdict("import * as memo from 'react';")).toContain(`export ${name}'s signature changed`);
  });
});
