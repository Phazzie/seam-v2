// Test helper: a small POSIX file system in memory (folders, files and links) that answers the way the
// kernel does. A link is followed the moment it is met, and a `..` is applied to the place reached so far,
// so `link/..` is the folder above what `link` points at. Used to fake `node:fs` where the real thing
// cannot be built (this machine is Windows, and a link there needs special rights).

type Entry = { kind: 'dir' } | { kind: 'file' } | { kind: 'link'; target: string };

/** An error shaped like the ones Node's fs throws, with `code` set. */
function failure(code: string, at: string): Error {
  return Object.assign(new Error(`${code}: ${at}`), { code });
}

const names = (path: string): string[] => path.split('/').filter((part) => part !== '' && part !== '.');
const MAX_LINKS = 40;

export class Vfs {
  private readonly entries = new Map<string, Entry>([['/', { kind: 'dir' }]]);

  /** Make a folder (the folders above it must exist). */
  dir(path: string): this {
    this.entries.set(path, { kind: 'dir' });
    return this;
  }

  /** Make a file. */
  file(path: string): this {
    this.entries.set(path, { kind: 'file' });
    return this;
  }

  /** Make a link at `path` holding the text `target`, which may be relative, hold `..`, or point at nothing. */
  link(path: string, target: string): this {
    this.entries.set(path, { kind: 'link', target });
    return this;
  }

  /** Walk `path` from the top, part by part. The last part is followed too when it is a link and `followLast` says so. */
  private walk(path: string, followLast: boolean): string {
    let done: string[] = [];
    const todo = names(path);
    let links = 0;
    while (todo.length > 0) {
      const name = todo.shift() as string;
      if (name === '..') {
        done.pop();
        continue;
      }
      const at = `/${[...done, name].join('/')}`;
      const entry = this.entries.get(at);
      if (entry === undefined) throw failure('ENOENT', at);
      if (entry.kind === 'link' && (todo.length > 0 || followLast)) {
        links += 1;
        if (links > MAX_LINKS) throw failure('ELOOP', at);
        if (entry.target.startsWith('/')) done = [];
        todo.unshift(...names(entry.target));
        continue;
      }
      if (todo.length > 0 && entry.kind !== 'dir') throw failure('ENOTDIR', at);
      done.push(name);
    }
    return `/${done.join('/')}`;
  }

  /** realpath(3): where `path` really is. Throws ENOENT, ENOTDIR or ELOOP like the real thing. */
  realpath(path: string): string {
    return this.walk(path, true);
  }

  /** lstat(2), reduced to what the path code asks: is the last part a link? */
  lstat(path: string): { isSymbolicLink: () => boolean } {
    const entry = this.entries.get(this.walk(path, false));
    return { isSymbolicLink: () => entry?.kind === 'link' };
  }

  /** readlink(2): the text of the link at `path`. */
  readlink(path: string): string {
    const at = this.walk(path, false);
    const entry = this.entries.get(at);
    if (entry?.kind !== 'link') throw failure('EINVAL', at);
    return entry.target;
  }
}
