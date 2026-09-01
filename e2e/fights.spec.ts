import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true });

test("mobile user can filter and inspect death-based engagements", async ({ page }) => {
  await openMatch(page);

  const scope = page.getByLabel("Match lens data scope");
  await scope.selectOption("team-2");
  await page.getByRole("link", { name: "Fights" }).click();
  await expect(page).toHaveURL(/\/matches\/[1-9][0-9]*\/fights\?.*scope=team-2/);
  await expect(page.getByRole("heading", { name: "Fights" })).toBeVisible();

  const ready = page.getByTestId("fights-ready");
  const empty = page.getByTestId("fights-empty");
  const unavailable = page.getByTestId("fights-unavailable");
  await expect(ready.or(empty).or(unavailable)).toBeVisible();
  if (process.env.E2E_REQUIRE_FIGHT_POSITIONS === "1") await expect(ready).toBeVisible();

  if (await ready.isVisible()) {
    await ready.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/matches\/[1-9][0-9]*\/fights\/[1-9][0-9]*\?.*scope=team-2/);
    await expect(page.getByTestId("fight-detail")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team totals" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Participant results" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Deaths" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Objectives" })).toBeVisible();

    const map = page.getByTestId("fight-map");
    const positionUnavailable = page.getByTestId("fight-positions-unavailable");
    const positionEmpty = page.getByTestId("fight-positions-empty");
    await expect(map.or(positionUnavailable).or(positionEmpty)).toBeVisible();
    if (process.env.E2E_REQUIRE_FIGHT_POSITIONS === "1") await expect(map).toBeVisible();
    if (await map.isVisible()) {
      const time = page.getByRole("status").filter({ hasText: /^-?[0-9]+:[0-9]{2}\.[0-9]$/ });
      const before = await time.textContent();
      await page.getByRole("button", { name: "Next 100 ms" }).click();
      const after = await time.textContent();
      expect(timeMilliseconds(after)).toBe(timeMilliseconds(before) + 100);
      await page.getByRole("button", { name: "Previous 100 ms" }).click();
      await expect(time).toHaveText(before ?? "");
    }

    await page.getByRole("link", { name: "Back to filtered fights" }).click();
    await expect(page).toHaveURL(/\/matches\/[1-9][0-9]*\/fights\?.*scope=team-2/);
  }

  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(Math.max(widths.body, widths.document)).toBeLessThanOrEqual(widths.viewport);
});

async function openMatch(page: Page) {
  const matchId = process.env.E2E_MATCH_ID;
  if (matchId) {
    expect(matchId).toMatch(/^[1-9][0-9]*$/);
    await page.goto(`/matches/${matchId}`);
    return;
  }
  await page.goto("/matches");
  const matchLink = page.locator('main a[href^="/matches/"]:visible').first();
  await expect(matchLink, "ingest at least one replay before running browser tests").toBeVisible();
  await matchLink.click();
}

function timeMilliseconds(value: string | null): number {
  const match = /^(-?)([0-9]+):([0-9]{2})\.([0-9])$/.exec(value ?? "");
  if (match === null) throw new Error(`Unexpected playback time: ${value}`);
  const milliseconds = (Number(match[2]) * 60 + Number(match[3])) * 1_000 + Number(match[4]) * 100;
  return match[1] === "-" ? -milliseconds : milliseconds;
}
