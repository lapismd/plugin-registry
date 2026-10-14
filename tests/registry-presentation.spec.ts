import { expect, test } from "@playwright/test";

test("the footer identifies the registry snapshot with a valid UTC timestamp", async ({
  page,
}) => {
  await page.goto("/plugins/");
  const timestamp = page.locator(".site-footer time[data-registry-updated]");
  await expect(timestamp).toBeVisible();
  expect(
    Number.isFinite(Date.parse((await timestamp.getAttribute("datetime"))!)),
  ).toBe(true);
  await expect(timestamp).toContainText("UTC");
  const copyright = await page.locator(".site-footer__copyright").boundingBox();
  const updated = await timestamp.boundingBox();
  expect(updated!.y).toBeGreaterThan(copyright!.y);
});

test("the header opens a full manifest page with highlighted, unchanged JSON", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Manifest", exact: true })
    .click();
  await expect(page).toHaveURL(/\/manifest\/$/);
  await expect(
    page.getByRole("heading", { name: "Registry manifest", exact: true }),
  ).toBeVisible();
  const code = page.locator("main pre code");
  await expect(code).toContainText('"schemaVersion"');
  expect(await code.locator("span[style]").count()).toBeGreaterThan(0);
  const rawHref = await page
    .getByRole("link", { name: "Raw JSON", exact: true })
    .getAttribute("href");
  const raw = await request.get(rawHref!);
  expect(raw.ok()).toBe(true);
  expect(JSON.parse((await code.innerText()).trim())).toEqual(await raw.json());
  const box = await page.locator("main").boundingBox();
  expect(box!.height).toBeGreaterThan(500);
});
