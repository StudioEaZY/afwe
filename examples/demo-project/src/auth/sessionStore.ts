import type { Session } from "./session";
import { primaryDb } from "../data/db";

export class SessionStore {
  private byUser = new Map<string, Session>();
  put(s: Session) {
    this.byUser.set(s.user.id, s);
    primaryDb.write("sessions", s.user.id, { expiresAt: s.expiresAt });
  }
  get(userId: string): Session | undefined {
    return this.byUser.get(userId);
  }
}
