import { expect, test } from "@playwright/test";
import { loadEntries } from "../scripts/lib/registry.mjs";

test("version selector opens a shareable older release with its own archive and compatibility", async ({
  page,
}) => {
  await page.goto("/plugins/lapis-graph/");
  const versions = page.getByRole("combobox", { name: "Plugin version" });
  await expect(versions).toHaveValue("/plugins/lapis-graph/");
  await versions.selectOption({ label: "2026.6.6" });
  await expect(page).toHaveURL(
    /\/plugins\/lapis-graph\/versions\/2026\.6\.6\/$/,
  );
  await expect(versions.locator("option:checked")).toHaveText("2026.6.6");
  await expect(page.locator("[data-selected-compatibility]")).toHaveText(
    "Lapis 1.7.7+",
  );
  await page.reload();
  await expect(versions).toHaveValue("/plugins/lapis-graph/versions/2026.6.6/");
  await expect(
    page.getByRole("link", { name: "Install in Lapis", exact: true }),
  ).toHaveAttribute("href", "lapis://plugins?id=lapis-graph&version=2026.6.6");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Installation help" }).click();
  const dialog = page.getByRole("dialog", { name: "Install Graph 2026.6.6" });
  await expect(dialog).toBeVisible();
  const download = dialog.getByRole("link", {
    name: "Download Graph 2026.6.6",
  });
  await expect(download).toHaveAttribute("href", /2026\.6\.6/);
  await expect(download).toHaveAttribute("data-plugin-version", "2026.6.6");
  await expect(dialog).toContainText("Install from .lapis-plugin");
  await dialog
    .getByRole("button", { name: "Close installation instructions" })
    .press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "More actions" }),
  ).toBeFocused();
  await page.getByRole("tab", { name: "Changelog", exact: true }).click();
  await expect(page.locator("[data-plugin-changelog]")).toHaveCount(1);
  await expect(page.locator("[data-plugin-changelog]")).toHaveAttribute(
    "aria-label",
    "2026.6.6 changelog",
  );
  await versions.selectOption("/plugins/lapis-graph/");
  const graph = (await loadEntries()).find(
    (entry) => entry.id === "lapis-graph",
  );
  await expect(versions.locator("option:checked")).toHaveText(
    `${graph.latestVersion} (Latest)`,
  );
});

test("a pending source version cannot install while its retained published version can", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.LAPIS_REGISTRY_TEST_BASE_URL),
    "Uses the local source fixture.",
  );
  await page.goto("/plugins/ai/");
  await expect(
    page.getByRole("button", { name: "Install pending" }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Plugin version" })
    .selectOption({ label: "0.1.2" });
  await expect(
    page
      .getByRole("combobox", { name: "Plugin version" })
      .locator("option:checked"),
  ).toHaveText("0.1.2");
  await expect(
    page.getByRole("link", { name: "Install in Lapis", exact: true }),
  ).toBeEnabled();
});
