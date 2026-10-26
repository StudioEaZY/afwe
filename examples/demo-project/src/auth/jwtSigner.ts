// jwt-signer component & token-entropy-guard widget
export interface TokenPayload {
  userId: string;
  orgId: string;
  scope: string[];
}

export function signJwtToken(payload: TokenPayload, secretKey: string): string {
  if (secretKey.length < 32) {
    throw new Error("token-entropy-guard: secret key entropy insufficient (< 32 bytes)");
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.mock_signature`;
}
