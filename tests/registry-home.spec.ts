import { expect, test } from "@playwright/test";

test("homepage matches the reference discovery layout and Lapis Notes wordmark", async ({
  page,
}) => {
  await page.goto("/");

  const brand = page.locator(".site-brand");
  await expect(brand).toHaveAccessibleName("Lapis Notes Plugin Registry");
  await expect(brand.locator(".site-brand__product")).toHaveText("Lapis");
  await expect(brand.locator(".site-brand__accent")).toHaveText("Notes");
  await expect(brand.locator(".site-brand__accent")).toHaveCSS(
    "color",
    "rgb(167, 139, 250)",
  );
  await brand.hover();
  await expect(brand.locator(".site-brand__accent")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make Lapis Notes yours.",
  );
  await expect(page.locator(".home-hero p")).toHaveCSS("font-size", "18px");
  await expect(page.locator(".home-hero p")).toHaveCSS("line-height", "28px");

  const discovery = page.locator(".home-discovery-grid");
  expect(
    await discovery.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        columns: style.gridTemplateColumns.split(" ").length,
        gap: style.gap,
      };
    }),
  ).toEqual({ columns: 3, gap: "32px" });

  const laneHeadings = discovery.locator("h3");
  await expect(laneHeadings).toHaveCount(3);
  await expect(laneHeadings.nth(0)).toContainText("Popular");
  await expect(laneHeadings.nth(1)).toContainText("New");
  await expect(laneHeadings.nth(2)).toContainText("Updated");
  const laneLinks = discovery.locator(".home-lane-heading a");
  await expect(laneLinks.nth(0)).toHaveAttribute(
    "href",
    "/plugins/?sort=popular",
  );
  await expect(laneLinks.nth(1)).toHaveAttribute("href", "/plugins/?sort=new");
  await expect(laneLinks.nth(2)).toHaveAttribute(
    "href",
    "/plugins/?sort=updated",
  );

  const firstPlugin = discovery.locator(".dense-plugin-row").first();
  expect(
    await firstPlugin.evaluate((node) => {
      const style = getComputedStyle(node);
      const identity = node.querySelector<HTMLElement>(".plugin-identity")!;
      const body = node.querySelector<HTMLElement>(".dense-plugin-row__body")!;
      const description = node.querySelector<HTMLElement>(
        ".dense-plugin-row__description",
      )!;
      return {
        height: node.getBoundingClientRect().height,
        padding: style.padding,
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        radius: style.borderRadius,
        iconSize: [
          identity.getBoundingClientRect().width,
          identity.getBoundingClientRect().height,
        ],
        bodyBorder: getComputedStyle(body).borderBottomWidth,
        descriptionFont: [
          getComputedStyle(description).fontSize,
          getComputedStyle(description).lineHeight,
        ],
      };
    }),
  ).toEqual({
    height: 77,
    padding: "8px 0px 0px",
    background: "rgba(0, 0, 0, 0)",
    borderWidth: "0px",
    radius: "12px",
    iconSize: [48, 48],
    bodyBorder: "1px",
    descriptionFont: ["12px", "16px"],
  });
  await expect(discovery).not.toContainText("0 B");

  const categoryGrid = page.locator(".home-category-grid");
  expect(
    await categoryGrid.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        columns: style.gridTemplateColumns.split(" ").length,
        gap: style.gap,
      };
    }),
  ).toEqual({ columns: 4, gap: "8px" });
  const firstCategory = categoryGrid.locator(".home-category-card").first();
  await expect(firstCategory).toHaveCSS("height", "56px");
  await expect(firstCategory).toHaveCSS("border-radius", "12px");
});

test.describe("mobile registry homepage", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stacks discovery lanes and categories without horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
      "font-size",
      "42px",
    );
    await expect(page.locator(".home-hero p")).toHaveCSS("font-size", "18px");
    expect(
      await page
        .locator(".home-discovery-grid")
        .evaluate(
          (node) =>
            getComputedStyle(node).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(1);
    expect(
      await page
        .locator(".home-category-grid")
        .evaluate(
          (node) =>
            getComputedStyle(node).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(1);
    await expect(page.locator(".home-category-card").first()).toHaveCSS(
      "border-radius",
      "0px",
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });
});
