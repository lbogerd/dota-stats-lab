import { expect, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "Query actions" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: `Delete ${renamedQuery}.sql?` })).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved queries" })).toBeVisible();
  await expect(page.getByText(`${renamedQuery}.sql`, { exact: true })).toHaveCount(0);
});
