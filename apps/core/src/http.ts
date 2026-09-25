import type { IncomingMessage, ServerResponse } from "node:http";

export async function body(req: IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new Error("文件或请求过大");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function jsonBody(req: IncomingMessage, limit?: number): Promise<unknown> {
  return JSON.parse((await body(req, limit)).toString());
}

export function send(res: ServerResponse, value: unknown, status = 200): void {
  res
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(value));
}
