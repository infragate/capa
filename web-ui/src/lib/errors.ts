import { ApiError } from './api';

export function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}
