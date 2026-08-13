/**
 * A failure with an HTTP meaning attached.
 *
 * Everything the API rejects is rejected through this type, so the error shape a
 * client sees is decided in one place and no handler has to remember to format
 * one. Messages are written for the caller and never carry internals.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(message: string): HttpError {
    return new HttpError(400, "bad_request", message);
  }

  static notFound(message: string): HttpError {
    return new HttpError(404, "not_found", message);
  }

  static unavailable(message: string): HttpError {
    return new HttpError(503, "unavailable", message);
  }
}
