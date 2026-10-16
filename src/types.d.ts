declare module "m3u8-parser" {
  export class Parser {
    manifest: any;
    push(input: string): void;
    end(): void;
  }
}
