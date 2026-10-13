import { expect, test } from "@playwright/test";

test("the primary install action opens the selected plugin release in Lapis", async ({
  page,
}) => {
  await page.goto("/plugins/lapis-source-editor/versions/0.1.1/");
  const install = page.locator("[data-install-button]");
  await expect(install).toHaveAttribute(
    "href",
    "lapis://plugins?id=lapis-source-editor&version=0.1.1",
  );
  await expect(install).toHaveAccessibleName("Install in Lapis");
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Open in installed web app" }),
  ).toHaveAttribute(
    "href",
    "web+lapis://plugins?id=lapis-source-editor&version=0.1.1",
  );
  await expect(
    page.getByRole("menuitem", { name: "Download .lapis-plugin" }),
  ).toHaveAttribute("data-plugin-version", "0.1.1");
});
