import { test, expect, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Login key", { exact: true }).fill(process.env[`E2E_KEY_${username}`]!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The war room", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "AI connections" }).click();
}

test("personal token connects, changes owner wishlist, and is revoked", async ({ page, browser }) => {
  await login(page, "player1");
  await page.getByRole("button", { name: "Create token", exact: true }).click();
  await page.getByLabel("Connection name").fill("Integration assistant");
  await expect(page.getByRole("checkbox", { name: "Edit my characters’ wishlists" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Manage my availability" })).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Edit my characters’ wishlists" }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Create token", exact: true }).click();
  const field = page.getByLabel("Generated MCP token", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  const token = await field.inputValue();
  expect(token.startsWith("wft_mcp_")).toBe(true);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(field).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Integration assistant" })).toBeVisible();
  await expect(field).toHaveCount(0);

  const other = await browser.newPage();
  await login(other, "player2");
  await expect(other.getByRole("heading", { name: "Integration assistant" })).toHaveCount(0);
  await other.close();

  const client = new Client({ name: "war-room-e2e", version: "1.0.0" });
  const url = new URL("/mcp", page.url());
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("add_wishlist_entry");
    const context = await client.callTool({ name: "get_my_context", arguments: {} });
    expect(JSON.stringify(context)).toContain("mcp-main");
    expect(JSON.stringify(context)).toContain("mcp-alt");
    const args = { characterId: "mcp-main", title: "MCP integration sword", category: "item", priority: "high", status: "wanted", idempotencyKey: "e2e-wishlist-create" };
    const created = await client.callTool({ name: "add_wishlist_entry", arguments: args });
    expect(created.isError).not.toBe(true);
    const retry = await client.callTool({ name: "add_wishlist_entry", arguments: args });
    expect(retry.isError).not.toBe(true);
    const denied = await client.callTool({ name: "add_wishlist_entry", arguments: { ...args, characterId: "mcp-other", idempotencyKey: "e2e-denied" } });
    expect(denied.isError).toBe(true);
    await page.goto("/characters/mcp-main");
    await expect(page.getByRole("heading", { name: "MCP integration sword", exact: true })).toHaveCount(1);
    await page.getByRole("link", { name: "AI connections" }).click();
    await page.getByRole("button", { name: "Revoke Integration assistant" }).click();
    await expect(page.getByRole("button", { name: "Revoke Integration assistant" })).toHaveCount(0);
    const response = await page.request.post(url.href, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(response.status()).toBe(401);
  } finally { await client.close(); }
});

test("AI connections fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "player2");
  await page.getByText("Codex CLI setup", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/connections-mobile.png", fullPage: true });
});
