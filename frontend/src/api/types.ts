// Shapes mirror backend/app/services/presenter.py and backend/app/api/*.py.
export type Tristate = 'required' | 'not_required' | 'unknown';
export type YesNoUnknown = 'yes' | 'no' | 'unknown';

export interface Address {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface Window {
  date: string;
  opens: string | null;
  closes: string | null;
  kind: string;
  appointment_only: boolean;
  title?: string | null;
  event_id?: number | null;
}

export type MatchReason =
  | { code: 'distance'; km: number }
  | { code: 'food_group'; value: string }
  | { code: 'service_group'; value: string }
  | { code: 'distributes_on'; date: string }
  | { code: 'upcoming'; date: string }
  | { code: 'eligibility_confirmed'; value: string }
  | { code: 'on_shelf_today'; value: string }
  | { code: 'open_today_by_pantry' };

// ---------- Live updates from providers (pantry posts) ----------
export type LiveStatus = 'open' | 'limited' | 'out' | 'closed';
export type ShelfLevel = 'plenty' | 'some' | 'low';
export interface ShelfItem {
  food_type: string;
  level: ShelfLevel;
  group?: string | null;
}
export interface LiveShelf {
  status: LiveStatus;
  message: string | null;
  items: ShelfItem[];
  posted_at: string;
  expires_at: string;
  source: 'pantry';
  ai_assisted: boolean;
}

export interface ResourceSummary {
  id: number;
  name: string;
  organization_name: string;
  address: Address;
  lat: number | null;
  lon: number | null;
  distance_km: number | null;
  jurisdiction_id: string | null;
  phone: string | null;
  website: string | null;
  verification_label: string; // 'verified' | 'stale' publicly
  last_verified_at: string | null;
  operating_status: string;
  food_types: string[];
  food_groups: string[];
  service_types: string[];
  has_distribution_schedule: boolean;
  next_distribution: Window | null;
  distributing_on_date: boolean | null;
  eligibility: Record<string, Tristate>;
  wheelchair_accessible: string;
  languages: string[];
  warnings: string[];
  is_synthetic: boolean;
  match_reasons: MatchReason[];
  unconfirmed?: string[] | null;
  live?: LiveShelf | null;
  open_reports?: number;
}

export interface SearchResponse {
  items: ResourceSummary[];
  total: number;
  page: number;
  page_size: number;
  uncertain: ResourceSummary[];
  uncertain_total: number;
  truncated: boolean;
  coverage: { covered_jurisdictions: string[]; complete: boolean | null };
}

export interface Schedule {
  weekday: number;
  opens: string;
  closes: string;
  week_of_month: number | null;
  valid_from: string | null;
  valid_to: string | null;
  appointment_only: boolean;
  notes: string | null;
  service_id: number | null;
}

export interface Service {
  id: number;
  service_type: string;
  description: string | null;
  description_lang: string | null;
  offering_status: string;
  frequency: string | null;
  appointment_required: Tristate;
  registration_required: Tristate;
  household_limit: string | null;
  visit_limit: string | null;
  notes: string | null;
  food_types: string[];
  last_verified_at: string | null;
}

export interface EligibilityDetail {
  requirement_type: string;
  status: Tristate;
  details: string | null;
  values: Record<string, unknown>;
  scope: 'service' | 'location';
  service_id: number | null;
  verified_at: string | null;
}

export interface EventItem {
  id: number;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  registration_deadline: string | null;
  appointment_required: Tristate | string;
  status: string;
  notes: string | null;
  offerings: string[];
}

export interface Translation {
  text: string;
  is_machine: boolean;
  reviewed: boolean;
}

export interface SourceRef {
  source_id: string;
  name: string;
  url: string | null;
  last_seen_at: string;
  is_synthetic: boolean;
}

export interface ResourceDetail extends ResourceSummary {
  organization: {
    name: string;
    public_name: string | null;
    website: string | null;
    phone: string | null;
    description: string | null;
    description_lang: string | null;
  };
  location_website: string | null;
  email: string | null;
  registration_url: string | null;
  accessibility: {
    wheelchair_accessible: string;
    notes: string | null;
    parking: string | null;
    transit: string | null;
    entrance: string | null;
  };
  notes: string | null;
  notes_lang: string | null;
  services: Service[];
  eligibility_details: EligibilityDetail[];
  schedules: { distribution: Schedule[]; operating_hours: Schedule[] };
  upcoming_windows: Window[];
  exceptions: { date: string; kind: string; reason: string | null; opens: string | null; closes: string | null }[];
  events: EventItem[];
  current_inventory: ShelfItem[] | null;
  sources: SourceRef[];
  translations: Record<string, Translation>;
  directions: { osm: string; apple: string; google: string; geo: string } | null;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
  source: string;
  precision: 'zip' | 'address' | 'area' | string;
}

export interface Jurisdiction {
  id: string;
  name: string;
  kind: string;
  status: string;
  has_boundary: boolean;
  published_resources: number;
  center: [number, number] | null; // [lat, lon]
}

export interface VerificationMeta {
  fresh_days: number;
  published_by_status: Record<string, number>;
  sources: { id: string; name: string; url: string | null; owner: string | null; last_success_at: string | null }[];
  demo_mode: boolean;
}

export interface Categories {
  food_types: { code: string; group: string }[];
  service_types: { code: string; group: string }[];
  food_groups: string[];
  service_groups: string[];
  eligibility_filters: string[];
}

export interface SavedPreferences {
  radius_km?: number;
  food_groups?: string[];
  service_groups?: string[];
  eligibility?: string[];
  sort?: string;
  wheelchair?: boolean;
  language_filter?: string;
}

export interface User {
  id: number;
  email: string;
  role: string;
  preferred_language: string;
  preferences: SavedPreferences;
  /** False for accounts created through an OAuth provider. */
  has_password: boolean;
  oauth_linked: boolean;
}

export interface FavoriteItem {
  id: number;
  available: boolean;
  resource: ResourceSummary | null;
}

// ---------- admin ----------
export interface QueueItem {
  id: number;
  name: string;
  organization_name: string;
  address1: string | null;
  city: string | null;
  zip: string | null;
  jurisdiction_id: string | null;
  review_status: string;
  verification_label: string;
  published: boolean;
  operating_status: string;
  has_coordinates: boolean;
  last_seen_at: string | null;
  last_verified_at: string | null;
  sources: string[];
  pending_changes: number;
  pending_duplicates: number;
  open_reports?: number;
  is_synthetic: boolean;
}

export interface QueueResponse {
  items: QueueItem[];
  total: number;
  page: number;
  page_size: number;
  counts_by_status: Record<string, number>;
}

export interface ChangeProposal {
  id: number;
  location_id: number;
  field: string;
  current_value: unknown;
  proposed_value: unknown;
  source_record_id: number | null;
  status: string;
  created_at: string | null;
  decided_at: string | null;
  origin?: 'import' | 'provider' | 'ai' | string;
  submitted_by_id?: number | null;
}

export interface DuplicateCandidate {
  id: number;
  location_id: number;
  location_name: string;
  location_address: string | null;
  other_location_id: number | null;
  source_record_id: number | null;
  incoming: Record<string, unknown> | null;
  incoming_source: string | null;
  score: number;
  reasons: unknown;
  status: string;
  created_at: string | null;
}

export interface SourceRecord {
  id: number;
  source_id: string;
  source_name: string;
  source_url: string | null;
  external_id: string | null;
  status: string;
  raw: unknown;
  normalized: unknown;
  validation: unknown;
  first_seen_at: string | null;
  last_seen_at: string | null;
  is_synthetic: boolean;
}

export interface ReviewDetail extends ResourceDetail {
  review_status: string;
  published: boolean;
  merged_into_id: number | null;
  source_records: SourceRecord[];
  change_proposals: ChangeProposal[];
  duplicates: DuplicateCandidate[];
  verification_history: { id: number; action: string; method: string | null; notes: string | null; created_at: string | null; reviewer: string }[];
  audit: { action: string; actor: string | null; at: string | null; before: unknown; after: unknown }[];
  field_provenance: { field: string; value: unknown; source_record_id: number | null; observed_at: string | null }[];
}

export interface IngestionRun {
  id: number;
  source_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  counts: Record<string, unknown> | null;
  errors: unknown[];
}

export interface AdminSource {
  id: string;
  name: string;
  url: string | null;
  owner: string | null;
  adapter: string;
  jurisdictions: string[] | null;
  enabled: boolean;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  known_limitations: string[];
  is_synthetic: boolean;
}

export interface QualityReport {
  jurisdiction: string | null;
  generated_at: string;
  includes_synthetic: boolean;
  metrics: Record<string, number | Record<string, number> | null>;
}

// ---------- Lantern: AI settings ----------
export type AIKeySource = 'none' | 'environment' | 'admin';
export interface AISettings {
  enabled: boolean;
  active: boolean;
  model: string;
  fast_model?: string;
  monthly_budget_usd?: number | null;
  month_spend_usd?: number;
  allowed_models: string[];
  key_source: AIKeySource | string;
  key_hint: string | null;
}
export interface AITestResult {
  ok: boolean;
  error?: string | null;
  model?: string | null;
  display_name?: string | null;
}

// ---------- features, visit plan, reports, pantry portal, AI ----------
export interface Features {
  app_name: string;
  demo_mode: boolean;
  /** Optional sign-in with an OpenID Connect provider; `provider` is its display name (may be empty). */
  oauth?: { enabled: boolean; provider: string };
  ai: { search: boolean; announcement_drafts: boolean; structure_suggestions: boolean; translation: boolean; model: string | null };
}

export type ChecklistKey =
  | 'photo_id'
  | 'proof_of_address'
  | 'income_documentation'
  | 'benefit_documentation'
  | 'referral'
  | 'appointment'
  | 'registration';
export type ChecklistAction = 'bring' | 'not_needed' | 'ask';
export interface VisitPlan {
  checklist: { key: ChecklistKey | string; action: ChecklistAction }[];
  suggestions: string[];
  next_windows: Window[];
}

export type ReportKind = 'was_closed' | 'wrong_info' | 'out_of_food' | 'other';

export interface ProviderPantry {
  membership_id: number;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | string;
  role_title: string;
  location_id: number;
  name: string;
  address1: string | null;
  city: string | null;
  /** False for listings with no food service: the portal then hides the food-only controls. */
  offers_food?: boolean;
  live?: LiveShelf | null;
  open_reports?: number;
  pending_changes?: number;
}
export interface ProviderMe {
  items: ProviderPantry[];
  food_types: string[];
}
export interface ShelfHistoryItem extends LiveShelf {
  id: number;
  retracted: boolean;
}
export interface PantryReport {
  id: number;
  kind: ReportKind | string;
  note: string | null;
  status: string;
  created_at: string | null;
  provider_response: string | null;
}
export interface SurplusPost {
  id: number;
  location_id: number;
  pantry: string;
  city: string | null;
  title: string;
  food_types: string[];
  quantity: string | null;
  pickup_notes: string | null;
  available_until: string | null;
  status: 'open' | 'claimed' | 'closed' | string;
  claimed_by_location_id: number | null;
  created_at: string | null;
}
export interface AnnouncementDraft {
  kind: 'shelf_update' | 'event' | 'closure' | 'unclear';
  status: LiveStatus | null;
  message: string | null;
  items: ShelfItem[];
  event: { title: string; date: string; start: string; end: string | null; appointment_required: Tristate } | null;
  closure: { date: string; reason: string | null } | null;
  things_to_check: string[];
}
export interface AISearchResult {
  filters: { food_group: string[]; service_group: string[]; eligibility: string[]; date: string | null; wheelchair: boolean };
  place: GeocodeResult | null;
  place_text?: string | null;
  explanation: string;
  notice: string;
}

export interface AdminClaim {
  id: number;
  status: string;
  role_title: string;
  note: string | null;
  user_email: string;
  location_id: number;
  location_name: string;
  location_phone: string | null;
  created_at: string | null;
}
export interface AdminReport {
  id: number;
  location_id: number;
  location_name: string;
  kind: ReportKind | string;
  note: string | null;
  status: string;
  created_at: string | null;
  provider_response: string | null;
}

export interface DuplicateAIOpinion {
  verdict: 'same_place' | 'different_places' | 'unsure';
  reasons: string[];
  advisory: boolean;
}
