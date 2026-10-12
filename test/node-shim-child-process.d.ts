// The tests run on Node but the project carries no @types/node. These are the
// Node APIs the time-zone child-process test uses (see node-shim.d.ts for vm
// and process).
declare module 'node:child_process' {
  export function execFileSync(
    file: string,
    args: string[],
    options: { env: Record<string, string | undefined>; encoding: 'utf8'; input?: string },
  ): string
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function mkdirSync(path: string, options: { recursive: boolean }): void
  export function writeFileSync(path: string, data: string): void
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function rmSync(path: string, options: { recursive: boolean; force: boolean }): void
  export function readdirSync(path: string): string[]
}
declare module 'node:os' {
  export function tmpdir(): string
}
// Vitest provides import.meta.dirname on Node 20.11+.
interface ImportMeta {
  readonly dirname: string
}
