import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true });

function completionOption(page: Page, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.locator(".cm-tooltip-autocomplete [role=option]").filter({
    has: page.locator(".cm-completionLabel").filter({ hasText: new RegExp(`^${escapedLabel}$`) }),
  });
}

function sqlEditor(page: Page) {
  return page.locator('[aria-label="SQL editor"] [role=textbox]');
}

async function replaceEditorText(page: Page, sql: string) {
  const editor = sqlEditor(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(sql);
}

test("mobile user can browse data and manage a saved query", async ({ page }) => {
  const queryName = `e2e-mobile-${Date.now()}`;
  const renamedQuery = `${queryName}-renamed`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good afternoon." })).toBeVisible();
  await expect(page.getByText("Stored matches", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Matches" }).last().click();
  await expect(page.getByRole("heading", { name: "Stored matches" })).toBeVisible();

  await page.getByRole("link", { name: "Queries" }).last().click();
  await expect(page.getByRole("heading", { name: "Saved queries" })).toBeVisible();
  await page.getByRole("button", { name: "New query" }).click();
  await page.getByLabel("Query file name").fill(queryName);
  await page.getByRole("button", { name: "Create file" }).click();

  await expect(page.getByRole("heading", { name: `${queryName}.sql` })).toBeVisible();

  await replaceEditorText(page, "SELECT * FROM raw.");
  const recordsCompletion = completionOption(page, "records");
  await expect(recordsCompletion).toBeVisible();
  await expect(recordsCompletion.locator(".cm-completionDetail")).toHaveText("table");
  await recordsCompletion.tap();
  await expect(sqlEditor(page)).toContainText("SELECT * FROM raw.records");

  await replaceEditorText(page, "SELECT r\nFROM raw.records AS r;");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("End");
  await page.keyboard.type(".");
  const columnCompletion = completionOption(page, "extraction_id");
  await expect(columnCompletion).toBeVisible();
  await expect(columnCompletion.locator(".cm-completionDetail")).toHaveText("VARCHAR");
  await columnCompletion.click();
  await expect(sqlEditor(page)).toContainText("SELECT r.extraction_id");

  await replaceEditorText(page, "SELECT * FROM analysis.");
  const macroCompletion = completionOption(page, "entity_property_history");
  await expect(macroCompletion).toBeVisible();
  await expect(macroCompletion.locator(".cm-completionDetail")).toHaveText(
    "table macro (requested_extraction_id, requested_instance_id, requested_property_path)",
  );

  const runnableSql = "SELECT r.extraction_id\nFROM raw.records AS r\nLIMIT 1;";
  await replaceEditorText(page, runnableSql);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Run/ }).click();
  await expect(page.getByText("Read-only result", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Query actions" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SQL" }).click();
  expect((await download).suggestedFilename()).toBe(`${queryName}.sql`);

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("File name").fill(renamedQuery);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/queries/${renamedQuery}$`));

  await page.getByRole("link", { name: "Saved queries" }).click();
  await page.getByRole("link", { name: new RegExp(`^${renamedQuery}\\.sql`) }).click();
  await expect(sqlEditor(page)).toContainText(runnableSql.replaceAll("\n", ""));
  await page.getByRole("button", { name: "Query actions" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: `Delete ${renamedQuery}.sql?` })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved queries" })).toBeVisible();
  await expect(page.getByText(`${renamedQuery}.sql`, { exact: true })).toHaveCount(0);
});

test("mobile user can open a real match overview", async ({ page }) => {
  const mapResponse = await page.request.get("/assets/dota-map.webp");
  expect(mapResponse.ok()).toBeTruthy();
  expect(mapResponse.headers()["content-type"]).toContain("image/webp");

  const fixtureMatchId = process.env.E2E_MATCH_ID;
  if (fixtureMatchId) {
    expect(fixtureMatchId).toMatch(/^[1-9][0-9]*$/);
    await page.goto(`/matches/${fixtureMatchId}`);
  } else {
    await page.goto("/matches");
    await expect(page.getByRole("heading", { name: "Stored matches" })).toBeVisible();

    const matchLink = page.locator('main a[href^="/matches/"]:visible').first();
    await expect(matchLink, "ingest at least one replay before running browser tests").toBeVisible();
    const href = await matchLink.getAttribute("href");
    expect(href).toMatch(/^\/matches\/[1-9][0-9]*$/);
    await matchLink.click();
  }

  await expect(page.locator("h1")).toHaveText(/^#[1-9][0-9]*$/);
  await expect(page.getByText("Winning team:", { exact: false })).toBeVisible();
  await expect(page.getByText("DuckDB analysis", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Valve win probability" })).toBeVisible();
  const probabilityReady = page.getByTestId("win-probability-ready");
  const probabilityUnavailable = page.getByTestId("win-probability-unavailable");
  if (process.env.E2E_REQUIRE_WIN_PROBABILITY === "1") {
    await expect(probabilityReady).toBeVisible();
  } else {
    await expect(probabilityReady.or(probabilityUnavailable)).toBeVisible();
  }
  if (await probabilityReady.isVisible()) {
    const probabilityChart = probabilityReady.getByRole("group", { name: /Valve win probability.*interactive line chart/i });
    await probabilityChart.focus();
    await expect(probabilityChart).toBeFocused();
    await probabilityChart.press("Home");
    await probabilityChart.press("ArrowRight");
    await probabilityChart.press("End");
    await probabilityChart.press("ArrowLeft");
  }
  await expect(page.getByRole("heading", { name: "Granular GPM" })).toBeVisible();
  const gpmWindow = page.getByLabel("Rolling GPM window");
  await expect(gpmWindow).toHaveValue("60");
  const rollingGraph = page.getByText("Rolling GPM - last 60 seconds", { exact: true });
  const unavailable = page.getByText(/Granular gold data is unavailable for this extraction/);
  await expect(rollingGraph.or(unavailable)).toBeVisible();
  if (await rollingGraph.isVisible()) {
    await gpmWindow.selectOption("1");
    await expect(page.getByText("Rolling GPM - last 1 seconds", { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Hero location heat map" })).toBeVisible();
  const heatmapReady = page.getByText(/Showing [0-9,]+ position samples from/);
  const heatmapUnavailable = page.getByText(/Hero position data is unavailable for this extraction/);
  if (process.env.E2E_REQUIRE_HERO_POSITIONS === "1") {
    await expect(heatmapReady).toBeVisible();
  } else {
    await expect(heatmapReady.or(heatmapUnavailable)).toBeVisible();
  }
  if (await heatmapReady.isVisible()) {
    const heroSelect = page.getByLabel("Heat map hero");
    const heroOptions = heroSelect.locator("option");
    expect(await heroOptions.count()).toBeGreaterThan(1);
    await heroSelect.selectOption({ index: 1 });
    const selectedHero = await heroSelect.locator("option:checked").textContent();
    expect(selectedHero).toBeTruthy();
    await page.locator("#end-time-text").fill("0:10.0");
    await page.locator("#end-time-text").press("Enter");
    await expect(page.getByText(/Selection:/)).toContainText(`${selectedHero}, 0:00.0–0:10.0`);
    await expect(page.getByText(/Showing [0-9,]+ position samples from 0:00.0 through 0:10.0/)).toBeVisible();
  }
  await expect(page.getByText(/ roster$/, { exact: false })).toHaveCount(2);
  await expect(page.locator(':text-is("Final items"):visible').first()).toBeVisible();

  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth);
});

test("mobile user can read the hero overview", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Heroes" }).last().click();

  await expect(page).toHaveURL(/\/heroes$/);
  await expect(page.getByRole("heading", { name: "Hero overview" })).toBeVisible();
  await expect(page.getByText(/Metric scope: [1-9][0-9,]* matches?/)).toBeVisible();

  const firstHero = page.getByRole("article").first();
  await expect(firstHero, "ingest at least one replay before running browser tests").toBeVisible();
  for (const metric of [
    "Average GPM",
    "Average XPM",
    "Wins-Losses",
    "Win-Loss rate",
    "Picks and pick rate",
    "Bans and ban rate",
  ]) {
    await expect(firstHero.getByText(metric, { exact: true })).toBeVisible();
  }

  const sizes = await page.evaluate(() => ({
    viewport: window.innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(sizes.body, sizes.document)).toBeLessThanOrEqual(sizes.viewport);
});
