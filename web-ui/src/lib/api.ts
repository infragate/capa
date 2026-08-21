export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

declare global {
  interface Window {
    __CAPA_AUTH_TOKEN__?: string;
  }
}

export function apiAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = typeof window !== 'undefined' ? window.__CAPA_AUTH_TOKEN__ : undefined;
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = apiAuthHeaders(options?.headers);
  const res = await fetch(url, { ...options, headers });
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
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  put: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(url: string) =>
    request<T>(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    }),
};
