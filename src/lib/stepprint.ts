// The `// Step N: text` markers in a file, grouped by the function each one sits in. Markers are read
// from the comments the parser finds, so a "// Step" inside a string, a template or JSX text is not one.
import ts from 'typescript';

const MARKER = /^\/\/\s*Step\s+(\d+)\s*:(.*)$/;

type BodyNode = (
  | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
  | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ClassStaticBlockDeclaration
) & { body: ts.Node };

interface Scope { start: number; end: number; key: string }

const isBodyNode = (node: ts.Node): node is BodyNode =>
  (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isClassStaticBlockDeclaration(node)) && node.body !== undefined;

function memberName(name: ts.PropertyName, sf: ts.SourceFile): string {
  return ts.isComputedPropertyName(name) ? `[${name.expression.getText(sf)}]` : name.text;
}

/** What a function expression or arrow is assigned to, if anything: `const f = ...`, `{ f: ... }`, `x.f = ...`. */
function assignedName(node: ts.Node, sf: ts.SourceFile): string | null {
  let at = node.parent;
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isNonNullExpression(at)) at = at.parent;
  if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
  if (ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) return memberName(at.name, sf);
  if (ts.isExportAssignment(at)) return 'default';
  if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.EqualsToken) return at.left.getText(sf);
  return null;
}

function labelOf(node: BodyNode, sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isClassStaticBlockDeclaration(node)) return 'static';
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return memberName(node.name, sf);
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text;
  return assignedName(node, sf) ?? (ts.isFunctionDeclaration(node) ? 'default' : '(anonymous)');
}

/**
 * Every function with a body, named by the functions and classes around it (`outer>inner`). A second
 * function with the same name gets `#2`, so a marker moved into a look-alike is still a different place.
 */
function functionScopes(sf: ts.SourceFile): Scope[] {
  const scopes: Scope[] = [];
  const seen = new Map<string, number>();
  const walk = (node: ts.Node, path: string[]): void => {
    let inside = path;
    if (isBodyNode(node)) {
      inside = [...path, labelOf(node, sf)];
      const base = inside.join('>');
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      scopes.push({ start: node.body.getStart(sf), end: node.body.end, key: count === 1 ? base : `${base}#${count}` });
    } else if (ts.isClassLike(node)) {
      inside = [...path, node.name?.text ?? '(class)'];
    }
    ts.forEachChild(node, (child) => walk(child, inside));
  };
  walk(sf, []);
  return scopes;
}

/** JSX text can hold `//` and `/*` that are not comments, and it starts right where the tag before it ends. */
function endsBeforeJsxText(node: ts.Node): boolean {
  if (ts.isSourceFile(node)) return false;
  if (ts.isJsxOpeningElement(node) || ts.isJsxOpeningFragment(node)) return true;
  if (ts.isJsxClosingElement(node) || ts.isJsxClosingFragment(node)) return endsBeforeJsxText(node.parent);
  return node.kind === ts.SyntaxKind.JsxText || ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
}

/** Every `//` comment in the file, found where the parser says whitespace and comments can be. */
function lineComments(sf: ts.SourceFile): { pos: number; text: string }[] {
  const found = new Map<number, string>();
  const take = (pos: number): void => {
    const ranges = [...(ts.getLeadingCommentRanges(sf.text, pos) ?? []), ...(ts.getTrailingCommentRanges(sf.text, pos) ?? [])];
    for (const r of ranges) if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) found.set(r.pos, sf.text.slice(r.pos, r.end));
  };
  const visit = (node: ts.Node): void => {
    if (node.kind !== ts.SyntaxKind.JsxText) take(node.getFullStart());
    if (!endsBeforeJsxText(node)) take(node.end);
    if (ts.isBlock(node)) take(node.getStart(sf) + 1); // a comment alone in an empty block
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found].map(([pos, text]) => ({ pos, text })).sort((a, b) => a.pos - b.pos);
}

/** For each function that has step markers: its markers in order, as `Step N: text` with the spaces squeezed. */
export function collectSteps(sf: ts.SourceFile): Record<string, string[]> {
  const scopes = functionScopes(sf);
  const steps = new Map<string, string[]>();
  for (const { pos, text } of lineComments(sf)) {
    const marker = MARKER.exec(text);
    const owner = scopes.filter((s) => s.start <= pos && pos < s.end).sort((a, b) => b.start - a.start)[0];
    if (!marker || !owner) continue;
    const words = marker[2].replace(/[ \t]+/g, ' ').replace(/^ | $/g, ''); // only plain spaces and tabs are squeezed
    steps.set(owner.key, [...(steps.get(owner.key) ?? []), `Step ${marker[1]}:${words ? ` ${words}` : ''}`]);
  }
  return Object.fromEntries(steps);
}
