// R36: a marker in an unnamed function that is a JSX value, or a value in an object or array given to
// a call, counts for the function around it. A function kept in a name still has its own steps.
import { describe, expect, test } from 'vitest';
import { formatHeader } from '../../src/formats/header.ts';
import { checkAgainstLock } from '../../src/lib/lockcheck.ts';
import { planFile, skeleton } from '../helpers/code.ts';
import { S2, check, edit, lockFor, plan } from '../helpers/lockcheck.ts';

const MARKER = `  // Step 2: ${S2}\n`;
const moved = (code: string): string => edit(MARKER, code.replace('MARK', `// Step 2: ${S2}`));
const STEP_2 = ['step 2 in total was changed or removed'];

describe('a marker in a value handed to a call', () => {
  test('an object given to a call', () => expect(check(moved('  run({ fn: () => {\n    MARK\n  } });\n'))).toEqual([]));
  test('a function expression in an object given to a call', () => expect(check(moved('  run({ fn: function () {\n    MARK\n  } });\n'))).toEqual([]));
  test('an object in an object', () => expect(check(moved('  run({ a: { b: () => {\n    MARK\n  } } });\n'))).toEqual([]));
  test('an array given to a call', () => expect(check(moved('  run([() => {\n    MARK\n  }]);\n'))).toEqual([]));
  test('an object in an array in a call', () => expect(check(moved('  run([{ fn: () => {\n    MARK\n  } }]);\n'))).toEqual([]));
  test('an object wrapped in parentheses and as', () => expect(check(moved('  run(({ fn: () => {\n    MARK\n  } }) as Opts);\n'))).toEqual([]));
  test('an object given to new', () => expect(check(moved('  new Thing({ fn: () => {\n    MARK\n  } });\n'))).toEqual([]));
  test('a callback in a call in an object given to a call', () => expect(check(moved('  run({ a: wrap(() => {\n    MARK\n  }) });\n'))).toEqual([]));
});

describe('a marker in a method of an object given to a call', () => {
  test('a method shorthand', () => expect(check(moved('  useMutation({ onSuccess() {\n    MARK\n  } });\n'))).toEqual([]));
  test('a method with an argument and another method after it', () =>
    expect(check(moved('  useMutation({ onSuccess(data) {\n    MARK\n  }, onError() {} });\n'))).toEqual([]));
  test('a getter', () => expect(check(moved('  run({ get v() {\n    MARK\n    return 1;\n  } });\n'))).toEqual([]));
  test('a method in an object in an array', () => expect(check(moved('  run([{ go() {\n    MARK\n  } }]);\n'))).toEqual([]));
  test('a method in an object given to new', () => expect(check(moved('  new Thing({ go() {\n    MARK\n  } });\n'))).toEqual([]));
  test('a method in an object kept in a name is its own function', () =>
    expect(check(moved('  const api = { go() {\n    MARK\n  } };\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('a method in an object that is returned is its own function', () =>
    expect(check(moved('  return { go() {\n    MARK\n  } };\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('a method in an object that is only kept in a name, given to a call later', () =>
    expect(check(moved('  const opts = { go() {\n    MARK\n  } };\n  run(opts);\n'))).toEqual(expect.arrayContaining(STEP_2)));
});

describe('a marker in a function chosen by a conditional or a logical operator and given to a call', () => {
  test('the first choice of a conditional', () => expect(check(moved('  run(flag ? () => {\n    MARK\n  } : noop);\n'))).toEqual([]));
  test('the second choice of a conditional', () => expect(check(moved('  run(flag ? noop : () => {\n    MARK\n  });\n'))).toEqual([]));
  test('a conditional in an object given to a call', () => expect(check(moved('  run({ fn: flag ? () => {\n    MARK\n  } : noop });\n'))).toEqual([]));
  test('a conditional in a conditional', () =>
    expect(check(moved('  run(a ? (b ? () => {\n    MARK\n  } : noop) : noop);\n'))).toEqual([]));
  test('&&', () => expect(check(moved('  run(flag && (() => {\n    MARK\n  }));\n'))).toEqual([]));
  test('||', () => expect(check(moved('  run(cb || function () {\n    MARK\n  });\n'))).toEqual([]));
  test('??', () => expect(check(moved('  run(cb ?? (() => {\n    MARK\n  }));\n'))).toEqual([]));
  test('a conditional that is kept in a name is not handed on', () =>
    expect(check(moved('  const h = flag ? () => {\n    MARK\n  } : noop;\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('a logical operator that is kept in a name is not handed on', () =>
    expect(check(moved('  const h = flag && (() => {\n    MARK\n  });\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('a function in the test of a conditional is not handed on', () =>
    expect(check(moved('  run((() => {\n    MARK\n  }) ? a : b);\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('a function called at once inside a conditional is its own function', () =>
    expect(check(moved('  run(flag ? (() => {\n    MARK\n  })() : noop);\n'))).toEqual(expect.arrayContaining(STEP_2)));
});

describe('a marker in a function that is kept in a name is not part of the function around it', () => {
  test('an object kept in a name', () => expect(check(moved('  const o = { fn: () => {\n    MARK\n  } };\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('an object that is returned', () => expect(check(moved('  return { fn: () => {\n    MARK\n  } };\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('an arrow kept in a name', () => expect(check(moved('  const go = () => {\n    MARK\n  };\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('an object given to a call but with a named function in it', () =>
    expect(check(moved('  run({ fn: function step() {\n    MARK\n  } });\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('an arrow that is called at once', () => expect(check(moved('  (() => {\n    MARK\n  })();\n'))).toEqual(expect.arrayContaining(STEP_2)));
  test('a marker that moved out of the function into a callback of another function', () => {
    const text = `${edit(MARKER, '')}\nfunction other() {\n  run({ fn: () => {\n    // Step 2: ${S2}\n  } });\n}\n`;
    expect(check(text)).toEqual(expect.arrayContaining(STEP_2));
  });
});

describe('a marker in a JSX value', () => {
  const path = 'src/greeting/Greeting.tsx';
  const { seam, file } = planFile(path);
  const [one, two, three] = file.steps;
  const screen = (jsx: string): string => [
    formatHeader(seam, file), '', 'export function Greeting(props: { name: string }): JSX.Element {',
    `  // Step 1: ${one}`, ...jsx.split('\n').map((l) => l.replace('TWO', `// Step 2: ${two}`).replace('THREE', `// Step 3: ${three}`)), '}', '',
  ].join('\n');
  const against = (text: string): string[] => checkAgainstLock(path, text, lockFor(path, skeleton(seam, file)), plan);

  test('onClick with an arrow', () => {
    expect(against(screen('  return <h1 onClick={() => {\n    TWO\n  }} onMouseEnter={() => {\n    THREE\n  }}>Hello</h1>;'))).toEqual([]);
  });
  test('a function expression as a JSX value', () => {
    expect(against(screen('  return <h1 onClick={function () {\n    TWO\n  }} onMouseEnter={function () {\n    THREE\n  }}>Hello</h1>;'))).toEqual([]);
  });
  test('a function as a child', () => {
    expect(against(screen('  return <List>{() => {\n    TWO\n    THREE\n  }}</List>;'))).toEqual([]);
  });
  test('a handler kept in a name is its own function', () => {
    const problems = against(screen('  const onClick = () => {\n    TWO\n  };\n  THREE\n  return <h1 onClick={onClick}>Hello</h1>;'));
    expect(problems).toEqual(['step 2 in Greeting was changed or removed', 'step 3 in Greeting was changed or removed']);
  });
});
