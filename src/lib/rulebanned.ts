// The "builder code may not" rules, read off the syntax tree so a word in a comment or a string
// never counts: reading process.env, and reaching around the plan with fs, require, dynamic import,
// eval or the Function constructor. This is a tripwire for the ordinary ways in, not a sandbox: a
// name that is passed around under another name (`const p = process; p.env`) is not followed.
import ts from 'typescript';
import { someNode } from './rulewalk.ts';

/** `fs`, `node:fs`, `fs/promises`, `node:fs/promises`, and `module` (for `createRequire`). */
const BANNED_MODULE = /^(?:node:)?(?:fs(?:\/.*)?|module)$/;
const PROCESS_MODULE = /^(?:node:)?process$/;
/** What `process` hands out that reaches the machine without an import (`process.getBuiltinModule('fs')` is `require('fs')`, whatever it is called with). */
const PROCESS_ESCAPES = new Set(['binding', 'dlopen', 'mainModule', 'getBuiltinModule']);
const GLOBALS = new Set(['globalThis', 'global', 'self', 'window']);

/** `(process as X)`, `(process)` and `process!` are all just `process`. */
function unwrap(e: ts.Expression): ts.Expression {
  const wrapped = ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e);
  return wrapped ? unwrap(e.expression) : e;
}

/** Is `e` the global `process`: the bare name, or `globalThis.process` and its kin? */
function isProcess(e: ts.Expression): boolean {
  const x = unwrap(e);
  if (ts.isIdentifier(x)) return x.text === 'process';
  return ts.isPropertyAccessExpression(x) && x.name.text === 'process' && ts.isIdentifier(x.expression) && GLOBALS.has(x.expression.text);
}

/** The names this node takes off `process`: `process.x`, `process['x']`, or `const { x, y } = process`. */
function processMembers(node: ts.Node): string[] {
  if (ts.isPropertyAccessExpression(node) && isProcess(node.expression)) return [node.name.text];
  if (ts.isElementAccessExpression(node) && isProcess(node.expression) && ts.isStringLiteralLike(node.argumentExpression)) {
    return [node.argumentExpression.text];
  }
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isProcess(node.initializer)) {
    return node.name.elements.map((el) => (el.propertyName ?? el.name).getText());
  }
  return [];
}

const specifierMatches = (spec: ts.Expression | undefined, pattern: RegExp): boolean =>
  spec !== undefined && ts.isStringLiteralLike(spec) && pattern.test(spec.text);

/** `import { env } from 'node:process'` brings process.env in under a bare name. */
function importsEnv(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node) || !specifierMatches(node.moduleSpecifier, PROCESS_MODULE)) return false;
  const bindings = node.importClause?.namedBindings;
  return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((el) => (el.propertyName ?? el.name).text === 'env');
}

/** Does the file read process.env, in any of the spellings above? */
export function readsEnv(sf: ts.SourceFile): boolean {
  return someNode(sf, (node) => importsEnv(node) || processMembers(node).includes('env'));
}

/** `x`, or `.x` of `a.x`: the name a call is made through. */
function calleeName(call: ts.CallExpression | ts.NewExpression): string | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/** Is the name `require` here a use of require? Not `{ require: true }`, not `a.require` unless it is called. */
function isRequire(id: ts.Identifier): boolean {
  if (id.text !== 'require') return false;
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
  const isKey = ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent);
  return !(isKey && parent.name === id);
}

function isBanned(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return specifierMatches(node.moduleSpecifier, BANNED_MODULE);
  if (ts.isExternalModuleReference(node)) return true; // import x = require('x')
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return true; // import('x')
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) return ['eval', 'Function'].includes(calleeName(node) ?? '');
  if (ts.isIdentifier(node)) return isRequire(node);
  return processMembers(node).some((name) => PROCESS_ESCAPES.has(name));
}

/** Does the file import fs, call require or dynamic import, or use eval or `new Function`? */
export function usesBannedCall(sf: ts.SourceFile): boolean {
  return someNode(sf, isBanned);
}
