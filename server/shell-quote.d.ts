declare module 'shell-quote' {
  export type ParsedEntry = string | { op: string };

  export function parse(input: string): ParsedEntry[];
  export function quote(tokens: readonly string[]): string;
}
