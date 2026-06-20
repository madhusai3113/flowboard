export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: () => new HttpError(401, "UNAUTHORIZED", "Missing or unknown X-User-Id."),
  forbidden: () => new HttpError(403, "FORBIDDEN", "You do not have access to this resource."),
  notFound: (name = "Resource") => new HttpError(404, "NOT_FOUND", `${name} not found.`),
  conflict: (message: string) => new HttpError(409, "CONFLICT", message),
  validation: (message: string) => new HttpError(422, "VALIDATION_ERROR", message)
};
