import { requestBlizzardToken } from "../src/server/game/blizzard-oauth.ts";

try {
  const token = await requestBlizzardToken(process.env);
  console.log(`Blizzard OAuth credentials verified. Token lifetime: ${token.expiresIn} seconds.`);
  console.log("Forever fetching remains disabled. No token has been printed or saved.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Blizzard OAuth check failed.");
  process.exitCode = 1;
}
