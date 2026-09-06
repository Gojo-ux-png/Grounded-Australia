interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  meta: { changes?: number; last_row_id?: number | string };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

interface R2Bucket {
  put(key: string, body: ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: { DB: D1Database; MEDIA: R2Bucket };
}
