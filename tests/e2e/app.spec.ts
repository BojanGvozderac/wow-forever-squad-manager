import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Login key", { exact: true })
    .fill(process.env[`E2E_KEY_${username}`]!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "The war room", exact: true }),
  ).toBeVisible();
}

test("admin roster, owner wishlist, read-only member, and mobile layout", async ({
  browser,
}) => {
  const admin = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await login(admin, "admin");
  await admin
    .getByRole("button", { name: "Create squad", exact: true })
    .click();
  await admin.getByLabel("Squad name").fill("The Night Watch");
  await admin.getByRole("combobox", { name: "Region", exact: true }).selectOption("us");
  await admin
    .getByRole("dialog")
    .getByRole("button", { name: "Create squad", exact: true })
    .click();
  await admin
    .getByRole("link")
    .filter({ has: admin.getByRole("heading", { name: "The Night Watch" }) })
    .click();
  await admin
    .getByRole("button", { name: "Add character", exact: true })
    .click();
  await admin
    .getByLabel("Full in-game character name")
    .fill("Aldric Dawnkeeper");
  await admin.getByRole("checkbox").check();
  await admin
    .getByRole("button", { name: "Add placeholder", exact: true })
    .click();
  await admin.getByLabel("Owner of Aldric Dawnkeeper").selectOption("player1");
  await expect(admin.getByLabel("Owner of Aldric Dawnkeeper")).toHaveValue(
    "player1",
  );
  await admin.getByRole("link", { name: "View Aldric Dawnkeeper" }).click();
  const characterUrl = admin.url();
  await expect(admin.getByText("NORMAL · AMERICAS & OCEANIA", { exact: true })).toBeVisible();
  await expect(
    admin.getByRole("heading", { name: "Aldric Dawnkeeper", exact: true }),
  ).toBeVisible();
  await expect(
    admin.getByRole("button", { name: "Add a goal", exact: true }),
  ).toHaveCount(0);

  const owner = await browser.newPage();
  await login(owner, "player1");
  await expect(
    owner.getByRole("button", { name: "Create squad", exact: true }),
  ).toHaveCount(0);
  await owner.goto(characterUrl);
  await owner
    .getByRole("button", { name: "Add a goal", exact: true })
    .first()
    .click();
  await owner.getByLabel("Goal name").fill("A better sword");
  await owner.getByLabel("Priority").selectOption("high");
  await owner
    .getByLabel("Notes (optional)")
    .fill("Run dungeons with the squad.");
  await owner.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    owner.getByRole("heading", { name: "A better sword" }),
  ).toBeVisible();
  await owner
    .getByRole("button", { name: "Mark A better sword acquired", exact: true })
    .click();
  await expect(
    owner.getByRole("button", {
      name: "Mark A better sword wanted",
      exact: true,
    }),
  ).toBeVisible();

  const member = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await login(member, "player2");
  await member.goto(characterUrl);
  await expect(
    member.getByRole("heading", { name: "A better sword" }),
  ).toBeVisible();
  await expect(
    member.getByRole("button", { name: "Edit A better sword" }),
  ).toHaveCount(0);
  await expect(
    member.getByRole("button", {
      name: "Mark A better sword wanted",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    await member.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await member.screenshot({
    path: "test-results/character-mobile.png",
    fullPage: true,
  });
  await admin.goto("/");
  await expect(
    admin.getByRole("heading", { name: "The Night Watch", exact: true }),
  ).toBeVisible();
  await admin.screenshot({
    path: "test-results/squads-desktop.png",
    fullPage: true,
  });
  await owner.getByRole("button", { name: "Sign out" }).click();
  await expect(owner.getByLabel("Login key", { exact: true })).toBeVisible();
  await admin.close();
  await owner.close();
  await member.close();
});

test("unauthenticated access and invalid key", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Login key", { exact: true }).fill("incorrect-key");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid username or access key",
  );
});

test("admin creates a player and the one-time key signs in", async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, "admin");
  await admin.getByRole("button", { name: "Create player", exact: true }).click();
  await admin.getByLabel("Player username", { exact: true }).fill("new_player");
  await admin.getByRole("button", { name: "Create player account", exact: true }).click();
  const key = await admin.getByLabel("Generated login key", { exact: true }).inputValue();
  expect(key.length).toBe(32);
  await expect(admin.getByLabel("Generated login key", { exact: true })).toHaveAttribute("type", "password");
  await admin.getByRole("button", { name: "Show login key", exact: true }).click();
  await expect(admin.getByLabel("Generated login key", { exact: true })).toHaveAttribute("type", "text");
  await admin.getByRole("button", { name: "Hide login key", exact: true }).click();
  await expect(admin.getByLabel("Generated login key", { exact: true })).toHaveAttribute("type", "password");
  await admin.screenshot({ path: "test-results/create-player.png", fullPage: true, mask: [admin.getByLabel("Generated login key", { exact: true })] });
  await admin.getByRole("button", { name: "Done", exact: true }).click();
  await expect(admin.getByLabel("Generated login key", { exact: true })).toHaveCount(0);
  const player = await browser.newPage();
  await player.goto("/login");
  await player.getByLabel("Username", { exact: true }).fill("new_player");
  await player.getByLabel("Login key", { exact: true }).fill(key);
  await player.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(player.getByRole("heading", { name: "The war room", exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Create player", exact: true })).toHaveCount(0);
  await admin.close();
  await player.close();
});
