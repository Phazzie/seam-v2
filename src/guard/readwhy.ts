// The plain sentences decideRead refuses with. Each says what is allowed instead, in words the AI can act on.

export const ENV_FILES = "env files hold secrets, so they aren't read into the AI's context; the owner can open them";
export const BUILDER_TESTS = "builders don't read tests; you'll be told which promise failed";
export const NO_FILE = "this read doesn't name a file the guard can read";
export const NOT_ITS_TURN = "it isn't this builder's turn, so it has nothing to read";
export const TYPES_ONLY = 'in node_modules a builder reads only the type files (.d.ts) of the planned packages, so a search there must be narrowed to *.d.ts files';
export const DESCRIBER_NEEDS_PATH = "a describer's search must give a path inside .seam/review";

/** What a builder may read, said once and used in every refusal that is about it. */
const BUILDER_MAY = "its own file, the contracts, the files its file imports, the type files (.d.ts) of the planned packages and, for a mock or an adapter, its seam's fixtures";

export const NEEDS_PATH = `a builder's search must give a path inside what it may read (${BUILDER_MAY})`;
export const notReadable = (what: string): string => `${what} isn't something a builder reads: it reads ${BUILDER_MAY}`;
export const patternEscapes = (pattern: string): string => `the pattern ${pattern} reaches outside what a builder may read (${BUILDER_MAY})`;
export const describerOnly = (what: string): string => `a describer reads only the copy under .seam/review, and ${what} isn't in it`;
