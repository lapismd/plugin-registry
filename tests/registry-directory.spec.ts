import { expect, test } from "@playwright/test";

const directoryPath = "/plugins/";

test("plugin directory uses the reference card layout and filter treatment", async ({
  page,
}) => {
  await page.goto(directoryPath);

  const primaryNavigation = page.getByRole("navigation", { name: "Primary" });
  const pluginsNavigationLink = primaryNavigation.getByRole("link", {
    name: "Plugins",
  });
  const layout = page.locator("[data-plugin-search-root]");
  const heading = page.locator(".results-heading h1");
  const cards = page.locator("[data-search-item]");
  const resultList = page.locator("[data-result-list]");
  const listButton = page.locator('button[data-view="list"]');
  const cardsButton = page.locator('button[data-view="grid"]');

  await expect(pluginsNavigationLink).toHaveAttribute("aria-current", "page");
  await expect(pluginsNavigationLink).toHaveCSS(
    "background-color",
    "rgb(38, 38, 38)",
  );
  await expect(pluginsNavigationLink).toHaveCSS("color", "rgb(255, 255, 255)");

  expect(
    await layout.evaluate((node) => {
      const pageMain = node.closest("main")!;
      const style = getComputedStyle(node);
      const mainBox = pageMain.getBoundingClientRect();
      return {
        pageWidth: mainBox.width,
        columns: style.gridTemplateColumns.split(" "),
        gap: style.columnGap,
      };
    }),
  ).toEqual({
    pageWidth: 1120,
    columns: ["160px", "928px"],
    gap: "32px",
  });
  expect(
    await heading.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
      };
    }),
  ).toEqual({ fontSize: "36px", lineHeight: "40px", fontWeight: "600" });

  await expect(resultList).toHaveAttribute("data-view", "grid");
  await expect(cardsButton).toHaveAttribute("aria-pressed", "true");
  await expect(listButton).toHaveAttribute("aria-pressed", "false");
  await expect(cardsButton.locator("svg")).toHaveCount(1);
  await expect(listButton.locator("svg")).toHaveCount(1);
  expect(
    await cardsButton.evaluate((node) => {
      const group = node.parentElement!;
      const style = getComputedStyle(node);
      const groupStyle = getComputedStyle(group);
      return {
        groupHeight: group.getBoundingClientRect().height,
        groupRadius: groupStyle.borderRadius,
        activeBackground: style.backgroundColor,
        activeRadius: style.borderRadius,
        color: style.color,
        font: [style.fontSize, style.lineHeight, style.fontWeight],
      };
    }),
  ).toEqual({
    groupHeight: 36,
    groupRadius: "8px",
    activeBackground: "rgb(54, 54, 54)",
    activeRadius: "0px 7px 7px 0px",
    color: "rgb(255, 255, 255)",
    font: ["14px", "20px", "500"],
  });

  await expect(cards.first()).toBeVisible();
  expect(
    await resultList.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        columns: style.gridTemplateColumns.split(" ").length,
        gap: style.gap,
      };
    }),
  ).toEqual({ columns: 3, gap: "8px" });
  expect(
    await cards.first().evaluate((node) => {
      const style = getComputedStyle(node);
      const title = node.querySelector<HTMLElement>(
        ".dense-plugin-row__title",
      )!;
      const description = node.querySelector<HTMLElement>(
        ".dense-plugin-row__description",
      )!;
      const titleStyle = getComputedStyle(title);
      const descriptionStyle = getComputedStyle(description);
      return {
        height: node.getBoundingClientRect().height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        padding: style.padding,
        titleFont: [
          titleStyle.fontSize,
          titleStyle.lineHeight,
          titleStyle.fontWeight,
        ],
        descriptionFont: [
          descriptionStyle.fontSize,
          descriptionStyle.lineHeight,
        ],
        descriptionClamp: descriptionStyle.webkitLineClamp,
      };
    }),
  ).toEqual({
    height: 92,
    radius: "12px",
    background: "rgb(31, 31, 31)",
    borderWidth: "0px",
    padding: "12px",
    titleFont: ["16px", "24px", "500"],
    descriptionFont: ["14px", "20px"],
    descriptionClamp: "2",
  });
  await expect(cards.first()).not.toContainText("0 B");
  await cards.first().hover();
  await expect(cards.first()).toHaveCSS("background-color", "rgb(38, 38, 38)");

  const typeFilter = page.locator(".filter-option--static");
  await expect(typeFilter).toHaveAttribute("aria-pressed", "true");
  await expect(typeFilter).toHaveCSS("background-color", "rgb(138, 92, 245)");
  await expect(typeFilter).toHaveCSS("color", "rgb(255, 255, 255)");

  const categoryFilter = page.locator('[data-filter-category="ai"]');
  await categoryFilter.focus();
  await categoryFilter.press("Enter");
  await expect(categoryFilter).toHaveAttribute("aria-pressed", "true");
  await expect(categoryFilter).toHaveCSS("background-color", "rgb(30, 30, 30)");
  await expect(categoryFilter).toHaveCSS("color", "rgb(229, 229, 229)");
  const categoryCheck = categoryFilter.locator(".filter-option__icon-check");
  await expect(categoryCheck).toBeVisible();
  await expect(categoryCheck).toHaveCSS(
    "background-color",
    "rgb(138, 92, 245)",
  );
  await expect(categoryCheck).toHaveCSS("color", "rgb(255, 255, 255)");
  expect(
    await categoryCheck.locator("svg").evaluate((node) => ({
      size: [
        node.getBoundingClientRect().width,
        node.getBoundingClientRect().height,
      ],
      strokeWidth: node.getAttribute("stroke-width"),
    })),
  ).toEqual({ size: [12, 12], strokeWidth: "3" });

  const extraCategories = page.locator("[data-category-extra]");
  expect(await extraCategories.count()).toBeGreaterThan(0);
  await expect(extraCategories.first()).toBeHidden();
  const categoryToggle = page.locator("[data-category-toggle]");
  await expect(categoryToggle).toHaveText("Show more");
  await categoryToggle.click();
  await expect(categoryToggle).toHaveAttribute("aria-expanded", "true");
  await expect(categoryToggle).toHaveText("Show less");
  await expect(extraCategories.first()).toBeVisible();

  await listButton.click();
  await expect(resultList).toHaveAttribute("data-view", "list");
  await expect(listButton).toHaveAttribute("aria-pressed", "true");
  await expect(cardsButton).toHaveAttribute("aria-pressed", "false");
  await expect(listButton).toHaveCSS("border-radius", "7px 0px 0px 7px");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);
});

test("homepage sort queries initialize and persist the directory sort", async ({
  page,
}) => {
  await page.route("**/stats/summary.json", async (route) => {
    await route.fulfill({ json: downloadSummary() });
  });

  const cases = [
    { value: "popular", label: "Popular" },
    { value: "new", label: "New" },
    { value: "updated", label: "Recently updated" },
  ];
  for (const { value, label } of cases) {
    await page.goto(`/plugins/?sort=${value}`);
    await expect(page.locator("[data-sort-label]")).toHaveText(label);
    await expect(page.locator(`[data-sort-value="${value}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URL(page.url()).searchParams.get("sort")).toBe(value);
    if (value === "new" || value === "updated") {
      const attribute = value === "new" ? "released" : "updated";
      const dates = await page
        .locator("[data-search-item]")
        .evaluateAll(
          (items, datasetKey) =>
            items.map(
              (item) =>
                (item as HTMLElement).dataset[
                  datasetKey as "released" | "updated"
                ] || "",
            ),
          attribute,
        );
      expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
    }
  }

  await page.goto("/plugins/?sort=popular");
  await expect(page.locator("[data-search-item]").first()).toHaveAttribute(
    "data-plugin-id",
    "bases",
  );

  await page.goto("/plugins/?categories=ai");
  await page.locator("[data-sort-trigger]").click();
  await page.locator('[data-sort-value="new"]').click();
  const updatedUrl = new URL(page.url());
  expect(updatedUrl.searchParams.get("categories")).toBe("ai");
  expect(updatedUrl.searchParams.get("sort")).toBe("new");
});

test.describe("mobile plugin directory", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("uses one card column and an accessible filter drawer", async ({
    page,
  }) => {
    await page.goto(directoryPath);

    const resultList = page.locator("[data-result-list]");
    expect(
      await resultList.evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(1);

    const filterPanel = page.getByRole("complementary", {
      name: "Plugin filters",
    });
    const openFilters = page.getByRole("button", { name: "Open filters" });
    await expect(filterPanel).toBeHidden();
    await openFilters.click();
    await expect(filterPanel).toBeVisible();
    await expect(openFilters).toHaveAttribute("aria-expanded", "true");
    const closeFilters = page.getByRole("button", {
      name: "Close",
      exact: true,
    });
    await expect(closeFilters).toBeFocused();
    await closeFilters.click();
    await expect(filterPanel).toBeHidden();
    await expect(openFilters).toBeFocused();
  });
});

function downloadSummary() {
  const through = new Date();
  through.setUTCDate(through.getUTCDate() - 2);
  const trackedSince = new Date(through);
  trackedSince.setUTCDate(trackedSince.getUTCDate() - 30);
  const throughDate = through.toISOString().slice(0, 10);
  const trackedSinceDate = trackedSince.toISOString().slice(0, 10);
  const counts = { ai: 2, bases: 10, history: 5 };
  const plugins = Object.fromEntries(
    Object.entries(counts).map(([pluginId, total]) => [
      pluginId,
      { total, versions: {} },
    ]),
  );
  const period = {
    from: trackedSinceDate,
    through: throughDate,
    total: 17,
    plugins,
    versions: {},
    actions: {},
    platforms: {},
    os: {},
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: "lapis_plugin_downloads_v1",
    metric: "approximate_redirect_requests",
    trackedSince: trackedSinceDate,
    through: throughDate,
    periods: {
      lifetime: period,
      "7d": period,
      "30d": period,
    },
  };
}
