// New file, not yet mapped in the blueprint on purpose: AFWE should detect it as drift
// and propose Authentication › Sessions (all its siblings belong there).
import { createSession } from "./session";
import { SessionStore } from "./sessionStore";
import { exchangeCode, profileToUser } from "./oauth";

const store = new SessionStore();

export async function loginWithCode(code: string) {
  const profile = await exchangeCode(code);
  return createSession(store, profileToUser(profile));
}
