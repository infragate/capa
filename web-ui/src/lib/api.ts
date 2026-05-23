export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // Surface server-supplied { error: "..." } messages when present.
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === 'string') {
        throw new ApiError(res.status, parsed.error);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
    }
    throw new ApiError(res.status, text);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export const api = {
  get: <T>(url: string) => request<T>(url),

  post: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: 'PATCH',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};
