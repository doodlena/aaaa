import type {
  AdminSource,
  Categories,
  ChangeProposal,
  DuplicateCandidate,
  FavoriteItem,
  GeocodeResult,
  IngestionRun,
  Jurisdiction,
  QualityReport,
  QueueResponse,
  ResourceDetail,
  ReviewDetail,
  SavedPreferences,
  SearchResponse,
  User,
  VerificationMeta,
} from './types';

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api';

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
  /** i18n key describing the failure for the UI. */
  get i18nKey(): string {
    if (this.status === 0) return 'errors.network';
    if (this.status === 401) return 'errors.unauthorized';
    if (this.status === 403) return 'errors.forbidden';
    if (this.status === 404) return 'errors.notFound';
    if (this.status === 409) return 'errors.conflict';
    if (this.status === 422) return 'errors.invalid';
    if (this.status === 429) return 'errors.rateLimited';
    return 'errors.server';
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('nfa_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'Network error');
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string'
        ? (data as { detail: string }).detail
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined | string[]>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) u.set(k, v.join(','));
    } else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // public
  search: (query: string, signal?: AbortSignal) => request<SearchResponse>('GET', `/resources/search?${query}`, undefined, signal),
  resource: (id: number | string, lang?: string, signal?: AbortSignal) =>
    request<ResourceDetail>('GET', `/resources/${id}${qs({ lang: lang && lang !== 'en' ? lang : undefined })}`, undefined, signal),
  geocode: (q: string) => request<{ results: GeocodeResult[]; unavailable_providers: string[] }>('GET', `/geocode${qs({ q })}`),
  categories: () => request<Categories>('GET', '/meta/categories'),
  jurisdictions: () => request<Jurisdiction[]>('GET', '/jurisdictions'),
  verificationMeta: () => request<VerificationMeta>('GET', '/meta/verification'),
  // auth & account
  me: () => request<{ user: User | null }>('GET', '/auth/me'),
  login: (email: string, password: string) => request<User>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string, preferred_language: string) =>
    request<User>('POST', '/auth/register', { email, password, preferred_language }),
  logout: () => request<void>('POST', '/auth/logout'),
  favorites: () => request<{ items: FavoriteItem[] }>('GET', '/me/favorites'),
  addFavorite: (id: number) => request<{ id: number; saved: boolean }>('POST', `/me/favorites/${id}`),
  removeFavorite: (id: number) => request<void>('DELETE', `/me/favorites/${id}`),
  updatePreferences: (body: { preferred_language?: string; preferences?: SavedPreferences }) =>
    request<User>('PATCH', '/me/preferences', body),
  deleteAccount: (password: string) => request<void>('DELETE', '/me', { password }),
  // admin
  admin: {
    queue: (params: Record<string, string | number | boolean | undefined>) => request<QueueResponse>('GET', `/admin/queue${qs(params)}`),
    resource: (id: number | string) => request<ReviewDetail>('GET', `/admin/resources/${id}`),
    edit: (id: number | string, body: Record<string, unknown>) => request<ReviewDetail>('PATCH', `/admin/resources/${id}`, body),
    action: (id: number | string, action: string, method: string, notes?: string) =>
      request<{ id: number; review_status: string; published: boolean; operating_status: string }>(
        'POST',
        `/admin/resources/${id}/actions`,
        { action, method, notes: notes || null },
      ),
    changes: (status = 'pending') => request<{ items: ChangeProposal[] }>('GET', `/admin/changes${qs({ status })}`),
    decideChange: (id: number, decision: 'accept' | 'reject', notes?: string) =>
      request<ChangeProposal>('POST', `/admin/changes/${id}/decision`, { decision, notes: notes || null }),
    duplicates: (status = 'pending') => request<{ items: DuplicateCandidate[] }>('GET', `/admin/duplicates${qs({ status })}`),
    decideDuplicate: (id: number, decision: 'merge' | 'distinct', notes?: string) =>
      request<DuplicateCandidate>('POST', `/admin/duplicates/${id}/decision`, { decision, notes: notes || null }),
    runs: () => request<{ items: IngestionRun[] }>('GET', '/admin/ingestion/runs'),
    sources: () => request<{ items: AdminSource[] }>('GET', '/admin/sources'),
    quality: (jurisdiction?: string) => request<QualityReport>('GET', `/admin/quality${qs({ jurisdiction })}`),
  },
};
