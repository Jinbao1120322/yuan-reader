// 为未自带类型声明的库提供最小声明，避免 tsc 报错
declare module 'iconv-lite' {
  export function decode(buffer: Buffer | Uint8Array, encoding: string): string;
  export function encode(
    text: string,
    encoding: string
  ): Buffer;
  export function encodingExists(encoding: string): boolean;
}

declare module 'xpath' {
  export function select(
    expression: string,
    node: any
  ): any[];
  export function useNamespaces(ns: Record<string, string>): any;
}
