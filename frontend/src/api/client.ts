import type { DuplicateAIOpinion,
  AIInfo,
  AdminClaim,
  AdminReport,
  AISearchResult,
  AISettings,
  AITestResult,
  AnnouncementDraft,
  Features,
  PantryReport,
  ProviderMe,
  ReportKind,
  ShelfHistoryItem,
  StaffMember,
  ShelfItem,
  LiveShelf,
  LiveStatus,
  SurplusPost,
  Tristate,
  VisitPlan,
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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
  features: () => request<Features>('GET', '/meta/features'),
  aiInfo: (id: number | string, signal?: AbortSignal) => request<AIInfo>('GET', `/resources/${id}/ai-info`, undefined, signal),
  aiInfoLookup: (id: number | string) => request<AIInfo>('POST', `/resources/${id}/ai-info`),
  visitPlan: (id: number | string, signal?: AbortSignal) => request<VisitPlan>('GET', `/resources/${id}/visit-plan`, undefined, signal),
  report: (id: number | string, kind: ReportKind, note?: string) =>
    request<{ id: number; status: string }>('POST', `/resources/${id}/reports`, { kind, note: note?.trim() || null }),
  aiSearch: (q: string, lang: string) => request<AISearchResult>('POST', '/ai/search', { q, lang }),
  // auth & account
  me: () => request<{ user: User | null }>('GET', '/auth/me'),
  login: (email: string, password: string) => request<User>('POST', '/auth/login', { email, password }),
  register: (email: string, password: string, preferred_language: string) =>
    request<User>('POST', '/auth/register', { email, password, preferred_language }),
  logout: () => request<void>('POST', '/auth/logout'),
  oauthStart: (link: boolean) => request<{ url: string }>('POST', '/auth/oauth/start', { link }),
  oauthCallback: (code: string, state: string, preferred_language: string) =>
    request<User>('POST', '/auth/oauth/callback', { code, state, preferred_language }),
  favorites: () => request<{ items: FavoriteItem[] }>('GET', '/me/favorites'),
  addFavorite: (id: number) => request<{ id: number; saved: boolean }>('POST', `/me/favorites/${id}`),
  removeFavorite: (id: number) => request<void>('DELETE', `/me/favorites/${id}`),
  updatePreferences: (body: { preferred_language?: string; preferences?: SavedPreferences }) =>
    request<User>('PATCH', '/me/preferences', body),
  deleteAccount: (password: string) => request<void>('DELETE', '/me', { password }),
  // pantry portal (approved staff; the server enforces membership on every call)
  provider: {
    me: () => request<ProviderMe>('GET', '/provider/me'),
    claim: (location_id: number, role_title: string, note?: string) =>
      request<{ id: number; status: string }>('POST', '/provider/claims', { location_id, role_title, note: note?.trim() || null }),
    postShelf: (id: number, body: { status: LiveStatus; message: string | null; items: ShelfItem[]; expires_at: string | null; ai_assisted: boolean }) =>
      request<LiveShelf>('POST', `/provider/locations/${id}/shelf`, body),
    clearShelf: (id: number) => request<void>('DELETE', `/provider/locations/${id}/shelf`),
    shelfHistory: (id: number) => request<{ items: ShelfHistoryItem[] }>('GET', `/provider/locations/${id}/shelf/history`),
    postEvent: (
      id: number,
      body: { title: string; starts_at: string; ends_at: string | null; appointment_required: Tristate; notes: string | null; offerings: string[]; ai_assisted: boolean },
    ) => request<{ id: number }>('POST', `/provider/locations/${id}/events`, body),
    postClosure: (id: number, body: { date: string; reason: string | null }) => request<{ id: number }>('POST', `/provider/locations/${id}/closures`, body),
    changeRequest: (id: number, body: Record<string, unknown>) =>
      request<{ change_proposal_ids: number[]; status: string }>('POST', `/provider/locations/${id}/change-requests`, body),
    reports: (id: number) => request<{ items: PantryReport[] }>('GET', `/provider/locations/${id}/reports`),
    respondReport: (id: number, rid: number, response: string | null, resolve: boolean) =>
      request<{ id: number; status: string }>('POST', `/provider/locations/${id}/reports/${rid}/response`, { response, resolve }),
    surplus: () => request<{ items: SurplusPost[] }>('GET', '/provider/surplus'),
    postSurplus: (body: { location_id: number; title: string; food_types: string[]; quantity: string | null; pickup_notes: string | null; available_until: string }) =>
      request<SurplusPost>('POST', '/provider/surplus', body),
    claimSurplus: (postId: number, location_id: number) => request<SurplusPost>('POST', `/provider/surplus/${postId}/claim`, { location_id }),
    closeSurplus: (postId: number) => request<SurplusPost>('POST', `/provider/surplus/${postId}/close`),
    announcementDraft: (id: number, text: string) =>
      request<{ draft: AnnouncementDraft; notice: string }>('POST', `/provider/locations/${id}/ai/announcement-draft`, { text }),
    withdrawClaim: (membershipId: number) => request<void>('DELETE', `/provider/claims/${membershipId}`),
    staff: (id: number) => request<{ items: StaffMember[] }>('GET', `/provider/locations/${id}/staff`),
    addStaff: (id: number, email: string, role_title: string) =>
      request<{ membership_id: number; email: string; status: string }>('POST', `/provider/locations/${id}/staff`, { email, role_title }),
    removeStaff: (id: number, membershipId: number) => request<void>('DELETE', `/provider/locations/${id}/staff/${membershipId}`),
    confirm: (id: number, notes?: string) =>
      request<{ verification_label: string; last_verified_at: string | null }>('POST', `/provider/locations/${id}/confirm`, {
        notes: notes?.trim() || null,
      }),
  },
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
    claims: (status = 'pending') => request<{ items: AdminClaim[] }>('GET', `/admin/claims${qs({ status })}`),
    pendingClaims: () => request<{ pending: number }>('GET', '/admin/claims/pending-count'),
    decideClaim: (id: number, decision: 'approve' | 'reject' | 'revoke', notes?: string) =>
      request<{ id: number; status: string }>('POST', `/admin/claims/${id}/decision`, { decision, notes: notes || null }),
    reports: (status = 'open') => request<{ items: AdminReport[] }>('GET', `/admin/reports${qs({ status })}`),
    decideReport: (id: number, decision: 'resolve' | 'dismiss', notes?: string) =>
      request<{ id: number; status: string }>('POST', `/admin/reports/${id}/decision`, { decision, notes: notes || null }),
    aiSettings: () => request<AISettings>('GET', '/admin/ai-settings'),
    /** The key is sent once and never returned; the response only carries a hint like "…WXYZ" and a live test. */
    saveAIKey: (api_key: string) => request<AISettings & { test: AITestResult }>('PUT', '/admin/ai-settings/key', { api_key }),
    deleteAIKey: () => request<AISettings>('DELETE', '/admin/ai-settings/key'),
    patchAISettings: (body: { enabled?: boolean; model?: string; fast_model?: string; monthly_budget_usd?: number }) =>
      request<AISettings>('PATCH', '/admin/ai-settings', body),
    duplicateAIOpinion: (id: number) => request<DuplicateAIOpinion>('POST', `/admin/duplicates/${id}/ai-opinion`),
    testAI: () => request<AITestResult>('POST', '/admin/ai-settings/test'),
    aiSuggestions: (id: number | string) =>
      request<{ created_proposals: string[]; suggestions: unknown }>('POST', `/admin/resources/${id}/ai-suggestions`),
  },
};
