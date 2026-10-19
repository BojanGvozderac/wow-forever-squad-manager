export type BlizzardCredentials = {
  BLIZZARD_API_CLIENT_ID?: string;
  BLIZZARD_API_CLIENT_SECRET?: string;
};

/** Server use only. Never return this token through an application endpoint. */
export async function requestBlizzardToken(credentials: BlizzardCredentials) {
  const id = credentials.BLIZZARD_API_CLIENT_ID;
  const secret = credentials.BLIZZARD_API_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Blizzard API credentials are missing.");

  let response: Response;
  try {
    response = await fetch("https://oauth.battle.net/token", {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Blizzard OAuth could not be reached within the request timeout.");
  }
  // Do not propagate upstream bodies: they may contain credential information.
  if (!response.ok) throw new Error(`Blizzard OAuth failed (HTTP ${response.status}).`);
  const data = await response.json().catch(() => null) as {
    access_token?: unknown;
    token_type?: unknown;
    expires_in?: unknown;
  } | null;
  if (!data || typeof data.access_token !== "string" || !data.access_token ||
      typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
      typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error("Blizzard OAuth returned an invalid token response.");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}
