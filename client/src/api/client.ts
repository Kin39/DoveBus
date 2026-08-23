import { t } from "../i18n/index.js";
import type {
  Comune,
  LineSearchResponse,
  OdSearchResponse,
  RouteMatch,
  TripDetail,
  VehiclesResponse,
} from "./types.js";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:3200").replace(/\/$/, "");

/** How long a request is given before it is treated as a dropped network. */
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * An API failure a rider can be told about.
 *
 * `offline` is separated from the rest because it is the one the interface must
 * handle differently: a bus rider on a moving bus loses signal constantly, and
 * "you are offline" is a state to wait out, not an error to report.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly offline: boolean;

  constructor(code: string, message: string, offline = false) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.offline = offline;
  }
}

interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

async function get<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    // A caller-driven abort is a cancelled request, not a failure to report.
    if (options.signal?.aborted) throw error;
    throw new ApiError("offline", t.errors.unreachable, true);
  }

  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError("bad_response", t.errors.badResponse);
  }

  if (!response.ok || !body.success || body.data === undefined) {
    throw new ApiError(
      body.error?.code ?? `http_${response.status}`,
      body.error?.message ?? t.errors.badService,
    );
  }
  return body.data;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

export interface BboxParam {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

/**
 * The fleet in one viewport.
 *
 * Always bbox-scoped: the whole region is ~460 KB and a city viewport ~110 KB,
 * and the difference is a rider's mobile data.
 */
export function fetchVehicles(
  bbox: BboxParam,
  options?: RequestOptions,
): Promise<VehiclesResponse> {
  const box = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat]
    .map((n) => n.toFixed(4))
    .join(",");
  return get<VehiclesResponse>(`/api/vehicles${query({ bbox: box })}`, options);
}

export function fetchComuni(q: string, options?: RequestOptions): Promise<readonly Comune[]> {
  return get<{ comuni: readonly Comune[] }>(`/api/comuni${query({ q, limit: 8 })}`, options).then(
    (data) => data.comuni,
  );
}

export function fetchRoutes(q: string, options?: RequestOptions): Promise<readonly RouteMatch[]> {
  return get<{ routes: readonly RouteMatch[] }>(
    `/api/routes${query({ q, limit: 8 })}`,
    options,
  ).then((data) => data.routes);
}

export interface SearchWindow {
  readonly date: string;
  readonly from: string;
  readonly to: string;
}

export function searchLine(
  route: string,
  window: SearchWindow,
  options?: RequestOptions,
): Promise<LineSearchResponse> {
  return get<LineSearchResponse>(`/api/search/line${query({ route, ...window })}`, options);
}

export function searchOd(
  comuneA: string,
  comuneB: string,
  window: SearchWindow,
  options?: RequestOptions,
): Promise<OdSearchResponse> {
  return get<OdSearchResponse>(`/api/search/od${query({ comuneA, comuneB, ...window })}`, options);
}

export function fetchTrip(
  tripId: string,
  date: string,
  options?: RequestOptions,
): Promise<TripDetail> {
  return get<TripDetail>(`/api/trip/${encodeURIComponent(tripId)}${query({ date })}`, options);
}

/** The SSE endpoint for one run. `EventSource` owns its own reconnection. */
export function streamUrl(tripId: string, date: string): string {
  return `${API_BASE}/api/stream/trip/${encodeURIComponent(tripId)}${query({ date })}`;
}
