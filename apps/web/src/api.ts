export const base = import.meta.env.DEV ? "http://127.0.0.1:43120" : "";
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(base + "/api/" + path, {
    ...options,
    credentials: "include",
  });
  const value = await res.json();
  if (!res.ok) throw new ApiRequestError(value.error ?? "请求失败", res.status, value.code);
  return value;
}
export function post<T>(path: string, value: unknown) {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}
export const fileUrl = (id: string) => base + "/api/books/" + id + "/file";
