// What may sit outside every function. Code that runs when a file loads can change anything the
// guard has fixed (assign over an export, patch a built-in), and the guard can't audit it, so the
// top level is limited to declarations that only define things (see initializers.ts for the rule on
// values). Type names can't be borrowed from TypeScript either: `d: Date` has to keep meaning Date.
import ts from 'typescript';
import { bindingNames, commonJsAssignment, importedNames } from './exportprint.ts';
import { isBuiltInTypeName } from './globalnames.ts';
import { classLoadsNothing, enumLoadsNothing, loadsNothing, reactNames } from './initializers.ts';
import type { ReactNames } from './initializers.ts';

export const NOT_ALLOWED = "a statement outside any function isn't allowed";
export const NO_NAMESPACES = "'declare global', 'declare module' and 'namespace' aren't allowed in app files";
export const builtInProblem = (name: string): string => `'${name}' is the name of a type TypeScript provides, so it can't be declared here`;
/** Where a CommonJS file may put a value: `module.exports`, `exports.x`, `module.exports.x`, `exports['x']`. */
const COMMON_JS_TARGET = /^(?:module\.exports|exports)(?:\.[\w$]+|\[(?:'[^']*'|"[^"]*")\])*$/;
const POISONED = new Set(['__proto__', 'constructor', 'prototype']);

/** The parts of `exports.a['b']` after the first: `a`, `b`. */
const segments = (target: string): string[] => [...target.matchAll(/\.([\w$]+)|\[(?:'([^']*)'|"([^"]*)")\]/g)].map((m) => m[1] ?? m[2] ?? m[3]);

/** `module.exports = ...` and `exports.x = ...`: the export statement of a CommonJS file, as long as it only hands over a value. */
function isCommonJsExport(stmt: ts.ExpressionStatement, react: ReactNames): boolean {
  const assignment = commonJsAssignment(stmt);
  if (assignment === null) return false;
  const target = assignment.left.getText();
  return COMMON_JS_TARGET.test(target) && !segments(target).some((s) => POISONED.has(s)) && loadsNothing(assignment.right, react);
}

function statementAllowed(stmt: ts.Statement, react: ReactNames): boolean {
  if (ts.isEmptyStatement(stmt)) return true;
  if (ts.isExpressionStatement(stmt)) return ts.isStringLiteral(stmt.expression) || isCommonJsExport(stmt, react); // "use strict", "use client"
  if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt) || ts.isExportDeclaration(stmt) || ts.isNamespaceExportDeclaration(stmt)) return true;
  if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) return true;
  if (ts.isExportAssignment(stmt)) return loadsNothing(stmt.expression, react);
  if (ts.isClassDeclaration(stmt)) return classLoadsNothing(stmt, react);
  if (ts.isEnumDeclaration(stmt)) return enumLoadsNothing(stmt);
  if (ts.isVariableStatement(stmt)) {
    if (stmt.declarationList.flags & ts.NodeFlags.Using) return false;
    return stmt.declarationList.declarations.every((d) => ts.isIdentifier(d.name) && (!d.initializer || loadsNothing(d.initializer, react)));
  }
  return false;
}

/** The names a top-level statement takes, in the value space and the type space (a class or enum takes both). */
function namesTaken(stmt: ts.Statement): { values: string[]; types: string[] } {
  if (ts.isFunctionDeclaration(stmt)) return { values: stmt.name && stmt.body ? [stmt.name.text] : [], types: [] };
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) return { values: [], types: [stmt.name.text] };
  if (ts.isVariableStatement(stmt)) return { values: stmt.declarationList.declarations.flatMap((d) => bindingNames(d.name)), types: [] };
  const both = (names: string[]) => ({ values: names, types: names });
  if (ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) return both(stmt.name ? [stmt.name.text] : []);
  if (ts.isImportEqualsDeclaration(stmt)) return both([stmt.name.text]);
  if (ts.isImportDeclaration(stmt) && stmt.importClause) return both(importedNames(stmt.importClause));
  return { values: [], types: [] };
}

/** Names a statement gives to types. The ones TypeScript's own types already use are not available. */
function typeNames(stmt: ts.Statement): string[] {
  if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) return [stmt.name.text];
  if (ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) return stmt.name ? [stmt.name.text] : [];
  return ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt) ? namesTaken(stmt).types : [];
}

/** Everything wrong with the top level of a file, in plain words. */
export function topLevelProblems(sf: ts.SourceFile): string[] {
  const react = reactNames(sf);
  const counts = { values: new Map<string, number>(), types: new Map<string, number>() };
  for (const stmt of sf.statements) {
    const taken = namesTaken(stmt);
    for (const space of ['values', 'types'] as const) for (const name of taken[space]) counts[space].set(name, (counts[space].get(name) ?? 0) + 1);
  }
  const repeated = new Set([...counts.values, ...counts.types].filter(([, n]) => n > 1).map(([name]) => name));
  const borrowed = new Set(sf.statements.flatMap(typeNames).filter(isBuiltInTypeName));
  const modules = sf.statements.some(ts.isModuleDeclaration);
  const others = sf.statements.some((s) => !ts.isModuleDeclaration(s) && !statementAllowed(s, react));
  return [
    ...(modules ? [NO_NAMESPACES] : []),
    ...(others ? [NOT_ALLOWED] : []),
    ...[...repeated].sort().map((name) => `'${name}' is declared more than once`),
    ...[...borrowed].sort().map(builtInProblem),
  ];
}
