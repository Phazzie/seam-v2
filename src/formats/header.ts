// The header every planned code file starts with, and how to read it back.
// Layout (a JSDoc block):
//   /**
//    * @seam pricing
//    * Purpose: ...
//    * Inputs: ...
//    * Outputs: ...
//    * Steps:
//    *  1. text
//    * Promises:
//    *  P-pricing-1: text
//    */
// Step markers inside function bodies are separate lines: `// Step N: <text>`.
import type { FilePlan } from './plan.ts';

/** Why `text` cannot go into a header line, or null if it can. */
export function headerTextProblem(text: string): string | null {
  if (text.length === 0) return "can't be empty";
  if (/[\r\n]/.test(text) || text !== text.trim() || text.includes('*/')) {
    return "must be a single line with no spaces at either end and no '*/' in it";
  }
  return null;
}

/** The header text for one planned file. No trailing newline. */
export function formatHeader(seam: string, file: FilePlan): string {
  const texts = [file.purpose, file.inputs, file.outputs, ...file.steps, ...file.promises.map((p) => p.text)];
  for (const text of texts) {
    const problem = headerTextProblem(text);
    if (problem) throw new Error(`The header for ${file.path} can't hold "${text}": it ${problem}.`);
  }
  return [
    '/**',
    ` * @seam ${seam}`,
    ` * Purpose: ${file.purpose}`,
    ` * Inputs: ${file.inputs}`,
    ` * Outputs: ${file.outputs}`,
    ' * Steps:',
    ...file.steps.map((step, i) => ` *  ${i + 1}. ${step}`),
    ' * Promises:',
    ...file.promises.map((p) => ` *  ${p.id}: ${p.text}`),
    ' */',
  ].join('\n');
}

export interface ParsedHeader {
  seam: string;
  steps: string[];
  promises: { id: string; text: string }[];
}

/**
 * Read the seam, steps and promises from the header at the very top of a file.
 * Returns null if the file doesn't start with a seam header.
 */
export function parseHeader(text: string): ParsedHeader | null {
  // In JavaScript, \s also matches a leading BOM, so a BOM before the header is fine.
  const block = /^\s*\/\*\*([\s\S]*?)\*\//.exec(text);
  if (!block) return null;
  let seam: string | null = null;
  let section: 'other' | 'steps' | 'promises' = 'other';
  const steps: string[] = [];
  const promises: { id: string; text: string }[] = [];
  for (const line of block[1].split(/\r?\n/)) {
    const content = /^\s*\* ?(.*)$/.exec(line)?.[1];
    if (content === undefined) continue;
    const seamLine = /^@seam (\S+)$/.exec(content);
    if (seamLine) {
      seam ??= seamLine[1];
    } else if (content === 'Steps:') {
      section = 'steps';
    } else if (content === 'Promises:') {
      section = 'promises';
    } else if (/^(Purpose|Inputs|Outputs):/.test(content)) {
      section = 'other';
    } else if (section === 'steps') {
      const step = /^ \d+\. (.*)$/.exec(content);
      if (step) steps.push(step[1]);
    } else if (section === 'promises') {
      const promise = /^ (P-[a-z0-9-]+-\d+): (.*)$/.exec(content);
      if (promise) promises.push({ id: promise[1], text: promise[2] });
    }
  }
  return seam === null ? null : { seam, steps, promises };
}
