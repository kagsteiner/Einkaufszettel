import { AppError } from "./errors.ts";

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  consume(key: string, limit: number, windowMilliseconds: number): void {
    const now = Date.now();
    const existing = this.buckets.get(key);
    const bucket =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMilliseconds }
        : existing;
    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (bucket.count > limit) {
      throw new AppError(
        429,
        "rate_limit_exceeded",
        "Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.",
      );
    }
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, candidate] of this.buckets) {
        if (candidate.resetAt <= now) {
          this.buckets.delete(bucketKey);
        }
      }
    }
  }
}
