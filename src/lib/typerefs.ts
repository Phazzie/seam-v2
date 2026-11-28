// The type names a file's signatures and fixed items lean on: `r: Response`, `m: Map<K, V>`,
// `class A extends B`, `typeof RATE`. A name that is in this list can't be declared again by a new
// type or import, because the signature would keep its words and mean something else.
import ts from 'typescript';
import { isBodyNode } from './stepprint.ts';

/** `A`, `A.B` and `A.B.C` are all about `A`. */
function leftmost(name: ts.EntityName | ts.Expression): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isQualifiedName(name)) return leftmost(name.left);
  return ts.isPropertyAccessExpression(name) ? leftmost(name.expression) : null;
}

/**
 * Every type name used outside the bodies of functions, sorted, once each. A type parameter the code
 * declares for itself (`<T>`, `infer U`, a mapped type's key) is not a name from the file's scope.
 */
export function collectTypeRefs(sf: ts.SourceFile): string[] {
  const used = new Set<string>();
  const own = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) used.add(leftmost(node.typeName) ?? '');
    else if (ts.isExpressionWithTypeArguments(node)) used.add(leftmost(node.expression) ?? '');
    else if (ts.isTypeQueryNode(node)) used.add(leftmost(node.exprName) ?? '');
    else if (ts.isTypeParameterDeclaration(node)) own.add(node.name.text);
    const body = isBodyNode(node) ? node.body : undefined;
    ts.forEachChild(node, (child) => {
      if (child !== body) visit(child);
    });
  };
  sf.statements.forEach(visit);
  return [...used].filter((name) => name !== '' && !own.has(name)).sort();
}
