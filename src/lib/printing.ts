// Printing a declaration without the code inside its functions, so the print says what the thing is
// (names, types, defaults, modifiers) and not how it works. Used for export and type fingerprints.
import ts from 'typescript';

const f = ts.factory;
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** Print a node, leaving off a leading `export` / `export default`, so `export function x` and `function x` + `export { x }` match. */
export function print(node: ts.Node, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/^export\s+(?:default\s+)?/, '');
}

/** A member with its code taken out. A class method just loses its body; in an object literal a method needs one, so it gets an empty one. */
function memberWithoutBody(m: ts.ClassElement | ts.ObjectLiteralElementLike): ts.ClassElement | ts.ObjectLiteralElementLike {
  const body = ts.isObjectLiteralExpression(m.parent) ? f.createBlock([]) : undefined;
  if (ts.isMethodDeclaration(m)) return f.updateMethodDeclaration(m, m.modifiers, m.asteriskToken, m.name, m.questionToken, m.typeParameters, m.parameters, m.type, body);
  if (ts.isConstructorDeclaration(m)) return f.updateConstructorDeclaration(m, m.modifiers, m.parameters, undefined);
  if (ts.isGetAccessorDeclaration(m)) return f.updateGetAccessorDeclaration(m, m.modifiers, m.name, m.parameters, m.type, body);
  if (ts.isSetAccessorDeclaration(m)) return f.updateSetAccessorDeclaration(m, m.modifiers, m.name, m.parameters, body);
  if (ts.isClassStaticBlockDeclaration(m)) return f.updateClassStaticBlockDeclaration(m, f.createBlock([]));
  if (ts.isPropertyDeclaration(m) && m.initializer) {
    return f.updatePropertyDeclaration(m, m.modifiers, m.name, m.questionToken ?? m.exclamationToken, m.type, withoutFnBody(m.initializer));
  }
  if (ts.isPropertyAssignment(m)) return f.updatePropertyAssignment(m, m.name, withoutFnBody(m.initializer));
  return m;
}

const membersWithoutBodies = <T extends ts.ClassElement | ts.ObjectLiteralElementLike>(members: readonly T[]): T[] =>
  members.map((m) => memberWithoutBody(m) as T);

/**
 * An expression with the code of every function in it taken out: arrow functions and function
 * expressions (also inside parentheses, `as`, `satisfies`, call arguments such as `memo(...)`, arrays),
 * and the methods of object literals and classes.
 */
export function withoutFnBody(e: ts.Expression): ts.Expression {
  if (ts.isArrowFunction(e)) return f.updateArrowFunction(e, e.modifiers, e.typeParameters, e.parameters, e.type, e.equalsGreaterThanToken, f.createBlock([]));
  if (ts.isFunctionExpression(e)) return f.updateFunctionExpression(e, e.modifiers, e.asteriskToken, e.name, e.typeParameters, e.parameters, e.type, f.createBlock([]));
  if (ts.isParenthesizedExpression(e)) return f.updateParenthesizedExpression(e, withoutFnBody(e.expression));
  if (ts.isAsExpression(e)) return f.updateAsExpression(e, withoutFnBody(e.expression), e.type);
  if (ts.isSatisfiesExpression(e)) return f.updateSatisfiesExpression(e, withoutFnBody(e.expression), e.type);
  if (ts.isTypeAssertionExpression(e)) return f.updateTypeAssertion(e, e.type, withoutFnBody(e.expression));
  if (ts.isNonNullExpression(e)) return f.updateNonNullExpression(e, withoutFnBody(e.expression));
  if (ts.isCallExpression(e)) return f.updateCallExpression(e, e.expression, e.typeArguments, e.arguments.map(withoutFnBody));
  if (ts.isArrayLiteralExpression(e)) return f.updateArrayLiteralExpression(e, e.elements.map(withoutFnBody));
  if (ts.isObjectLiteralExpression(e)) return f.updateObjectLiteralExpression(e, membersWithoutBodies(e.properties));
  if (ts.isClassExpression(e)) {
    return f.updateClassExpression(e, e.modifiers, e.name, e.typeParameters, e.heritageClauses, membersWithoutBodies(e.members));
  }
  return e;
}

/** The same declaration with the code of its functions taken out. */
export function withoutBody(node: ts.Node): ts.Node {
  if (ts.isFunctionDeclaration(node)) {
    return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, undefined);
  }
  if (ts.isClassDeclaration(node)) {
    return f.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, membersWithoutBodies(node.members));
  }
  return node;
}
