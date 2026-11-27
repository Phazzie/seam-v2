// Text as the fingerprints see it: the same whether a file was saved with Windows or Unix line
// endings, or with a byte-order mark. Every hash in the lock goes through here.
import { createHash } from 'node:crypto';

/** CRLF and lone CR become LF, and a BOM at the very start is dropped. */
export function normalize(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/** The sha256 of the normalized text, in hex. */
export function hash(text: string): string {
  return createHash('sha256').update(normalize(text)).digest('hex');
}

/** The sha256 of a whole file: normalized text if it is readable text, the raw bytes if it is not (a picture, say). */
export function hashFile(bytes: Buffer): string {
  const text = bytes.toString('utf8');
  const isText = !bytes.includes(0) && Buffer.from(text, 'utf8').equals(bytes);
  return isText ? hash(text) : createHash('sha256').update(bytes).digest('hex');
}
