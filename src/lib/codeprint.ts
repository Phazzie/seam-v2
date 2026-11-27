// The fingerprint of one code file: what a builder may not change, recorded by named item so the
// function bodies can change freely. See collectExports (signatures), collectFixed (local types) and
// analyzeSteps (step markers).
import ts from 'typescript';
import type { FileLock } from '../formats/lock.ts';
import { collectExports } from './exportprint.ts';
import { collectFixed } from './fixedprint.ts';
import { analyzeSteps } from './stepprint.ts';
import type { StepAnalysis } from './stepprint.ts';
import { hash, normalize } from './text.ts';
import { collectTypeRefs } from './typerefs.ts';

export type CodeLock = Extract<FileLock, { kind: 'code' }>;

/** The file kinds the parser reads, by extension. Anything else is read as TypeScript. */
function scriptKindOf(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Read a file's text. TSX/JSX files are read with JSX on. Line endings and a BOM make no difference. */
export function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, normalize(text), ts.ScriptTarget.Latest, true, scriptKindOf(path));
}

/** "the file doesn't parse: <first error> (line N)", or null if the parser found nothing wrong. */
export function parseProblem(sf: ts.SourceFile): string | null {
  // The parser's own list of what it could not read. It is not in the public typings, so check it is really there.
  const found = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (!Array.isArray(found)) throw new Error("This TypeScript version doesn't report parse errors the way the guard expects, so files can't be checked.");
  const first = found[0] as ts.Diagnostic | undefined;
  if (!first) return null;
  const line = first.start === undefined ? '' : ` (line ${sf.getLineAndCharacterOfPosition(first.start).line + 1})`;
  return `the file doesn't parse: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}${line}`;
}

/** Hash of the JSDoc block at the very top of the file; empty if the file does not start with one. */
function headerHash(text: string): string {
  const first = ts.getLeadingCommentRanges(text, 0)?.[0];
  if (!first || first.kind !== ts.SyntaxKind.MultiLineCommentTrivia || !text.startsWith('/**', first.pos)) return '';
  return hash(text.slice(first.pos, first.end));
}

/** Every module the file imports or re-exports from, sorted, once each. */
function moduleSpecifiers(sf: ts.SourceFile): string[] {
  const specs: string[] = [];
  for (const stmt of sf.statements) {
    if ((ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) && stmt.moduleSpecifier && ts.isStringLiteralLike(stmt.moduleSpecifier)) {
      specs.push(stmt.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(stmt) && ts.isExternalModuleReference(stmt.moduleReference) && ts.isStringLiteralLike(stmt.moduleReference.expression)) {
      specs.push(stmt.moduleReference.expression.text);
    }
  }
  return [...new Set(specs)].sort();
}

/** Fingerprint a file that has been read already. */
export function fingerprintSource(sf: ts.SourceFile, analysis: StepAnalysis = analyzeSteps(sf)): CodeLock {
  return {
    kind: 'code', header: headerHash(sf.text), exports: collectExports(sf), fixed: collectFixed(sf), typeRefs: collectTypeRefs(sf),
    steps: analysis.steps, plannedImports: moduleSpecifiers(sf),
  };
}

/** Fingerprint a file's text. */
export function fingerprintCode(path: string, text: string): CodeLock {
  return fingerprintSource(parseSource(path, text));
}
