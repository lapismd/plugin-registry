import { expect, test } from "@playwright/test";

test("Source Editor changelog keeps wrapped text inside its bullet", async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/plugins/lapis-source-editor/");
    await page.getByRole("tab", { name: "Changelog", exact: true }).click();
    const changelog = page.locator("[data-plugin-changelog]");
    await expect(changelog).toBeVisible();
    await expect(changelog.locator("li")).toHaveText([
      "Initial independent public package extracted from Lapis Notes without changing the runtime plugin ID.",
    ]);
    await expect(changelog.locator("div > p")).toHaveCount(0);
    await expect(changelog.locator("ul")).toHaveCSS("list-style-type", "disc");
    expect(
      await changelog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
  }
});
