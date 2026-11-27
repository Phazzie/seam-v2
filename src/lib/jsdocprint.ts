// In a .js or .jsx file the types of a declaration are written in JSDoc tags (`@param {number} a`,
// `@returns {string}`, `@type {Foo}`), and the printer drops comments, so they would not be in its fingerprint.
// This gives the type tags of a declaration as text to add to what is hashed. Only the tags that carry a type
// count, and only the type part of each: the words after it (`@param {number} a The first price`) do not, so
// rewording a description is not a change. In a .ts file JSDoc types mean nothing, so nothing is added.
import ts from 'typescript';

const JS_FILE = /\.(?:[cm]?js|jsx)$/i;
/** Spellings that mean the same tag. */
const SAME_TAG: Readonly<Record<string, string>> = { return: 'returns', arg: 'param', argument: 'param' };

const isTypeTag = (tag: ts.JSDocTag): boolean =>
  ts.isJSDocParameterTag(tag) || ts.isJSDocReturnTag(tag) || ts.isJSDocTypeTag(tag) || ts.isJSDocTemplateTag(tag)
  || ts.isJSDocThisTag(tag) || ts.isJSDocSatisfiesTag(tag) || ts.isJSDocAugmentsTag(tag) || ts.isJSDocImplementsTag(tag)
  || ts.isJSDocEnumTag(tag) || ts.isJSDocPropertyTag(tag);

/** The words of a tag's description are made of these nodes; the tag's type and name are not. */
const isDescription = (node: ts.Node): boolean =>
  node.kind === ts.SyntaxKind.JSDocText || ts.isJSDocLink(node) || ts.isJSDocLinkCode(node) || ts.isJSDocLinkPlain(node);

/** Where an optional parameter's `[name=default]` ends, when the name has been read and the `=default]` is still to come. */
function afterBracket(text: string, from: number): number {
  let depth = 1;
  for (let i = from; i < text.length && text[i] !== '\n'; i += 1) {
    if (text[i] === '[') depth += 1;
    if (text[i] === ']') depth -= 1;
    if (depth === 0) return i + 1;
  }
  return from;
}

/** One tag without its description, on one line: `@param {number} a`, `@returns {string}`. */
function tagSignature(tag: ts.JSDocTag, sf: ts.SourceFile): string {
  let end = tag.tagName.end;
  ts.forEachChild(tag, (child) => { if (!isDescription(child)) end = Math.max(end, child.end); });
  if (ts.isJSDocParameterTag(tag) && tag.isBracketed) end = afterBracket(sf.text, end);
  const rest = sf.text.slice(tag.tagName.end, end).replace(/\s*\n\s*\*?\s*/g, ' ').replace(/\s+/g, ' ').trimEnd();
  const name = tag.tagName.text;
  return `@${SAME_TAG[name] ?? name}${rest}`;
}

/**
 * The type tags of `node` and of what is declared inside it (members, parameters, values), not of the code in its
 * function bodies, as lines to add to the printed declaration. Empty for a file that is not JavaScript or has none.
 */
export function jsdocTypes(node: ts.Node, sf: ts.SourceFile): string {
  if (!JS_FILE.test(sf.fileName)) return '';
  const found = new Map<number, string>(); // by position, so a tag reached twice (a parameter's, then its function's) counts once
  const visit = (n: ts.Node): void => {
    for (const tag of ts.getJSDocTags(n)) if (isTypeTag(tag)) found.set(tag.pos, tagSignature(tag, sf));
    const code = ts.isFunctionLike(n) ? (n as ts.FunctionLikeDeclaration).body : ts.isClassStaticBlockDeclaration(n) ? n.body : undefined;
    ts.forEachChild(n, (child) => { if (child !== code) visit(child); });
  };
  visit(node);
  return [...found].sort(([a], [b]) => a - b).map(([, text]) => `\n${text}`).join('');
}
