/** Typed client for the Mutual HTTP API (see /SPEC.md section 3). */

export type EventMode = 'dates' | 'weekdays';
export type SlotMinutes = 15 | 30 | 60;

export interface EventDTO {
  id: string;
  title: string;
  description: string;
  mode: EventMode;
  dates: string[];
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  slotMinutes: SlotMinutes;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  /** Months kept after the last date (1 to 6), chosen at creation. */
  keepMonths: number;
  /** When the server deletes the event and its responses (ISO 8601). */
  expiresAt: string;
}

export interface ParticipantDTO {
  id: string;
  name: string;
  hasPassword: boolean;
  availability: string;
  updatedAt: string;
}

export interface ViewerDTO {
  isAdmin: boolean;
  participantId: string | null;
}

export type ApiErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'slug_taken'
  | 'wrong_password'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'too_many_participants'
  | 'too_early'
  | 'network'
  | 'unknown';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  constructor(code: ApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface CreateEventInput {
  title: string;
  description?: string;
  mode: EventMode;
  dates?: string[];
  weekdays?: number[];
  startMinute: number;
  endMinute: number;
  slotMinutes: SlotMinutes;
  timezone: string;
  slug?: string;
  keepMonths?: number;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  dates?: string[];
  weekdays?: number[];
  startMinute?: number;
  endMinute?: number;
  slotMinutes?: SlotMinutes;
}

export interface EventSnapshot {
  event: EventDTO;
  participants: ParticipantDTO[];
  viewer: ViewerDTO;
}

export type StreamMessage =
  | { type: 'participant'; participant: ParticipantDTO }
  | { type: 'event'; event: EventDTO; participants: ParticipantDTO[] }
  | { type: 'deleted' };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError('network', 'Could not reach the server. Check your connection and try again.', 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON error page */
    }
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(
      (e?.code as ApiErrorCode) ?? (res.status === 404 ? 'not_found' : 'unknown'),
      e?.message ?? `Request failed (${res.status})`,
      res.status,
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request<{ ok: true }>('GET', '/health'),

  checkSlug: (slug: string, signal?: AbortSignal) =>
    request<{ available: boolean; valid: boolean }>('GET', `/slugs/${enc(slug)}`, undefined, signal),

  createEvent: (input: CreateEventInput) =>
    request<{ event: EventDTO; adminToken: string }>('POST', '/events', input),

  getEvent: (id: string, signal?: AbortSignal) =>
    request<EventSnapshot>('GET', `/events/${enc(id)}`, undefined, signal),

  updateEvent: (id: string, patch: UpdateEventInput) =>
    request<{ event: EventDTO; participants: ParticipantDTO[] }>('PATCH', `/events/${enc(id)}`, patch),

  extendEvent: (id: string) => request<{ event: EventDTO }>('POST', `/events/${enc(id)}/extend`),

  deleteEvent: (id: string) => request<void>('DELETE', `/events/${enc(id)}`),

  claimAdmin: (id: string, token: string) =>
    request<{ viewer: ViewerDTO }>('POST', `/events/${enc(id)}/admin`, { token }),

  signIn: (id: string, name: string, password?: string) =>
    request<{ participant: ParticipantDTO; viewer: ViewerDTO }>('POST', `/events/${enc(id)}/session`, {
      name,
      ...(password ? { password } : {}),
    }),

  signOut: (id: string) => request<void>('DELETE', `/events/${enc(id)}/session`),

  saveAvailability: (id: string, availability: string) =>
    request<{ participant: ParticipantDTO }>('PUT', `/events/${enc(id)}/availability`, { availability }),
};

export function streamUrl(id: string): string {
  return `/api/events/${enc(id)}/stream`;
}

/** Subscribe to SSE updates. Returns a cleanup function. */
export function openEventStream(
  id: string,
  handlers: { onMessage: (m: StreamMessage) => void; onOpen?: () => void; onError?: () => void },
): () => void {
  const es = new EventSource(streamUrl(id));
  const parse = (e: MessageEvent): unknown => {
    try {
      return JSON.parse(e.data);
    } catch {
      return null;
    }
  };
  es.addEventListener('open', () => handlers.onOpen?.());
  es.addEventListener('error', () => handlers.onError?.());
  es.addEventListener('participant', (e) => {
    const participant = parse(e as MessageEvent) as ParticipantDTO | null;
    if (participant) handlers.onMessage({ type: 'participant', participant });
  });
  es.addEventListener('event', (e) => {
    const d = parse(e as MessageEvent) as { event: EventDTO; participants: ParticipantDTO[] } | null;
    if (d) handlers.onMessage({ type: 'event', event: d.event, participants: d.participants });
  });
  es.addEventListener('deleted', () => handlers.onMessage({ type: 'deleted' }));
  return () => es.close();
}
