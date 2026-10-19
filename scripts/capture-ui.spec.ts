import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mondayOf, localDateTime, localTimeCandidates, addDays } from "../src/lib/calendar";

// Fictional demo content, written only to the disposable E2E database.
function seedDemo() {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const sql: string[] = [];
  const squads = [
    ["night-watch", "The Night Watch", "eu", "normal"],
    ["stormguard", "Stormguard", "us", "pvp"],
    ["moonlit", "The Moonlit Pact", "kr", "roleplay"],
    ["jade", "Jade Sentinels", "tw", "normal"],
    ["dawn", "Dawnbringers", "cn", "pvp"],
  ];
  const names = ["Aldric Dawnkeeper", "Lyra Moonwhisper", "Thorne Ironbark", "Kael Emberforge", "Mira Starfall"];
  for (const [squad, name, region, ruleset] of squads) {
    sql.push(`INSERT INTO squads(id,name,region,ruleset) VALUES (${[squad,name,region,ruleset].map(quote).join(",")});`);
    for (let index = 0; index < (squad === "night-watch" ? 5 : 3); index++) {
      const id = `${squad}-${index}`;
      sql.push(`INSERT INTO characters(id,name,normalized_name,region,ruleset,owner_id) VALUES (${[id,names[index],names[index].toLowerCase(),region,ruleset,index % 2 ? "player2" : "player1"].map(quote).join(",")});`);
      sql.push(`INSERT INTO squad_characters VALUES (${quote(squad)},${quote(id)});`);
    }
  }
  for (const [index, title, category, priority, status, notes] of [
    ["1", "A blade for the next adventure", "item", "high", "wanted", "Run dungeons with the squad and compare upgrades."],
    ["2", "Finish my enchanting checklist", "enchant", "normal", "wanted", "Gather materials together before raid night."],
    ["3", "Prepare the squad feast", "recipe", "normal", "acquired", "Ingredients collected. Ready for the weekend!"],
  ]) {
    sql.push(`INSERT INTO wishlist_entries(id,character_id,title,category,priority,status,notes) VALUES (${[index,"night-watch-0",title,category,priority,status,notes].map(quote).join(",")});`);
  }
  const monday = mondayOf(localDateTime(Date.now(), "Europe/Sarajevo").slice(0,10));
  for (let index = 0; index < 3; index++) {
    const start = localTimeCandidates(`${addDays(monday, index)}T19:00`, "Europe/Sarajevo")[0];
    const activities = JSON.stringify([{ category: "dungeon", name: ["Stratholme", "Scholomance", "Blackrock Depths"][index] }]);
    sql.push(`INSERT INTO availability_entries(id,squad_id,user_id,character_id,starts_at,ends_at,activities_json,note) VALUES ('demo-${index}','night-watch','player1','night-watch-0',${start},${start + 7200000},${quote(activities)},'Looking for a relaxed evening run. All squad members welcome!');`);
  }
  const directory = mkdtempSync(join(tmpdir(), "war-room-media-"));
  try {
    const file = join(directory, "demo.sql");
    writeFileSync(file, sql.join("\n"));
    execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/e2e", "--file", file], { stdio: "pipe" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Login key", { exact: true }).fill(process.env[`E2E_KEY_${username}`]!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The war room", exact: true })).toBeVisible();
}
async function capture(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `docs/media/${name}.png`, fullPage, animations: "disabled" });
}

test("capture README and social screenshots", async ({ browser }) => {
  seedDemo();
  const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Sarajevo" });
  await login(admin, "admin");
  await expect(admin.getByRole("heading", { name: "Dawnbringers", exact: true })).toBeVisible();
  await capture(admin, "squads-desktop", true);
  await admin.getByRole("button", { name: "Create squad", exact: true }).click();
  await admin.getByLabel("Squad name").fill("Your next adventure");
  await admin.getByRole("combobox", { name: "Region", exact: true }).selectOption("us");
  await capture(admin, "create-squad");
  await admin.getByRole("button", { name: "Close dialog" }).click();
  await admin.goto("/squads/night-watch");
  await expect(admin.getByRole("link", { name: "View Aldric Dawnkeeper" })).toBeVisible();
  await capture(admin, "roster-desktop", true);
  await admin.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(admin.getByText("Stratholme", { exact: false })).toBeVisible();
  await capture(admin, "calendar-desktop", true);

  const player = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Europe/Sarajevo" });
  await login(player, "player1");
  await player.goto("/characters/night-watch-0");
  await expect(player.getByRole("heading", { name: "A blade for the next adventure" })).toBeVisible();
  await capture(player, "wishlist-desktop", true);
  await player.setViewportSize({ width: 390, height: 844 });
  await expect(player.getByRole("heading", { name: "A blade for the next adventure" })).toBeVisible();
  expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture(player, "wishlist-mobile", true);
  await admin.close();
  await player.close();
});
