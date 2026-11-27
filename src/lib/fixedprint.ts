// The types a file defines, exported or not. A signature can use a local type, so changing one
// (`type Money = number` to `string`, a field of an interface) changes what a signature means
// without changing a word of it. Each one is fingerprinted, whole, under `type X`, `interface X`
// or `enum X`.
import ts from 'typescript';
import { print } from './printing.ts';
import { hash } from './text.ts';

export function collectFixed(sf: ts.SourceFile): Record<string, string> {
  const pieces = new Map<string, string[]>();
  for (const stmt of sf.statements) {
    if (!(ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isEnumDeclaration(stmt))) continue;
    const kind = ts.isTypeAliasDeclaration(stmt) ? 'type' : ts.isInterfaceDeclaration(stmt) ? 'interface' : 'enum';
    const key = `${kind} ${stmt.name.text}`;
    pieces.set(key, [...(pieces.get(key) ?? []), print(stmt, sf)]);
  }
  const byKey = [...pieces].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(byKey.map(([key, parts]) => [key, hash(parts.join('\n'))]));
}
