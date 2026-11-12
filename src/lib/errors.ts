export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}
export const badRequest = (m: string, fields?: Record<string, string>) => new ApiError(400, "invalid_request", m, fields);
export const unauthorized = (m = "Please sign in to continue") => new ApiError(401, "unauthorized", m);
export const forbidden = (m = "You do not have access to this") => new ApiError(403, "forbidden", m);
export const notFound = (m = "Not found") => new ApiError(404, "not_found", m);
export const conflict = (m: string, code = "conflict") => new ApiError(409, code, m);
export const unprocessable = (m: string, code = "unprocessable", fields?: Record<string, string>) => new ApiError(422, code, m, fields);
export const tooMany = (m = "Too many attempts. Please wait and try again.") => new ApiError(429, "rate_limited", m);
export const unavailable = (m: string) => new ApiError(503, "provider_unavailable", m);
