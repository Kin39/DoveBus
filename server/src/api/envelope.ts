export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
}

export interface ErrorEnvelope {
  readonly success: false;
  readonly error: { readonly code: string; readonly message: string };
}

/** One response shape for every endpoint, so a client writes one unwrapping path. */
export function ok<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}

export function fail(code: string, message: string): ErrorEnvelope {
  return { success: false, error: { code, message } };
}
