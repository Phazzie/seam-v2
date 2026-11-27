// What a file exports, and one hash per exported name: the hash of the declaration printed without
// its body. A function's signature, a class's method signatures and an arrow function's parameters
// and types are all in the hash; the code inside them is not.
import ts from 'typescript';
import { hash } from './text.ts';

const f = ts.factory;
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/** Print a node, leaving off a leading `export` / `export default`, so `export function x` and `function x` + `export { x }` match. */
function print(node: ts.Node, sf: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/^export\s+(?:default\s+)?/, '');
}

function withoutFnBody(init: ts.Expression): ts.Expression {
  if (ts.isArrowFunction(init)) {
    return f.updateArrowFunction(init, init.modifiers, init.typeParameters, init.parameters, init.type, init.equalsGreaterThanToken, f.createBlock([]));
  }
  if (ts.isFunctionExpression(init)) {
    return f.updateFunctionExpression(init, init.modifiers, init.asteriskToken, init.name, init.typeParameters, init.parameters, init.type, f.createBlock([]));
  }
  return init;
}

function memberWithoutBody(m: ts.ClassElement): ts.ClassElement {
  if (ts.isMethodDeclaration(m)) return f.updateMethodDeclaration(m, m.modifiers, m.asteriskToken, m.name, m.questionToken, m.typeParameters, m.parameters, m.type, undefined);
  if (ts.isConstructorDeclaration(m)) return f.updateConstructorDeclaration(m, m.modifiers, m.parameters, undefined);
  if (ts.isGetAccessorDeclaration(m)) return f.updateGetAccessorDeclaration(m, m.modifiers, m.name, m.parameters, m.type, undefined);
  if (ts.isSetAccessorDeclaration(m)) return f.updateSetAccessorDeclaration(m, m.modifiers, m.name, m.parameters, undefined);
  if (ts.isClassStaticBlockDeclaration(m)) return f.updateClassStaticBlockDeclaration(m, f.createBlock([]));
  if (ts.isPropertyDeclaration(m) && m.initializer) {
    return f.updatePropertyDeclaration(m, m.modifiers, m.name, m.questionToken ?? m.exclamationToken, m.type, withoutFnBody(m.initializer));
  }
  return m;
}

/** The same declaration with the code of its functions taken out. */
function withoutBody(node: ts.Node): ts.Node {
  if (ts.isFunctionDeclaration(node)) {
    return f.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, undefined);
  }
  if (ts.isClassDeclaration(node)) {
    return f.updateClassDeclaration(node, node.modifiers, node.name, node.typeParameters, node.heritageClauses, node.members.map(memberWithoutBody));
  }
  return node;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)));
}

const LET_CONST_USING = ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using;

/** The names an import brings in. */
function importedNames(clause: ts.ImportClause): string[] {
  const { name, namedBindings } = clause;
  const named = !namedBindings ? [] : ts.isNamespaceImport(namedBindings) ? [namedBindings.name] : namedBindings.elements.map((e) => e.name);
  return [...(name ? [name] : []), ...named].map((id) => id.text);
}

/** The names a statement declares, each with the declaration printed without its body. */
function declared(stmt: ts.Statement, sf: ts.SourceFile): [string, string][] {
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)
    || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isModuleDeclaration(stmt)) {
    return stmt.name ? [[stmt.name.text, print(withoutBody(stmt), sf)]] : [];
  }
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.flatMap((d) => {
      const one = f.updateVariableDeclaration(d, d.name, d.exclamationToken, d.type, d.initializer && withoutFnBody(d.initializer));
      const list = f.createVariableDeclarationList([one], stmt.declarationList.flags & LET_CONST_USING);
      const piece = print(f.createVariableStatement(stmt.modifiers, list), sf);
      return bindingNames(d.name).map((name): [string, string] => [name, piece]);
    });
  }
  if (ts.isImportEqualsDeclaration(stmt)) return [[stmt.name.text, print(stmt, sf)]];
  if (ts.isImportDeclaration(stmt) && stmt.importClause) return importedNames(stmt.importClause).map((n): [string, string] => [n, print(stmt, sf)]);
  return [];
}

const modifiersOf = (stmt: ts.Statement): readonly ts.Modifier[] => (ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) ?? [] : []);
const hasModifier = (stmt: ts.Statement, kind: ts.SyntaxKind): boolean => modifiersOf(stmt).some((m) => m.kind === kind);

/** `exports.x = ...` and `module.exports = ...`: another way to export from a file. Returns the left side. */
function commonJsTarget(stmt: ts.Statement): ts.Expression | null {
  if (!ts.isExpressionStatement(stmt) || !ts.isBinaryExpression(stmt.expression)) return null;
  if (stmt.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  let root: ts.Expression = stmt.expression.left;
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
  return ts.isIdentifier(root) && (root.text === 'exports' || root.text === 'module') ? stmt.expression.left : null;
}

/** Each exported name, mapped to the hash of its declaration printed without its body. */
export function collectExports(sf: ts.SourceFile): Record<string, string> {
  const locals = new Map<string, string[]>();
  for (const stmt of sf.statements) {
    for (const [name, piece] of declared(stmt, sf)) locals.set(name, [...(locals.get(name) ?? []), piece]);
  }
  const pieces = new Map<string, string[]>();
  const add = (name: string, ...more: string[]): void => void pieces.set(name, [...(pieces.get(name) ?? []), ...more]);

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      const spec = stmt.moduleSpecifier && ts.isStringLiteralLike(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
      const clause = stmt.exportClause;
      if (!clause) add(`* from ${spec}`, `reexport * from ${spec}`);
      else if (ts.isNamespaceExport(clause)) add(clause.name.text, `reexport * as ${clause.name.text} from ${spec}`);
      else {
        for (const el of clause.elements) {
          const local = (el.propertyName ?? el.name).text;
          add(el.name.text, ...(spec !== null ? [`reexport ${local} from ${spec}`] : locals.get(local) ?? [`unresolved ${local}`]));
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      const target = ts.isIdentifier(stmt.expression) ? locals.get(stmt.expression.text) ?? [] : [];
      add(stmt.isExportEquals ? 'export=' : 'default', print(f.updateExportAssignment(stmt, stmt.modifiers, withoutFnBody(stmt.expression)), sf), ...target);
    } else if (ts.isNamespaceExportDeclaration(stmt)) {
      add(`as namespace ${stmt.name.text}`, 'global');
    } else if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) add('default', print(withoutBody(stmt), sf));
      else for (const [name, piece] of declared(stmt, sf)) add(name, piece);
    } else {
      const target = commonJsTarget(stmt);
      if (target) add(target.getText(sf).replace(/\s+/g, ''), print(stmt, sf));
    }
  }
  const byName = [...pieces].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(byName.map(([name, parts]) => [name, hash(parts.join('\n'))]));
}
