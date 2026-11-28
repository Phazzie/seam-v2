// The house rules for code a builder writes, and the one rule for contracts. Each rule is checked on the
// syntax tree (see rulecatch.ts and rulebanned.ts for the harder ones), so a word in a comment or a
// string never counts. Every problem comes back as a plain phrase that reads after the file name
// ("src/pricing/total.ts uses the any type"), once each, however many times it happens.
import { posix } from 'node:path';
import ts from 'typescript';
import { parseProblem, parseSource } from './codeprint.ts';
import { readsEnv, usesBannedCall } from './rulebanned.ts';
import { hasSilentCatch } from './rulecatch.ts';
import { someNode } from './rulewalk.ts';

/** The most lines one file may have. */
const LINE_LIMIT = 200;
/** The data files the rules leave alone. Every other path is read as a script, so an odd spelling of a script's name (a trailing dot, which Windows ignores) is checked, not skipped. */
const DATA = /\.(?:json|sql)$/i;
/** `@ts-ignore`, `@ts-nocheck` and `@ts-expect-error` at the start of any line of a comment. */
const DIRECTIVE = /^[\s/*]*@ts-(?:ignore|nocheck|expect-error)\b/m;

/** Lines in already-normalized text. A last newline ends the last line; it does not start another. */
const lineCount = (text: string): number => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** Is this file under `src/config/`, the one place that may read the environment? `relPath` is the plan's spelling. */
const inConfigFolder = (relPath: string): boolean => posix.normalize(relPath.replace(/\\/g, '/')).startsWith('src/config/');

/**
 * The text of every comment in the file. They are found from the tokens the parser read (a comment is
 * the trivia in front of a token), so a `//` inside a string, a regular expression, a template or JSX
 * text is never taken for one.
 */
function commentsOf(sf: ts.SourceFile): string[] {
  const found = new Map<number, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJSDoc(node) || ts.isJsxText(node)) return;
    const children = node.getChildren(sf);
    if (children.length > 0) return children.forEach(visit);
    // Leading ranges stop at the first line break; trailing ones are the rest of that first line.
    const ranges = [...(ts.getLeadingCommentRanges(sf.text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(sf.text, node.pos) ?? [])];
    for (const range of ranges) found.set(range.pos, sf.text.slice(range.pos, range.end));
  };
  visit(sf);
  return [...found.values()];
}

/**
 * What is wrong with this code file, in plain words: the any type, ts-ignore, a silent catch, more than
 * 200 lines, process.env read outside `src/config/`, and fs / require / dynamic import. A file that
 * does not parse is refused too. `relPath` is the file's path in the plan's spelling, with / or \.
 * A data file (.json or .sql) has none of these rules to break.
 */
export function codeRuleProblems(relPath: string, text: string): string[] {
  if (DATA.test(relPath)) return [];
  const sf = parseSource(relPath, text);
  const lines = lineCount(sf.text);
  const found = [
    parseProblem(sf),
    someNode(sf, (node) => node.kind === ts.SyntaxKind.AnyKeyword) && 'uses the any type',
    commentsOf(sf).some((comment) => DIRECTIVE.test(comment)) && 'uses ts-ignore',
    hasSilentCatch(sf) && 'has a silent catch',
    lines > LINE_LIMIT && `is ${lines} lines; the limit is ${LINE_LIMIT}`,
    !inConfigFolder(relPath) && readsEnv(sf) && 'reads process.env outside src/config',
    usesBannedCall(sf) && 'uses fs/require/dynamic import, which builder code may not',
  ];
  return found.filter((problem): problem is string => typeof problem === 'string');
}

/** A function that has a body: the only kind that is code. A signature (`declare function f(): void`) is a type. */
function isCodeFunction(node: ts.Node): boolean {
  const isFunction = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
  return isFunction && node.body !== undefined;
}

/** The call a function was handed to, as the owner would read it: `.refine` for `x.refine(...)`, `wrap()` for `wrap(...)`. */
function enclosingCall(fn: ts.Node): string | null {
  let child: ts.Node = fn;
  for (let parent = fn.parent; parent && !ts.isBlock(parent) && !ts.isSourceFile(parent); child = parent, parent = parent.parent) {
    if (!ts.isCallExpression(parent) || !parent.arguments.some((arg) => arg === child)) continue;
    if (ts.isPropertyAccessExpression(parent.expression)) return `.${parent.expression.name.text}`;
    return ts.isIdentifier(parent.expression) ? `${parent.expression.text}()` : null;
  }
  return null;
}

/**
 * What is wrong with this contract: any function with a body, anywhere in it (`.refine(s => ...)`,
 * `.transform(...)`, a method, a getter), because contracts hold schemas and types and no code. The
 * message names the call the function was handed to when there is one. A contract that does not parse is
 * refused, so a mangled file can't hide a function.
 */
export function contractProblems(text: string): string[] {
  const sf = parseSource('contract.ts', text);
  const found = new Set<string>();
  const parseError = parseProblem(sf);
  if (parseError) found.add(parseError);
  const visit = (node: ts.Node): void => {
    if (!isCodeFunction(node)) return void ts.forEachChild(node, visit);
    const call = enclosingCall(node);
    found.add(`contracts may not contain code (found a function${call ? ` in ${call}` : ''})`);
  };
  visit(sf);
  return [...found];
}
