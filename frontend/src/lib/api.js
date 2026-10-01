/**
 * Thin API client for the BFF. Adds the JWT bearer token to every request and
 * normalises error bodies into a consistent shape for the UI.
 */

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const TOKEN_KEY = 'novr.token';

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * @param {string} path  path relative to BASE_URL, e.g. "/campaigns"
 * @param {{ method?: string, body?: any, query?: Record<string,string|number>, formData?: FormData, signal?: AbortSignal }} [opts]
 * @returns {Promise<any>}
 */
export async function api(path, { method = 'GET', body, query, formData, signal } = {}) {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);

  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }

  const headers = { Accept: 'application/json' };
  const token = auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !formData) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: formData ?? (body ? JSON.stringify(body) : undefined),
    signal,
  });

  const text = await res.text();

  // 204 No Content
  if (res.status === 204) return null;

  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error?.message || data?.message || `Request failed (${res.status})`;

    const error = new Error(message);
    error.status = res.status;
    error.details = data?.error?.details;
    error.isOperational = Boolean(data?.error);

    // Expired or missing token — let the auth layer redirect to /login
    if (res.status === 401 && !path.startsWith('/auth/')) {
      auth.clearToken();
    }

    throw error;
  }

  return data;
}

export default api;
