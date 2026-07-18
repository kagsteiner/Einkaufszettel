export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function invalidInput(message: string): AppError {
  return new AppError(400, "invalid_input", message);
}

export function unauthorized(message = "Bitte melde dich an."): AppError {
  return new AppError(401, "unauthorized", message);
}

export function forbidden(message = "Dafür fehlt die Berechtigung."): AppError {
  return new AppError(403, "forbidden", message);
}
