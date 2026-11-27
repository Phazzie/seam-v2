// The silent-catch rule. A catch swallows an error unless it throws, or really uses the error it caught.
//
// Exactly:
//  - A catch clause is SILENT unless its block contains a `throw` statement, or names the caught
//    variable (any name bound by `catch (e)` or `catch ({ message })`) somewhere in real use.
//  - `return` does not help: a catch that hands back a default has still swallowed the error. A catch
//    with no variable (`catch {}`) can only be loud by throwing.
//  - A throw inside a function nested in the catch does not count, because it does not leave the catch.
//    A use of the error inside a nested function does count (`list.forEach(() => log(e))`).
//  - Not a real use: `x.e` (a property that happens to share the name), `{ e: 1 }` (a key), `void e;`
//    and a bare `e;`. Those are the ways to look at an error and still ignore it.
//  - `promise.catch(callback)` follows the same rule, with the callback's parameters as the caught
//    variables, when the callback is written out in place. A callback passed by name can't be judged.
import ts from 'typescript';
import { someNode } from './rulewalk.ts';

/** Every name a binding brings in: `e`, or `message` and `code` from `{ message, code }`. */
function boundNames(name: ts.BindingName | undefined): string[] {
  if (!name) return [];
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  for (const element of name.elements) if (!ts.isOmittedExpression(element)) names.push(...boundNames(element.name));
  return names;
}

/** Is this name, written in the catch, a real use of the error? */
function isUse(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  return !ts.isExpressionStatement(parent) && !ts.isVoidExpression(parent);
}

/** Does `body` throw out of itself, or really use one of the `names`? */
function handles(body: ts.Node, names: readonly string[]): boolean {
  if (someNode(body, ts.isThrowStatement, ts.isFunctionLike)) return true;
  return someNode(body, (node) => ts.isIdentifier(node) && names.includes(node.text) && isUse(node));
}

/** Is `fn` a callback written out in place (an arrow or a function expression)? */
const isCallback = (fn: ts.Node | undefined): fn is ts.ArrowFunction | ts.FunctionExpression =>
  fn !== undefined && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn));

/** Does the file have a catch clause, or a `.catch(callback)`, that swallows what it catches? */
export function hasSilentCatch(sf: ts.SourceFile): boolean {
  return someNode(sf, (node) => {
    if (ts.isCatchClause(node)) return !handles(node.block, boundNames(node.variableDeclaration?.name));
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'catch') return false;
    const callback = node.arguments[0];
    return isCallback(callback) && !handles(callback.body, callback.parameters.flatMap((p) => boundNames(p.name)));
  });
}
