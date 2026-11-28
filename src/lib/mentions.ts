// The names an expression mentions, for working out what an exported value is made of (exportprint.ts): `const total = (a: Options) =>
// ...` mentions `Options`, so the local `Options` is part of what `total` is. A name the function binds for itself is not a mention of
// anything outside it (R78): in `(helper: number) => ...` the parameter `helper` is not the local function `helper`, and a type
// parameter `T` is not a local type `T`. Types and values are told apart, since the same name can be both (`typeof helper` is a
// mention of the value, `(x: helper)` of a type).
import ts from 'typescript';

interface Scope { values: ReadonlySet<string>; types: ReadonlySet<string> }

/** The names a node declares for what is inside it: a function's parameters (destructured ones too), its type parameters, and (for a function or class expression) its own name. */
function bindsOf(node: ts.Node): { values: string[]; types: string[] } | null {
  if (ts.isFunctionLike(node)) {
    const values = node.parameters.flatMap((p) => bound(p.name));
    if (ts.isFunctionExpression(node) && node.name) values.push(node.name.text);
    return { values, types: (node.typeParameters ?? []).map((t) => t.name.text) };
  }
  if (ts.isClassExpression(node)) return { values: node.name ? [node.name.text] : [], types: (node.typeParameters ?? []).map((t) => t.name.text) };
  return null;
}

/** The names a binding declares: one name, or every name in a destructuring pattern. */
function bound(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bound(el.name)));
}

/** Is `child` the plain name `parent` gives to a member, a property or an enum member (not a computed one), or the right side of `a.b` / `A.B`? */
function isKeyOf(parent: ts.Node, child: ts.Node): boolean {
  if (!ts.isIdentifier(child)) return false;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === child;
  if (ts.isQualifiedName(parent)) return parent.right === child;
  return (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isEnumMember(parent)) && parent.name === child;
}

/** The names an expression mentions, once each, in the order they first appear; not those a function in it binds for itself. */
export function mentions(e: ts.Node): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node, scope: Scope, inType: boolean): void => {
    if (ts.isIdentifier(node)) {
      if (!(inType ? scope.types : scope.values).has(node.text)) names.add(node.text);
      return;
    }
    const own = bindsOf(node);
    const here: Scope = own === null ? scope : { values: new Set([...scope.values, ...own.values]), types: new Set([...scope.types, ...own.types]) };
    const down = (child: ts.Node | undefined, type: boolean): void => (child === undefined ? undefined : visit(child, here, type));
    if (ts.isParameter(node) || ts.isBindingElement(node)) {
      // The name it declares is not a mention; what is written in it (a type, a default value, a computed key, a nested pattern) is.
      if (ts.isParameter(node)) down(node.type, true);
      else if (node.propertyName !== undefined && ts.isComputedPropertyName(node.propertyName)) down(node.propertyName, inType);
      down(node.initializer, false);
      if (!ts.isIdentifier(node.name)) down(node.name, false);
      return;
    }
    if (ts.isTypeParameterDeclaration(node)) {
      down(node.constraint, true);
      down(node.default, true);
      return;
    }
    if (ts.isTypeQueryNode(node)) {
      down(node.exprName, false); // `typeof helper` names a value
      node.typeArguments?.forEach((argument) => down(argument, true)); // `typeof factory<Options>`: the arguments are types, and name things too (R82)
      return;
    }
    const type = inType || ts.isTypeNode(node);
    ts.forEachChild(node, (child) => {
      if (isKeyOf(node, child)) return; // `a.helper`, `{ helper: 1 }`, `{ helper: number }`: a name of something, not a mention of a local
      visit(child, here, type);
    });
  };
  visit(e, { values: new Set(), types: new Set() }, false);
  return [...names];
}
