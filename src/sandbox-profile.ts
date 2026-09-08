const quote = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
/** Deny by default; read grants confer no execution or write permission. */
export function sandboxProfile(command: string, directory: string, reads: readonly { path: string; directory: boolean }[] = []): string {
  return `(version 1) (deny default)
(allow process-exec (literal "${quote(command)}"))
(allow sysctl-read) (allow file-read-metadata)
(allow mach-lookup (global-name "com.apple.cfprefsd.agent"))
(allow file-read* (literal "/") (literal "${quote(command)}") (subpath "/System") (subpath "/usr/lib") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (subpath "${quote(directory)}") ${reads.map(read => `(${read.directory ? "subpath" : "literal"} "${quote(read.path)}")`).join(" ")})
(allow file-write* (subpath "${quote(directory)}"))
(deny network*)`;
}
