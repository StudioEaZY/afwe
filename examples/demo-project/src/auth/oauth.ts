import { User } from "../identity/user";

export interface OAuthProfile { sub: string; email: string; name?: string }

export async function exchangeCode(code: string): Promise<OAuthProfile> {
  // network call omitted
  return { sub: code, email: `${code}@example.com` };
}

export function profileToUser(p: OAuthProfile): User {
  return new User(p.sub, p.email, p.name ?? p.email);
}
