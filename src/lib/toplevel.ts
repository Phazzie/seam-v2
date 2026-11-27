// What may sit outside every function. Code that runs when a file loads can change anything the
// guard has fixed (assign over an export, patch a built-in), and the guard can't audit it, so the
// top level is limited to declarations that only define things.
import ts from 'typescript';
import { bindingNames, commonJsAssignment, importedNames } from './exportprint.ts';

export const NOT_ALLOWED = "a statement outside any function isn't allowed";
/** Where a CommonJS file may put a value: `module.exports`, `exports.x`, `module.exports.x`, `exports['x']`. */
const COMMON_JS_TARGET = /^(?:module\.exports|exports)(?:\.[\w$]+|\[(?:'[^']*'|"[^"]*")\])*$/;
const WRAPPERS = new Set(['memo', 'forwardRef']);
const PURE_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
]);
const PURE_PREFIXES = new Set<ts.PrefixUnaryOperator>([ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken]);

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
const isAmbient = (node: ts.Node): boolean => hasModifier(node, ts.SyntaxKind.DeclareKeyword);
const isLiteralKey = (e: ts.Expression): boolean => ts.isStringLiteralLike(e) || ts.isNumericLiteral(e);

/** `Foo`, `React.Component`: a name that can be read without running anything. */
function isNameChain(e: ts.Expression): boolean {
  return ts.isIdentifier(e) || (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) && isNameChain(e.expression));
}

/** `memo(...)` and `forwardRef(...)`, also as `React.memo(...)`. */
function isWrapperCall(e: ts.CallExpression): boolean {
  const callee = e.expression;
  const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.name.text : '';
  return WRAPPERS.has(name);
}

function inertMember(m: ts.ObjectLiteralElementLike): boolean {
  if (ts.isShorthandPropertyAssignment(m)) return true;
  if (ts.isSpreadAssignment(m)) return false;
  if (ts.isComputedPropertyName(m.name) && !isLiteralKey(m.name.expression)) return false;
  return !ts.isPropertyAssignment(m) || inert(m.initializer);
}

/** A class defines things; it must not run anything while the file loads (static blocks and values, decorators, computed names). */
function inertClass(node: ts.ClassLikeDeclaration): boolean {
  if ((ts.getDecorators(node) ?? []).length > 0) return false;
  const heritage = node.heritageClauses?.flatMap((h) => h.types) ?? [];
  if (!heritage.every((t) => isNameChain(t.expression))) return false;
  return node.members.every((m) => {
    if (ts.isClassStaticBlockDeclaration(m)) return false;
    if ((ts.canHaveDecorators(m) ? ts.getDecorators(m) ?? [] : []).length > 0) return false;
    if (m.name && ts.isComputedPropertyName(m.name) && !isLiteralKey(m.name.expression)) return false;
    return !(ts.isPropertyDeclaration(m) && hasModifier(m, ts.SyntaxKind.StaticKeyword) && m.initializer && !inert(m.initializer));
  });
}

/** Can this expression be evaluated while a file loads without running anything of its own? */
function inert(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e)) {
    return inert(e.expression);
  }
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isIdentifier(e) || ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return true;
  if (ts.isBigIntLiteral(e) || ts.isRegularExpressionLiteral(e)) return true;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(e)) return PURE_PREFIXES.has(e.operator) && inert(e.operand);
  if (ts.isBinaryExpression(e)) return PURE_OPERATORS.has(e.operatorToken.kind) && inert(e.left) && inert(e.right);
  if (ts.isTemplateExpression(e)) return e.templateSpans.every((s) => inert(s.expression));
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((el) => ts.isOmittedExpression(el) || (!ts.isSpreadElement(el) && inert(el)));
  if (ts.isObjectLiteralExpression(e)) return e.properties.every(inertMember);
  if (ts.isCallExpression(e)) return isWrapperCall(e) && e.arguments.every(inert);
  return ts.isClassExpression(e) && inertClass(e);
}

/** A name or a pattern that only takes things apart: no default values to run, no computed names. */
function plainBinding(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return true;
  return name.elements.every((el) => ts.isOmittedExpression(el)
    || (!el.initializer && !(el.propertyName && ts.isComputedPropertyName(el.propertyName)) && plainBinding(el.name)));
}

/** `module.exports = ...` and `exports.x = ...`: the export statement of a CommonJS file, as long as it only hands over a value. */
function isCommonJsExport(stmt: ts.ExpressionStatement): boolean {
  const assignment = commonJsAssignment(stmt);
  return assignment !== null && COMMON_JS_TARGET.test(assignment.left.getText()) && inert(assignment.right);
}

function statementAllowed(stmt: ts.Statement): boolean {
  if (ts.isEmptyStatement(stmt)) return true;
  if (ts.isExpressionStatement(stmt)) return ts.isStringLiteral(stmt.expression) || isCommonJsExport(stmt); // "use strict", "use client"
  if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt) || ts.isExportDeclaration(stmt) || ts.isNamespaceExportDeclaration(stmt)) return true;
  if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) return true;
  if (ts.isModuleDeclaration(stmt)) return isAmbient(stmt); // `declare namespace`, `declare module`, `declare global`: types only
  if (ts.isExportAssignment(stmt)) return inert(stmt.expression);
  if (isAmbient(stmt)) return true;
  if (ts.isClassDeclaration(stmt)) return inertClass(stmt);
  if (ts.isEnumDeclaration(stmt)) return stmt.members.every((m) => !m.initializer || inert(m.initializer));
  if (ts.isVariableStatement(stmt)) {
    if (stmt.declarationList.flags & ts.NodeFlags.Using) return false;
    return stmt.declarationList.declarations.every((d) => plainBinding(d.name) && (!d.initializer || inert(d.initializer)));
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
  if (ts.isModuleDeclaration(stmt)) return both(ts.isIdentifier(stmt.name) ? [stmt.name.text] : []);
  if (ts.isImportEqualsDeclaration(stmt)) return both([stmt.name.text]);
  if (ts.isImportDeclaration(stmt) && stmt.importClause) return both(importedNames(stmt.importClause));
  return { values: [], types: [] };
}

/** Everything wrong with the top level of a file, in plain words. */
export function topLevelProblems(sf: ts.SourceFile): string[] {
  const counts = { values: new Map<string, number>(), types: new Map<string, number>() };
  for (const stmt of sf.statements) {
    const taken = namesTaken(stmt);
    for (const space of ['values', 'types'] as const) for (const name of taken[space]) counts[space].set(name, (counts[space].get(name) ?? 0) + 1);
  }
  const repeated = new Set([...counts.values, ...counts.types].filter(([, n]) => n > 1).map(([name]) => name));
  return [
    ...(sf.statements.every(statementAllowed) ? [] : [NOT_ALLOWED]),
    ...[...repeated].sort().map((name) => `'${name}' is declared more than once`),
  ];
}
