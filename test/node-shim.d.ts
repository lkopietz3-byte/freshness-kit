// The tests run on Node but the project carries no @types/node. These are the
// only two Node APIs the verdict table uses.
declare module 'node:vm' {
  const vm: { runInNewContext(code: string): unknown }
  export default vm
}
declare const process: { env: Record<string, string | undefined> }
