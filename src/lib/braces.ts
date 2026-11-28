// What the braces of a glob stand for: `{a,{b,c}}` is a, b and c, and `x/{a,b}/y` is x/a/y and x/b/y. A check of a glob (is there an
// env file among what it could match?) has to look at each alternative, not at the glob's text, or `{.env.local,src/*.ts}` is read
// as ending in `*.ts}`.

/** More alternatives than this are not made: a glob that stands for so many is not one a check can go through one by one. */
export const MAX_ALTERNATIVES = 256;

/** The index of the `}` that closes the `{` at `open`, or -1 if it is never closed. */
function closing(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i += 1) {
    if (glob[i] === '{') depth += 1;
    else if (glob[i] === '}' && (depth -= 1) === 0) return i;
  }
  return -1;
}

/** The inside of a brace, cut at the commas that are its own (not those of a brace inside it). */
function pieces(inner: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '{') depth += 1;
    else if (inner[i] === '}') depth -= 1;
    else if (inner[i] === ',' && depth === 0) {
      found.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  found.push(inner.slice(start));
  return found;
}

/** The first `{` that has a `}` to close it, as [open, close], or null. A brace that is never closed is only a character. */
function firstGroup(glob: string): [number, number] | null {
  for (let open = glob.indexOf('{'); open >= 0; open = glob.indexOf('{', open + 1)) {
    const close = closing(glob, open);
    if (close >= 0) return [open, close];
  }
  return null;
}

/**
 * Every alternative the braces of `glob` stand for, nested ones too. A glob with no brace is its own only alternative, and so is a
 * brace that is never closed. Null if there would be more than MAX_ALTERNATIVES (the caller must then treat the glob as one it cannot check).
 */
export function alternatives(glob: string): string[] | null {
  const made: string[] = [];
  const todo = [glob];
  for (let next = todo.pop(); next !== undefined; next = todo.pop()) {
    const group = firstGroup(next);
    if (group === null) {
      made.push(next);
    } else {
      const [open, close] = group;
      for (const piece of pieces(next.slice(open + 1, close))) todo.push(`${next.slice(0, open)}${piece}${next.slice(close + 1)}`);
    }
    if (made.length + todo.length > MAX_ALTERNATIVES) return null;
  }
  return made;
}
