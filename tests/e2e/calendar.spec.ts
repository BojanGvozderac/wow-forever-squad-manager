import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Login key", { exact: true }).fill(process.env[`E2E_KEY_${username}`]!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The war room", exact: true })).toBeVisible();
}

test("squad availability is shared, author editable, persistent, and mobile friendly", async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, "admin");
  await admin.getByRole("button", { name: "Create squad", exact: true }).click();
  await admin.getByLabel("Squad name").fill("Calendar squad");
  await admin.getByRole("dialog").getByRole("button", { name: "Create squad", exact: true }).click();
  await admin.getByRole("link").filter({ has: admin.getByRole("heading", { name: "Calendar squad", exact: true }) }).click();
  const squadUrl = admin.url();
  await admin.getByRole("button", { name: "Add character", exact: true }).click();
  await admin.getByLabel("Full in-game character name").fill("Calendar Adventurer");
  await admin.getByRole("checkbox").check();
  await admin.getByRole("button", { name: "Add placeholder", exact: true }).click();
  await admin.getByLabel("Owner of Calendar Adventurer").selectOption("player1");
  await expect(admin.getByLabel("Owner of Calendar Adventurer")).toHaveValue("player1");

  for (const [name, player] of [["Calendar Alt", "player1"], ["Other Character", "player2"]]) {
    await admin.getByRole("button", { name: "Add character", exact: true }).click();
    await admin.getByLabel("Full in-game character name").fill(name);
    await admin.getByRole("checkbox").check();
    await admin.getByRole("button", { name: "Add placeholder", exact: true }).click();
    await admin.getByLabel(`Owner of ${name}`).selectOption(player);
    await expect(admin.getByLabel(`Owner of ${name}`)).toHaveValue(player);
  }

  const owner = await browser.newPage({ timezoneId: "Europe/Sarajevo" });
  await login(owner, "player1");
  await owner.goto(squadUrl);
  await owner.getByRole("tab", { name: "Calendar", exact: true }).click();
  await owner.getByRole("button", { name: "Add availability", exact: true }).click();
  const characterSelect = owner.getByRole("combobox", { name: "Character (optional)", exact: true });
  await expect(characterSelect.locator("option")).toHaveText(["No character selected", "Calendar Adventurer", "Calendar Alt"]);
  await characterSelect.selectOption({ label: "Calendar Adventurer" });
  const today = await owner.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await owner.getByLabel("Start (local date and time)", { exact: true }).fill(`${today}T19:00`);
  await owner.getByLabel("End (local date and time)", { exact: true }).fill(`${today}T22:00`);
  await owner.getByRole("button", { name: "Add activity", exact: true }).click();
  await owner.getByRole("combobox", { name: /^Category/ }).first().selectOption("dungeon");
  await owner.getByLabel("Activity name", { exact: true }).first().fill("Stratholme");
  await owner.getByRole("button", { name: "Add activity", exact: true }).click();
  await owner.getByRole("combobox", { name: /^Category/ }).nth(1).selectOption("battleground");
  await owner.getByLabel("Activity name", { exact: true }).nth(1).fill("Warsong Gulch");
  await owner.getByRole("textbox", { name: /^Note \(optional\)/ }).fill("Happy to heal.");
  await owner.getByRole("button", { name: "Save availability", exact: true }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByText("Happy to heal.", { exact: true })).toBeVisible();
  await owner.reload();
  await owner.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(owner.getByText("Happy to heal.", { exact: true })).toBeVisible();

  const days = owner.locator(".calendar-day");
  await expect(days).toHaveCount(7);
  const boxes = await days.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, top: r.top, bottom: r.bottom }; }));
  expect(boxes.every((box, i) => i === 0 || (box.x === boxes[0].x && box.top >= boxes[i - 1].bottom))).toBe(true);

  const member = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Sarajevo" });
  await login(member, "player2");
  await member.goto(squadUrl);
  await member.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(member.getByText("Happy to heal.", { exact: true })).toBeVisible();
  await expect(member.getByText("Character: Calendar Adventurer", { exact: true })).toBeVisible();
  await expect(member.getByText(/Stratholme/)).toBeVisible();
  await expect(member.getByText(/Warsong Gulch/)).toBeVisible();
  await expect(member.getByRole("button", { name: "Edit availability by player1", exact: true })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Delete availability by player1", exact: true })).toHaveCount(0);
  await expect(member.getByText("Automatic Forever game events are not available yet.", { exact: true })).toBeVisible();
  expect(await member.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await member.screenshot({ path: "test-results/calendar-mobile.png", fullPage: true });
  await owner.screenshot({ path: "test-results/calendar-desktop.png", fullPage: true });

  await owner.getByRole("button", { name: "Edit availability by player1", exact: true }).click();
  await expect(characterSelect).toHaveValue(await characterSelect.locator("option", { hasText: "Calendar Adventurer" }).getAttribute("value") ?? "");
  await characterSelect.selectOption({ label: "Calendar Alt" });
  await owner.getByRole("textbox", { name: /^Note \(optional\)/ }).fill("Bring potions.");
  await owner.getByRole("button", { name: "Save availability", exact: true }).click();
  await expect(owner.getByText("Bring potions.", { exact: true })).toBeVisible();
  await expect(owner.getByText("Character: Calendar Alt", { exact: true })).toBeVisible();
  owner.once("dialog", (dialog) => dialog.accept());
  await owner.getByRole("button", { name: "Delete availability by player1", exact: true }).click();
  await expect(owner.getByText("Bring potions.", { exact: true })).toHaveCount(0);
  await member.reload();
  await member.getByRole("tab", { name: "Calendar", exact: true }).click();
  await expect(member.getByText("Happy to heal.", { exact: true })).toHaveCount(0);
  await admin.close();
  await owner.close();
  await member.close();
});
