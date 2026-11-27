// One small tree search shared by the code rules, so each rule reads as the question it asks.
import ts from 'typescript';

/**
 * Does `test` hold for `root` or any node below it? A node that `skip` accepts is tested but not
 * searched inside (used to leave nested functions out).
 */
export function someNode(root: ts.Node, test: (node: ts.Node) => boolean, skip: (node: ts.Node) => boolean = () => false): boolean {
  if (test(root)) return true;
  if (skip(root)) return false;
  return ts.forEachChild(root, (child) => someNode(child, test, skip) || undefined) === true;
}
