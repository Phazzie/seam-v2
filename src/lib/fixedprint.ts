// The things a signature can lean on, whether or not they are exported. A signature that says
// `(a: Money)`, `(a: Box)` or `(a: typeof RATE)` keeps the same words when `Money`, `Box` or `RATE`
// is changed underneath it, and `import type { Money }` means something else if it becomes
// `import type { Cents as Money }`. So each is fingerprinted under `type X`, `interface X`, `enum X`,
// `class X` (without its method bodies), `const X` (or `let`, `var`; function values without their
// bodies) and `import X` (what it is called in the source module, and which module).
import ts from 'typescript';
import { declared } from './exportprint.ts';
import { importBindings } from './importprint.ts';
import { jsdocTypes } from './jsdocprint.ts';
import { print, withoutBody } from './printing.ts';
import { hash } from './text.ts';

/** The pieces of one statement: each is `[key, what to hash]`. */
function pieces(stmt: ts.Statement, sf: ts.SourceFile): [string, string][] {
  if (ts.isTypeAliasDeclaration(stmt)) return [[`type ${stmt.name.text}`, print(stmt, sf)]];
  if (ts.isInterfaceDeclaration(stmt)) return [[`interface ${stmt.name.text}`, print(stmt, sf)]];
  if (ts.isEnumDeclaration(stmt)) return [[`enum ${stmt.name.text}`, print(stmt, sf)]];
  if (ts.isClassDeclaration(stmt) && stmt.name) return [[`class ${stmt.name.text}`, print(withoutBody(stmt), sf) + jsdocTypes(stmt, sf)]];
  if (ts.isImportDeclaration(stmt)) return importBindings(stmt).map(([name, what]): [string, string] => [`import ${name}`, what]);
  if (ts.isImportEqualsDeclaration(stmt)) return [[`import ${stmt.name.text}`, print(stmt, sf)]];
  if (!ts.isVariableStatement(stmt)) return [];
  const flags = stmt.declarationList.flags;
  const kind = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : 'var';
  return declared(stmt, sf).map(([name, piece]): [string, string] => [`${kind} ${name}`, piece]);
}

export function collectFixed(sf: ts.SourceFile): Record<string, string> {
  const found = new Map<string, string[]>();
  for (const stmt of sf.statements) {
    for (const [key, piece] of pieces(stmt, sf)) found.set(key, [...(found.get(key) ?? []), piece]);
  }
  const byKey = [...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(byKey.map(([key, parts]) => [key, hash(parts.join('\n'))]));
}
