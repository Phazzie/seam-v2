// What an import brings in, one binding at a time: `import { memo, useState } from 'react'` is two bindings, and a
// fingerprint that leans on `memo` must not change when `useState` is added to the same statement.
import ts from 'typescript';

/** Each name an import brings in, with what it stands for: `Money` -> `Cents from ./money`. A type-only binding says `type`. */
export function importBindings(stmt: ts.ImportDeclaration): [string, string][] {
  const clause = stmt.importClause;
  if (!clause || !ts.isStringLiteralLike(stmt.moduleSpecifier)) return [];
  const from = stmt.moduleSpecifier.text;
  const kind = (typeOnly: boolean): string => (typeOnly || clause.isTypeOnly ? 'type ' : '');
  const found: [string, string][] = clause.name ? [[clause.name.text, `${kind(false)}default from ${from}`]] : [];
  const bound = clause.namedBindings;
  if (bound && ts.isNamespaceImport(bound)) found.push([bound.name.text, `${kind(false)}* from ${from}`]);
  if (bound && ts.isNamedImports(bound)) {
    for (const el of bound.elements) found.push([el.name.text, `${kind(el.isTypeOnly)}${(el.propertyName ?? el.name).text} from ${from}`]);
  }
  return found;
}
