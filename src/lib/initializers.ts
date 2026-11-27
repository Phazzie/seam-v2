// What may be worked out while a file loads. The rule is short so it can be explained: a value at the
// top level is a literal, a function, an object or array of such values (methods fine, getters and
// setters not), `memo` or `forwardRef` imported from 'react' around such a value, or a plain name.
// Operators work on literals only: `o + 1` or a template with `${o}` could run the `valueOf` or
// `toString` of whatever `o` is, and so could `o.x` or `const { x } = o` (a getter).
import ts from 'typescript';

const OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.BarToken, ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
]);
const PREFIXES = new Set<ts.PrefixUnaryOperator>([ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.TildeToken]);

/** The names `memo` and `forwardRef` go by in this file, when they come from 'react'. */
export type ReactNames = ReadonlySet<string>;

export function reactNames(sf: ts.SourceFile): ReactNames {
  const found = new Set<string>();
  for (const stmt of sf.statements) {
    const clause = ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === 'react' ? stmt.importClause : undefined;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      if (!el.isTypeOnly && ['memo', 'forwardRef'].includes((el.propertyName ?? el.name).text)) found.add(el.name.text);
    }
  }
  return found;
}

function unwrap(e: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e;
}

/** The members of the enum being read, so `B = A | 1` can name `A`. */
export interface EnumScope { name: string; members: ReadonlySet<string> }

/** A literal, or operators between literals (and, inside an enum, members of that enum). It can't run anything. */
export function scalar(raw: ts.Expression, scope?: EnumScope): boolean {
  const e = unwrap(raw);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e) || ts.isBigIntLiteral(e) || ts.isRegularExpressionLiteral(e)) return true;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isPrefixUnaryExpression(e)) return PREFIXES.has(e.operator) && scalar(e.operand, scope);
  if (ts.isBinaryExpression(e)) return OPERATORS.has(e.operatorToken.kind) && scalar(e.left, scope) && scalar(e.right, scope);
  if (!scope) return false;
  if (ts.isIdentifier(e)) return scope.members.has(e.text);
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === scope.name && scope.members.has(e.name.text);
}

const keyIsFixed = (name: ts.PropertyName): boolean =>
  !ts.isComputedPropertyName(name) || ts.isStringLiteralLike(name.expression) || ts.isNumericLiteral(name.expression);

function objectMemberAllowed(m: ts.ObjectLiteralElementLike, react: ReactNames): boolean {
  if (ts.isShorthandPropertyAssignment(m)) return true;
  if (ts.isPropertyAssignment(m)) return keyIsFixed(m.name) && loadsNothing(m.initializer, react);
  return ts.isMethodDeclaration(m) && keyIsFixed(m.name);
}

/** Can this value be built while the file loads without running anything of the file's own? */
export function loadsNothing(raw: ts.Expression, react: ReactNames): boolean {
  const e = unwrap(raw);
  if (scalar(e) || ts.isIdentifier(e) || ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true;
  if (ts.isArrayLiteralExpression(e)) return e.elements.every((el) => ts.isOmittedExpression(el) || (!ts.isSpreadElement(el) && loadsNothing(el, react)));
  if (ts.isObjectLiteralExpression(e)) return e.properties.every((m) => objectMemberAllowed(m, react));
  return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && react.has(e.expression.text) && e.arguments.every((a) => loadsNothing(a, react));
}

/** A class may not run anything at load: no static blocks, decorators or computed names, static values follow the same rule, and it extends a plain name. */
export function classLoadsNothing(node: ts.ClassLikeDeclaration, react: ReactNames): boolean {
  if ((ts.getDecorators(node) ?? []).length > 0) return false;
  const parents = node.heritageClauses?.filter((h) => h.token === ts.SyntaxKind.ExtendsKeyword).flatMap((h) => h.types) ?? [];
  if (!parents.every((t) => ts.isIdentifier(t.expression))) return false;
  return node.members.every((m) => {
    if (ts.isClassStaticBlockDeclaration(m)) return false;
    if ((ts.canHaveDecorators(m) ? ts.getDecorators(m) ?? [] : []).length > 0) return false;
    if (m.name && !keyIsFixed(m.name)) return false;
    const isStatic = (ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : []).some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword);
    return !(ts.isPropertyDeclaration(m) && isStatic && m.initializer && !loadsNothing(m.initializer, react));
  });
}

/** An enum's values are literals, or operators between literals and members of the same enum. */
export function enumLoadsNothing(node: ts.EnumDeclaration): boolean {
  const scope = { name: node.name.text, members: new Set(node.members.map((m) => (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : ''))) };
  return node.members.every((m) => !m.initializer || scalar(m.initializer, scope));
}
