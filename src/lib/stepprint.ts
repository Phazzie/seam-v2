// The `// Step N: text` markers in a file, grouped by the function each one sits in. Markers are read
// from the comments the parser finds, so a "// Step" inside a string, a template or JSX text is not one.
import ts from 'typescript';

const MARKER = /^\/\/[ \t]*Step[ \t]+(\d+)[ \t]*:(.*)$/;

type BodyNode = (
  | ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
  | ts.ConstructorDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ClassStaticBlockDeclaration
) & { body: ts.Node };

interface Scope { start: number; end: number; key: string }

const isBodyNode = (node: ts.Node): node is BodyNode =>
  (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isClassStaticBlockDeclaration(node)) && node.body !== undefined;

const isWrapper = (node: ts.Node): boolean =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node);

function memberName(name: ts.PropertyName, sf: ts.SourceFile): string {
  return ts.isComputedPropertyName(name) ? `[${name.expression.getText(sf)}]` : name.text;
}

/** What a function, object or class expression is assigned to, if anything: `const f = ...`, `{ f: ... }`, `x.f = ...`. */
function assignedName(node: ts.Node, sf: ts.SourceFile): string | null {
  let at = node.parent;
  while (isWrapper(at)) at = at.parent;
  if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
  if (ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at)) return memberName(at.name, sf);
  if (ts.isExportAssignment(at)) return 'default';
  if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.EqualsToken) return at.left.getText(sf);
  return null;
}

/** The name a function goes by: its own, or for a function expression what it is assigned to (its own name is only visible inside it). */
function labelOf(node: BodyNode, sf: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isClassStaticBlockDeclaration(node)) return 'static';
  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return memberName(node.name, sf);
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? 'default';
  const own = ts.isFunctionExpression(node) && node.name ? `(function ${node.name.text})` : undefined; // its name is not a name in the file
  return assignedName(node, sf) ?? own ?? '(anonymous)';
}

/** A name for an object literal or class, so the functions inside it are `api>run`, never just `run`. */
function holderLabel(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isObjectLiteralExpression(node)) return assignedName(node, sf) ?? '(object)';
  if (ts.isClassDeclaration(node)) return node.name?.text ?? 'default';
  if (ts.isClassExpression(node)) return node.name?.text ?? assignedName(node, sf) ?? '(class)';
  return null;
}

/**
 * An unnamed function or arrow handed straight to a call (`list.forEach((x) => { ... })`,
 * `useEffect(() => { ... })`), as a value in an object or array given to a call (`run({ fn: () => { ... } })`),
 * or as a JSX value (`onClick={() => { ... }}`).
 */
function isInlineCallback(node: ts.Node): boolean {
  if (!(ts.isArrowFunction(node) || (ts.isFunctionExpression(node) && !node.name))) return false;
  let child: ts.Node = node;
  let at = node.parent;
  for (;;) {
    if (isWrapper(at) || ts.isArrayLiteralExpression(at)) {
      child = at; // `(() => {...})`, `[() => {...}]`
    } else if (ts.isPropertyAssignment(at) && at.initializer === child) {
      child = at.parent; // `{ fn: () => {...} }`: on to the object, whatever it is part of
    } else if (ts.isJsxExpression(at)) {
      return true; // `onClick={() => {...}}`
    } else {
      return (ts.isCallExpression(at) || ts.isNewExpression(at)) && (at.arguments ?? []).some((arg) => arg === child);
    }
    at = child.parent;
  }
}

/**
 * Every function with a body, named by what holds it (`outer>inner`, `api>run`, `Box>open`). An unnamed
 * callback given to a call is part of the function around it, so a marker inside one counts for that
 * function. Names do not depend on the order of things in the file; if two functions still end up with
 * the same name, the name is listed as ambiguous and the later one is called `name#2`.
 */
function functionScopes(sf: ts.SourceFile): { scopes: Scope[]; ambiguous: string[] } {
  const scopes: Scope[] = [];
  const seen = new Map<string, number>();
  const walk = (node: ts.Node, path: string[]): void => {
    let inside = path;
    if (isBodyNode(node) && !isInlineCallback(node)) {
      inside = [...path, labelOf(node, sf)];
      const base = inside.join('>');
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      scopes.push({ start: node.body.getStart(sf), end: node.body.end, key: count === 1 ? base : `${base}#${count}` });
    } else {
      const holder = holderLabel(node, sf);
      if (holder !== null) inside = [...path, holder];
    }
    ts.forEachChild(node, (child) => walk(child, inside));
  };
  walk(sf, []);
  return { scopes, ambiguous: [...seen].filter(([, count]) => count > 1).map(([key]) => key) };
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

export interface StepAnalysis {
  /** For each function that has step markers: its markers in order, as `Step N: text` with the spaces squeezed. */
  steps: Record<string, string[]>;
  /** Names that two or more functions in the file share, so their markers can't be told apart. */
  ambiguous: string[];
}

export function analyzeSteps(sf: ts.SourceFile): StepAnalysis {
  const { scopes, ambiguous } = functionScopes(sf);
  const steps = new Map<string, string[]>();
  for (const { pos, text } of lineComments(sf)) {
    const marker = MARKER.exec(text);
    const owner = scopes.filter((s) => s.start <= pos && pos < s.end).sort((a, b) => b.start - a.start)[0];
    if (!marker || !owner) continue;
    const words = marker[2].replace(/[ \t]+/g, ' ').replace(/^ | $/g, ''); // only plain spaces and tabs are squeezed
    steps.set(owner.key, [...(steps.get(owner.key) ?? []), `Step ${marker[1]}:${words ? ` ${words}` : ''}`]);
  }
  return { steps: Object.fromEntries(steps), ambiguous };
}
