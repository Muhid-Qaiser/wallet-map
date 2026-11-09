import { expect, test } from "@playwright/test";

test("sample exploration, evidence, comparison, saving, and portable export", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Follow the funds/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/wallet-map-home.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open sample investigation", exact: true })
    .click();
  await expect(
    page.getByText(
      "Sample investigation. Addresses, balances, and transfers are illustrative.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("graph")).toBeVisible();
  await page.getByRole("button", { name: "Table view" }).click();
  await page
    .getByRole("button", { name: /Inspect connection/ })
    .first()
    .click();
  await expect(
    page.getByText("Connection evidence", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SUPPORTING TRANSFERS", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Compare wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Compare connections" }).click();
  await expect(
    page.getByText(/shared counterparties$/, { exact: false }).first(),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Address notes" })
    .fill("Review this shared counterparty.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved in this browser");
  await page.getByRole("button", { name: "Graph view" }).click();
  await page.screenshot({
    path: "test-results/wallet-map-investigation.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Saved investigations" }).click();
  await page.getByRole("button", { name: /^Sample investigation/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Address notes" }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Compare wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Compare connections" }).click();
  await expect(
    page.getByRole("textbox", { name: "Address notes" }),
  ).toHaveValue("Review this shared counterparty.");
  await page.getByLabel("Export investigation", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Investigation JSON" }).click();
  const download = await downloaded;
  const path = await download.path();
  if (!path) throw new Error("Export missing");
  await page.getByLabel("Import investigation file").setInputFiles(path);
  await expect(page.getByRole("status")).toContainText("Opened saved snapshot");
  expect(errors).toEqual([]);
});

test("validates address and invalid imports", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Wallet address", exact: true })
    .fill("not-an-address");
  await page
    .getByRole("button", { name: "Explore wallet", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "valid Ethereum address" }),
  ).toBeVisible();
  await page.getByLabel("Import investigation file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":2}'),
  });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "not a valid Wallet Map investigation" }),
  ).toBeVisible();
});

test("mobile layout and keyboard-accessible table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sample investigation", exact: true })
    .click();
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: /Inspect connection/ })
    .first()
    .click();
  await expect(
    page.getByText("Connection evidence", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/wallet-map-mobile.png",
    fullPage: true,
  });
});

test("expands indirect connections and fits the graph to full screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "How to read the graph" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open sample investigation", exact: true })
    .click();
  const graph = page.getByTestId("graph");
  await expect(graph).toHaveAttribute("aria-label", /11 addresses/);
  await page
    .getByRole("button", { name: "Expand next hop", exact: true })
    .click();
  await expect(graph).toHaveAttribute(
    "aria-label",
    /15 addresses, 17 directed connections/,
  );
  await page.getByRole("button", { name: "Show all connections" }).click();
  await expect(graph).toHaveAttribute(
    "aria-label",
    /15 addresses, 19 directed connections/,
  );
  await page.getByRole("button", { name: "Open full screen" }).click();
  const fullScreenBounds = await graph.boundingBox();
  expect(fullScreenBounds?.width).toBe(page.viewportSize()?.width);
  await page
    .getByRole("dialog", { name: "Wallet graph" })
    .getByRole("button", { name: "Show paths only" })
    .click();
  await expect(graph).toHaveAttribute(
    "aria-label",
    /15 addresses, 17 directed connections/,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open full screen" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(
    page.getByRole("button", {
      name: /Inspect connection 0x3{40} to 0x[dD]{40}/,
    }),
  ).toBeVisible();
});

test("real wallet search returns evidence from the live API", async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_SMOKE !== "true",
    "Set LIVE_SMOKE=true to use your configured Alchemy key.",
  );
  test.setTimeout(90000);
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Wallet address", exact: true })
    .fill("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  await page.getByLabel("Network", { exact: true }).selectOption("1");
  await page.getByLabel("Date range", { exact: true }).selectOption("7");
  await page
    .getByRole("button", { name: "Explore wallet", exact: true })
    .click();
  await expect(page.getByText("STARTING ADDRESS", { exact: true })).toBeVisible(
    { timeout: 60000 },
  );
  await expect(
    page.getByRole("link", { name: "View on Etherscan", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load balance", exact: true }).click();
  await expect(page.locator(".balance-text")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".history-status .warning-text")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/wallet-map-live.png",
    fullPage: true,
  });
});
