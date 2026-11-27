// The fingerprint of one code file: what a builder may not change, recorded by named item so the
// function bodies can change freely. See collectExports (signatures) and collectSteps (step markers).
import ts from 'typescript';
import type { FileLock } from '../formats/lock.ts';
import { collectExports } from './exportprint.ts';
import { collectSteps } from './stepprint.ts';
import { hash, normalize } from './text.ts';

export type CodeLock = Extract<FileLock, { kind: 'code' }>;

/** The file kinds the parser reads, by extension. Anything else is read as TypeScript. */
function scriptKindOf(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
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

/** Fingerprint a file's text. TSX/JSX files are read with JSX on. Line endings and a BOM make no difference. */
export function fingerprintCode(path: string, text: string): CodeLock {
  const source = normalize(text);
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKindOf(path));
  return { kind: 'code', header: headerHash(source), exports: collectExports(sf), steps: collectSteps(sf), plannedImports: moduleSpecifiers(sf) };
}
