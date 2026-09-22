import { SessionStore } from "./sessionStore";
import { User } from "../identity/user";

export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes, see decision auth-session-expiry

export class Session {
  constructor(public readonly user: User, public readonly expiresAt: number) {}
  isExpired(now = Date.now()): boolean {
    return now > this.expiresAt;
  }
}

export function createSession(store: SessionStore, user: User): Session {
  const s = new Session(user, Date.now() + SESSION_TTL_MS);
  store.put(s);
  return s;
}
