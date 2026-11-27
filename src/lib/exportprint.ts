// What a file exports, and one hash per exported name: the hash of the declaration printed without
// its body. A function's signature, a class's method signatures and an arrow function's parameters
// and types are all in the hash; the code inside them is not.
import ts from 'typescript';
import { print, withoutBody, withoutFnBody } from './printing.ts';
import { hash } from './text.ts';

const f = ts.factory;

export function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)));
}

const LET_CONST_USING = ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using;

/** The names an import brings in. */
export function importedNames(clause: ts.ImportClause): string[] {
  const { name, namedBindings } = clause;
  const named = !namedBindings ? [] : ts.isNamespaceImport(namedBindings) ? [namedBindings.name] : namedBindings.elements.map((e) => e.name);
  return [...(name ? [name] : []), ...named].map((id) => id.text);
}

/** The names a statement declares, each with the declaration printed without its body. */
export function declared(stmt: ts.Statement, sf: ts.SourceFile): [string, string][] {
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

/** `exports.x = ...` and `module.exports = ...`: another way to export from a file. */
export function commonJsAssignment(stmt: ts.Statement): { left: ts.Expression; right: ts.Expression } | null {
  if (!ts.isExpressionStatement(stmt) || !ts.isBinaryExpression(stmt.expression)) return null;
  const { left, right, operatorToken } = stmt.expression;
  if (operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  let root: ts.Expression = left;
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root)) root = root.expression;
  return ts.isIdentifier(root) && (root.text === 'exports' || root.text === 'module') ? { left, right } : null;
}

/** The names an expression mentions, once each, in the order they first appear. */
function mentions(e: ts.Node): string[] {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(e);
  return [...names];
}

/** The local declarations of a file: what each local name is printed as, and the other names a local variable's value mentions. */
interface Locals {
  readonly pieces: ReadonlyMap<string, string[]>;
  readonly built: ReadonlyMap<string, string[]>;
}

function localsOf(sf: ts.SourceFile): Locals {
  const pieces = new Map<string, string[]>();
  const built = new Map<string, string[]>();
  for (const stmt of sf.statements) {
    for (const [name, piece] of declared(stmt, sf)) pieces.set(name, [...(pieces.get(name) ?? []), piece]);
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (d.initializer) for (const name of bindingNames(d.name)) built.set(name, mentions(withoutFnBody(d.initializer)));
    }
  }
  return { pieces, built };
}

/**
 * The signatures of the local things `names` stand for, and of whatever a local variable among them is made of,
 * and so on: with `function work(a: number)` and `const alias = work`, `export { alias as total }` carries the
 * signature of `work` too, so changing `work`'s parameters is a change to what `total` is.
 */
function reach(names: readonly string[], locals: Locals): string[] {
  const order = [...names];
  for (let i = 0; i < order.length; i += 1) {
    for (const next of locals.built.get(order[i]) ?? []) if (!order.includes(next)) order.push(next);
  }
  return order.flatMap((name) => locals.pieces.get(name) ?? []);
}

/** The signatures of the local things an exported value points at: `export default total`, `{ total }`, `exports.x = total`. */
const referenced = (e: ts.Expression, locals: Locals): string[] => reach(mentions(e), locals);

/** Each exported name, mapped to the hash of its declaration printed without its body. */
export function collectExports(sf: ts.SourceFile): Record<string, string> {
  const locals = localsOf(sf);
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
          const own = spec !== null ? [`reexport ${local} from ${spec}`] : locals.pieces.has(local) ? reach([local], locals) : [`unresolved ${local}`];
          add(el.name.text, ...own);
        }
      }
    } else if (ts.isExportAssignment(stmt)) {
      const value = withoutFnBody(stmt.expression);
      add(stmt.isExportEquals ? 'export=' : 'default', print(f.updateExportAssignment(stmt, stmt.modifiers, value), sf), ...referenced(value, locals));
    } else if (ts.isNamespaceExportDeclaration(stmt)) {
      add(`as namespace ${stmt.name.text}`, 'global');
    } else if (hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(stmt, ts.SyntaxKind.DefaultKeyword)) {
        add('default', print(withoutBody(stmt), sf));
      } else {
        const values = ts.isVariableStatement(stmt) ? stmt.declarationList.declarations.flatMap((d) => (d.initializer ? [withoutFnBody(d.initializer)] : [])) : [];
        for (const [name, piece] of declared(stmt, sf)) add(name, piece, ...values.flatMap((v) => referenced(v, locals)));
      }
    } else {
      const cjs = commonJsAssignment(stmt);
      if (cjs) {
        const value = withoutFnBody(cjs.right);
        add(cjs.left.getText(sf).replace(/\s+/g, ''), print(value, sf), ...referenced(value, locals));
      }
    }
  }
  const byName = [...pieces].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(byName.map(([name, parts]) => [name, hash(parts.join('\n'))]));
}
