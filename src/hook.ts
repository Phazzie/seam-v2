// Hook entry point (stub). Reads the hook input from stdin and exits 0, which stays silent.
// The guard itself replaces this in a later task; the stub exists so the build works.
if (process.stdin.isTTY) {
  process.exit(0);
}
process.stdin.resume();
process.stdin.on('end', () => {
  process.exit(0);
});
