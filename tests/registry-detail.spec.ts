import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import sharp from "sharp";

const pluginPath = "/plugins/ai/";

test("desktop carousel, health segments, and install geometry match the registry contract", async ({
  page,
}) => {
  await page.goto(pluginPath);

  await expect(
    page.locator(".plugin-identity--hero svg.lucide-presentation"),
  ).toHaveCount(1);

  const gallery = page.locator("[data-plugin-gallery]");
  const track = page.locator("[data-gallery-track]");
  const cards = page.locator("[data-gallery-card]");
  await expect(gallery).toBeVisible();
  await expect(cards).toHaveCount(3);

  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      "[data-gallery-track]",
    )!;
    const items = [
      ...document.querySelectorAll<HTMLElement>("[data-gallery-card]"),
    ];
    const trackBox = viewport.getBoundingClientRect();
    const first = items[0].getBoundingClientRect();
    const second = items[1].getBoundingClientRect();
    const third = items[2].getBoundingClientRect();
    const previous = document.querySelector<HTMLElement>(
      "[data-gallery-previous]",
    )!;
    const next = document.querySelector<HTMLElement>("[data-gallery-next]")!;
    const previousStyle = getComputedStyle(previous);
    const nextStyle = getComputedStyle(next);
    const viewportStyle = getComputedStyle(viewport);
    const hero = document
      .querySelector<HTMLElement>(".plugin-detail-hero")!
      .getBoundingClientRect();
    return {
      trackWidth: trackBox.width,
      firstWidth: first.width,
      firstHeight: first.height,
      gap: second.left - first.right,
      paddingStart: Number.parseFloat(viewportStyle.paddingInlineStart),
      paddingEnd: Number.parseFloat(viewportStyle.paddingInlineEnd),
      firstInset: first.left - trackBox.left,
      secondInset: trackBox.right - second.right,
      visibleNext: trackBox.right - third.left,
      nextBeyondCurrent: next.getBoundingClientRect().left > second.right,
      nextInsideTrack: next.getBoundingClientRect().right <= trackBox.right,
      previousOpacity: previousStyle.opacity,
      previousPointerEvents: previousStyle.pointerEvents,
      nextOpacity: nextStyle.opacity,
      cardOpacities: items.map((item) => getComputedStyle(item).opacity),
      belowHero: trackBox.top >= hero.bottom,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      snap: getComputedStyle(viewport).scrollSnapType,
      cardRadius: getComputedStyle(items[0]).borderRadius,
      canvas: getComputedStyle(document.documentElement).backgroundColor,
    };
  });
  expect(geometry.firstWidth).toBeCloseTo(
    Math.min(
      556,
      (geometry.trackWidth - geometry.paddingStart - geometry.paddingEnd - 8) /
        2,
    ),
    0,
  );
  expect(geometry.firstHeight).toBeCloseTo((geometry.firstWidth * 2) / 3, 0);
  expect(geometry.gap).toBeCloseTo(8, 0);
  expect(geometry.paddingStart).toBeCloseTo(geometry.paddingEnd, 0);
  expect(geometry.firstInset).toBeCloseTo(geometry.paddingStart, 0);
  expect(geometry.secondInset).toBeCloseTo(geometry.paddingEnd, 0);
  expect(geometry.visibleNext).toBeGreaterThan(40);
  expect(geometry.visibleNext).toBeLessThan(geometry.paddingEnd);
  expect(geometry.nextBeyondCurrent).toBe(true);
  expect(geometry.nextInsideTrack).toBe(true);
  expect(geometry.previousOpacity).toBe("0");
  expect(geometry.previousPointerEvents).toBe("none");
  expect(geometry.nextOpacity).toBe("1");
  expect(geometry.cardOpacities).toEqual(["1", "1", "0.1"]);
  expect(geometry.belowHero).toBe(true);
  expect(geometry.overflow).toBe(0);
  expect(geometry.snap).toContain("mandatory");
  expect(geometry.cardRadius).toBe("8px");
  expect(geometry.canvas).toBe("rgb(15, 15, 15)");

  const previous = page
    .getByRole("button", {
      name: "Show previous screenshot",
    })
    .first();
  const next = page
    .getByRole("button", {
      name: "Show next screenshot",
    })
    .first();
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await next.click();
  await expect
    .poll(() => track.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(400);
  await expect(previous).toBeEnabled();
  await expect(next).toBeDisabled();
  await expect(next).toHaveCSS("opacity", "0");
  await expect(previous).toHaveCSS("opacity", "1");
  await expect(cards.nth(0)).toHaveCSS("opacity", "0.1");
  await expect(cards.nth(1)).toHaveCSS("opacity", "1");
  await expect(cards.nth(2)).toHaveCSS("opacity", "1");
  const endingGeometry = await page.evaluate(() => {
    const track = document
      .querySelector<HTMLElement>("[data-gallery-track]")!
      .getBoundingClientRect();
    const first = document
      .querySelectorAll<HTMLElement>("[data-gallery-card]")[0]
      .getBoundingClientRect();
    const previous = document
      .querySelector<HTMLElement>("[data-gallery-previous]")!
      .getBoundingClientRect();
    return {
      visiblePrevious: first.right - track.left,
      controlBeforeCurrent: previous.right < track.left + 80,
    };
  });
  expect(endingGeometry.visiblePrevious).toBeGreaterThan(40);
  expect(endingGeometry.controlBeforeCurrent).toBe(true);

  const previewDensity = await imageDensity(cards.first().locator("img"));
  expect(previewDensity.physicalWidth).toBeGreaterThanOrEqual(
    previewDensity.renderedWidth * previewDensity.devicePixelRatio,
  );

  const install = page.locator("[data-install-button]");
  const installGeometry = await install.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      height: box.height,
      radius: style.borderRadius,
      padding: style.padding,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      color: style.color,
    };
  });
  expect(installGeometry).toEqual({
    height: 44,
    radius: "8px",
    padding: "12px 24px",
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "500",
    color: "rgb(255, 255, 255)",
  });
  await expect(install).toBeDisabled();

  const healthBars = page.getByRole("progressbar");
  await expect(healthBars).toHaveCount(2);
  await expect(healthBars.nth(0)).toHaveAttribute("aria-valuenow", "4");
  await expect(healthBars.nth(1)).toHaveAttribute("aria-valuenow", "1");
  expect(await segmentState(healthBars.nth(0))).toEqual({
    count: 4,
    active: 4,
  });
  expect(await segmentState(healthBars.nth(1))).toEqual({
    count: 4,
    active: 1,
  });
  expect(await segmentColors(healthBars.nth(0))).toEqual([
    "rgb(52, 211, 153)",
    "rgb(52, 211, 153)",
    "rgb(52, 211, 153)",
    "rgb(52, 211, 153)",
  ]);
  expect(await segmentColors(healthBars.nth(1))).toEqual([
    "rgb(138, 92, 245)",
    "rgb(54, 54, 54)",
    "rgb(54, 54, 54)",
    "rgb(54, 54, 54)",
  ]);
});

test("detail content, actions, and collapsed overview follow the reference layout", async ({
  page,
}) => {
  await page.goto(pluginPath);

  const searchInput = page.getByRole("searchbox", { name: "Search plugins" });
  const searchForm = page.getByRole("search");
  expect(
    await searchForm.evaluate((node) => {
      const style = getComputedStyle(node);
      const input = node.querySelector<HTMLInputElement>("input")!;
      const inputStyle = getComputedStyle(input);
      const box = node.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        radius: style.borderRadius,
        background: style.backgroundColor,
        boxShadow: style.boxShadow,
        inputBackground: inputStyle.backgroundColor,
        inputBorder: inputStyle.border,
        inputColor: inputStyle.color,
        inputFontSize: inputStyle.fontSize,
        inputLineHeight: inputStyle.lineHeight,
      };
    }),
  ).toEqual({
    width: 525,
    height: 40,
    radius: "999px",
    background: "rgb(38, 38, 38)",
    boxShadow: "none",
    inputBackground: "rgba(0, 0, 0, 0)",
    inputBorder: "0px none rgb(255, 255, 255)",
    inputColor: "rgb(255, 255, 255)",
    inputFontSize: "14px",
    inputLineHeight: "20px",
  });
  await searchInput.focus();
  await expect(searchForm).toHaveCSS(
    "box-shadow",
    "rgb(115, 115, 115) 0px 0px 0px 2px",
  );
  await expect(searchInput).toHaveCSS("outline-style", "none");
  await searchInput.press("Escape");
  await expect(searchInput).not.toBeFocused();

  await expect(page.getByText("Registry health", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".breadcrumbs")).toHaveCount(0);

  const heroGeometry = await page.evaluate(() => {
    const identity = document
      .querySelector<HTMLElement>(".plugin-identity--hero")!
      .getBoundingClientRect();
    const heading = document
      .querySelector<HTMLElement>(".plugin-title h1")!
      .getBoundingClientRect();
    const description = document
      .querySelector<HTMLElement>(".plugin-description")!
      .getBoundingClientRect();
    const actions = document
      .querySelector<HTMLElement>(".detail-actions")!
      .getBoundingClientRect();
    const headingStyle = getComputedStyle(
      document.querySelector<HTMLElement>(".plugin-title h1")!,
    );
    return {
      identitySize: [identity.width, identity.height],
      identityRadius: getComputedStyle(
        document.querySelector<HTMLElement>(".plugin-identity--hero")!,
      ).borderRadius,
      headingSize: headingStyle.fontSize,
      headingLineHeight: headingStyle.lineHeight,
      headingInset: heading.left - identity.right,
      descriptionAligned: description.left - identity.left,
      actionsAligned: actions.left - identity.left,
    };
  });
  expect(heroGeometry).toEqual({
    identitySize: [80, 80],
    identityRadius: "16px",
    headingSize: "36px",
    headingLineHeight: "40px",
    headingInset: 24,
    descriptionAligned: 0,
    actionsAligned: 0,
  });

  const actionsTrigger = page.getByRole("button", { name: "More actions" });
  expect(
    await actionsTrigger.evaluate((node) => {
      const button = node.getBoundingClientRect();
      const icon = node.querySelector("svg")!.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        height: button.height,
        width: button.width,
        radius: style.borderRadius,
        iconOffsetX:
          icon.left + icon.width / 2 - (button.left + button.width / 2),
        iconOffsetY:
          icon.top + icon.height / 2 - (button.top + button.height / 2),
      };
    }),
  ).toEqual({
    height: 44,
    width: 48,
    radius: "8px",
    iconOffsetX: 0,
    iconOffsetY: 0,
  });

  await actionsTrigger.click();
  const actionMenu = page.getByRole("menu", { name: "AI actions" });
  await expect(actionMenu).toBeVisible();
  await expect(actionsTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    actionMenu.getByRole("menuitem", { name: "View repository" }),
  ).toBeVisible();
  await expect(
    actionMenu.getByRole("menuitem", { name: "Homepage" }),
  ).toBeVisible();
  await expect(
    actionMenu.getByRole("menuitem", { name: "Report bug" }),
  ).toBeVisible();
  await expect(
    actionMenu.getByRole("menuitem", { name: "Request feature" }),
  ).toBeVisible();
  await expect(
    actionMenu.getByRole("menuitem", { name: "Report plugin" }),
  ).toBeVisible();
  await expect(
    actionMenu.getByRole("menuitem", { name: "Bundle pending" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.locator('.detail-metadata dt:text-is("Links")'),
  ).toHaveCount(0);
  await actionsTrigger.press("Escape");
  await expect(actionMenu).not.toBeVisible();
  await expect(actionsTrigger).toBeFocused();

  const sidebar = page.locator(".detail-sidebar");
  const details = page.locator('section[aria-label="Plugin details"]');
  const detailsHeading = details.getByRole("heading", { name: "Details" });
  expect(
    await details.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      backgroundImage: getComputedStyle(node).backgroundImage,
    })),
  ).toEqual({
    background: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
  });
  await expect(sidebar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(
    await detailsHeading.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        borderBottom: style.borderBottom,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        paddingBottom: style.paddingBottom,
      };
    }),
  ).toEqual({
    borderBottom: "1px solid rgb(38, 38, 38)",
    color: "rgb(179, 179, 179)",
    fontSize: "14px",
    fontWeight: "500",
    paddingBottom: "12px",
  });
  const metadataGeometry = await details.locator("dl").evaluate((node) => {
    const firstRow = node.children[0];
    const label = firstRow.querySelector("dt")!.getBoundingClientRect();
    const value = firstRow.querySelector("dd")!.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      columns: style.gridTemplateColumns.split(" ").length,
      rowAligned: label.top === value.top,
      rowDisplay: getComputedStyle(firstRow).display,
    };
  });
  expect(metadataGeometry).toEqual({
    columns: 2,
    rowAligned: true,
    rowDisplay: "contents",
  });

  const overviewPanel = page.locator('[data-panel="overview"]');
  expect(
    await overviewPanel.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        radius: style.borderRadius,
        background: style.backgroundColor,
      };
    }),
  ).toEqual({ radius: "16px", background: "rgb(30, 30, 30)" });
  const overviewContent = page.locator("[data-overview-content]");
  const overviewToggle = page.locator("[data-overview-toggle]");
  await expect(overviewToggle).toHaveAccessibleName("Show more");
  await expect(overviewToggle).toBeVisible();
  await expect(page.locator(".overview-collapse__fade")).toBeVisible();
  expect(
    await overviewContent.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    })),
  ).toMatchObject({ clientHeight: 360 });
  expect(
    await overviewContent.evaluate((node) => node.scrollHeight),
  ).toBeGreaterThan(360);
  await overviewToggle.click();
  await expect(overviewToggle).toHaveText("Show less");
  await expect(overviewToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".overview-collapse__fade")).not.toBeVisible();
  expect(await overviewContent.evaluate((node) => node.clientHeight)).toBe(
    await overviewContent.evaluate((node) => node.scrollHeight),
  );

  const releasesTab = page.getByRole("tab", { name: /Releases/ });
  const releaseCount = releasesTab.locator(".tab-count");
  expect(
    await releaseCount.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        radius: style.borderRadius,
        background: style.backgroundColor,
        padding: style.padding,
      };
    }),
  ).toEqual({
    radius: "999px",
    background: "rgb(38, 38, 38)",
    padding: "2px 6px",
  });
  await releasesTab.click();
  await expect(releasesTab).toHaveAttribute("aria-selected", "true");
  const releaseChip = page.locator(".release-status").first();
  await expect(releaseChip).toBeVisible();
  await expect(releaseChip).toHaveCSS("border-radius", "999px");

  const relatedHeading = page.locator(".related-section h2");
  const relatedItem = page.locator(".related-item").first();
  await expect(relatedItem).toBeVisible();
  expect(
    await relatedHeading.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        marginBottom: style.marginBottom,
        paddingBottom: style.paddingBottom,
      };
    }),
  ).toEqual({
    fontSize: "24px",
    lineHeight: "32px",
    fontWeight: "600",
    marginBottom: "12px",
    paddingBottom: "12px",
  });
  expect(
    await page.locator(".related-list").evaluate((node) => ({
      columns: getComputedStyle(node).gridTemplateColumns.split(" ").length,
      gap: getComputedStyle(node).columnGap,
    })),
  ).toEqual({ columns: 3, gap: "32px" });
  expect(
    await relatedItem.evaluate((node) => {
      const itemStyle = getComputedStyle(node);
      const icon = node.querySelector<HTMLElement>(".plugin-identity")!;
      const title = node.querySelector<HTMLElement>(".related-item__title")!;
      const description = node.querySelector<HTMLElement>(
        ".related-item__description",
      )!;
      const iconBox = icon.getBoundingClientRect();
      return {
        itemRadius: itemStyle.borderRadius,
        itemPadding: itemStyle.padding,
        iconSize: [iconBox.width, iconBox.height],
        iconRadius: getComputedStyle(icon).borderRadius,
        titleFont: [
          getComputedStyle(title).fontSize,
          getComputedStyle(title).lineHeight,
          getComputedStyle(title).fontWeight,
        ],
        descriptionFont: [
          getComputedStyle(description).fontSize,
          getComputedStyle(description).lineHeight,
        ],
      };
    }),
  ).toEqual({
    itemRadius: "12px",
    itemPadding: "8px 0px 0px",
    iconSize: [48, 48],
    iconRadius: "12px",
    titleFont: ["16px", "24px", "500"],
    descriptionFont: ["12px", "16px"],
  });

  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  const breadcrumbCurrent = breadcrumb.locator('[aria-current="page"]');
  await expect(breadcrumb.getByRole("link", { name: "Lapis" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(
    breadcrumb.getByRole("link", { name: "Plugins" }),
  ).toHaveAttribute("href", "/plugins/");
  await expect(
    breadcrumb.getByRole("link", { name: "Productivity" }),
  ).toHaveAttribute("href", "/plugins/?categories=productivity");
  await expect(breadcrumb.locator("svg")).toHaveCount(3);
  await expect(breadcrumbCurrent).toHaveAttribute("aria-current", "page");
  expect(
    await breadcrumb.evaluate((node) => {
      const container = node.parentElement!;
      const current = node.querySelector<HTMLElement>('[aria-current="page"]')!;
      const link = node.querySelector<HTMLAnchorElement>("a")!;
      const icon = node.querySelector<SVGElement>("svg")!;
      return {
        borderTop: getComputedStyle(container).borderTop,
        marginTop: getComputedStyle(container).marginTop,
        paddingTop: getComputedStyle(container).paddingTop,
        currentColor: getComputedStyle(current).color,
        currentFont: [
          getComputedStyle(current).fontSize,
          getComputedStyle(current).lineHeight,
          getComputedStyle(current).fontWeight,
        ],
        linkColor: getComputedStyle(link).color,
        iconSize: [
          icon.getBoundingClientRect().width,
          icon.getBoundingClientRect().height,
        ],
      };
    }),
  ).toEqual({
    borderTop: "1px solid rgb(38, 38, 38)",
    marginTop: "32px",
    paddingTop: "16px",
    currentColor: "rgb(188, 188, 188)",
    currentFont: ["16px", "24px", "500"],
    linkColor: "rgb(229, 229, 229)",
    iconSize: [16, 16],
  });

  const footerHeading = page.locator(".site-footer__directory h2").first();
  const footerLink = page.locator(".site-footer__directory a").first();
  expect(
    await footerHeading.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        color: style.color,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
      };
    }),
  ).toEqual({
    color: "rgb(163, 163, 163)",
    fontSize: "16px",
    lineHeight: "20px",
    fontWeight: "400",
  });
  expect(
    await footerLink.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        color: style.color,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
      };
    }),
  ).toEqual({
    color: "rgb(238, 238, 238)",
    fontSize: "16px",
    lineHeight: "20px",
    fontWeight: "500",
  });
});

test("fullscreen viewer opens at the selected image and restores focus", async ({
  page,
}) => {
  await page.goto(pluginPath);

  const selectedCard = page.locator("[data-gallery-card]").nth(1);
  await selectedCard.click();

  const dialog = page.getByRole("dialog", {
    name: "AI screenshot viewer",
  });
  const dialogTrack = page.locator("[data-dialog-track]");
  const close = page.getByRole("button", {
    name: "Close screenshot viewer",
  });
  await expect(dialog).toBeVisible();
  await expect(page.locator("[data-dialog-counter]")).toHaveCount(0);
  await expect.poll(() => snappedIndex(dialogTrack)).toBe(1);
  await expect(close).toBeFocused();
  expect(
    await dialog.evaluate((node) => ({
      surface: getComputedStyle(node).backgroundColor,
      mask: getComputedStyle(node, "::backdrop").backgroundColor,
      imageRadius: getComputedStyle(
        node.querySelector<HTMLImageElement>("[data-dialog-slide] img")!,
      ).borderRadius,
    })),
  ).toEqual({
    surface: "rgb(0, 0, 0)",
    mask: "rgb(0, 0, 0)",
    imageRadius: "0px",
  });

  const fullDensity = await imageDensity(
    page.locator("[data-dialog-slide] img").nth(1),
  );
  expect(fullDensity.physicalWidth).toBeGreaterThanOrEqual(
    fullDensity.renderedWidth * fullDensity.devicePixelRatio,
  );

  await close.press("ArrowRight");
  await expect.poll(() => snappedIndex(dialogTrack)).toBe(2);
  await expect(
    page.getByRole("button", { name: "Show next screenshot" }).last(),
  ).toBeDisabled();
  await close.press("Home");
  await expect.poll(() => snappedIndex(dialogTrack)).toBe(0);
  await expect(
    page.getByRole("button", { name: "Show previous screenshot" }).last(),
  ).toBeDisabled();
  await close.press("End");
  await expect.poll(() => snappedIndex(dialogTrack)).toBe(2);
  await close.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(selectedCard).toBeFocused();

  await selectedCard.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).not.toBeVisible();
  await expect(selectedCard).toBeFocused();
});

test("local source media refreshes without restarting the dev server", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.LAPIS_REGISTRY_TEST_BASE_URL),
    "Live source mutation requires the repository-owned browser fixture.",
  );

  const previewPath = path.join(
    process.cwd(),
    "tmp",
    "browser-source",
    "packages",
    "ai",
    "registry-assets",
    "gallery",
    "conversation.preview.webp",
  );
  const originalBytes = await readFile(previewPath);
  const originalDigest = digest(originalBytes);
  const updatedBytes = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 4,
      background: "#0891B2",
    },
  })
    .webp({ lossless: true })
    .toBuffer();
  const updatedDigest = digest(updatedBytes);

  await page.goto(pluginPath);
  const preview = page.locator("[data-gallery-card] img").first();
  await expect(preview).toHaveAttribute("srcset", new RegExp(originalDigest));

  try {
    await writeFile(previewPath, updatedBytes);
    await expect
      .poll(
        async () => {
          await page.reload();
          return preview.getAttribute("srcset");
        },
        { timeout: 15_000 },
      )
      .toContain(updatedDigest);

    const previewUrl = previewVariantUrl(await preview.getAttribute("srcset"));
    const response = await page.request.get(previewUrl);
    expect(response.ok()).toBe(true);
    expect(await response.body()).toEqual(updatedBytes);
  } finally {
    await writeFile(previewPath, originalBytes);
    await expect
      .poll(
        async () => {
          await page.reload();
          return preview.getAttribute("srcset");
        },
        { timeout: 15_000 },
      )
      .toContain(originalDigest);
  }
});

test.describe("mobile touch layout", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  test("shows a partial next card and keeps native swipe/snap navigation", async ({
    page,
  }) => {
    await page.goto(pluginPath);

    const track = page.locator("[data-gallery-track]");
    const cards = page.locator("[data-gallery-card]");
    await expect(cards.nth(1)).toHaveCSS("opacity", "0.1");
    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>(
        "[data-gallery-track]",
      )!;
      const items = [
        ...document.querySelectorAll<HTMLElement>("[data-gallery-card]"),
      ];
      const trackBox = viewport.getBoundingClientRect();
      const first = items[0].getBoundingClientRect();
      const second = items[1].getBoundingClientRect();
      const style = getComputedStyle(viewport);
      return {
        trackWidth: trackBox.width,
        cardWidth: first.width,
        paddingStart: Number.parseFloat(style.paddingInlineStart),
        paddingEnd: Number.parseFloat(style.paddingInlineEnd),
        visibleNext: trackBox.right - second.left,
        cardOpacities: items
          .slice(0, 2)
          .map((item) => getComputedStyle(item).opacity),
        snap: style.scrollSnapType,
        touchAction: style.touchAction,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
    expect(geometry.cardWidth).toBeCloseTo(
      geometry.trackWidth - geometry.paddingStart - geometry.paddingEnd - 48,
      0,
    );
    expect(geometry.visibleNext).toBeGreaterThan(48);
    expect(geometry.visibleNext).toBeLessThan(72);
    expect(geometry.cardOpacities).toEqual(["1", "0.1"]);
    expect(geometry.snap).toContain("mandatory");
    expect(geometry.touchAction).toContain("pan-x");
    expect(geometry.overflow).toBe(0);

    await expect(
      page.getByRole("button", { name: "Show next screenshot" }).first(),
    ).not.toBeVisible();
    await cards.nth(1).evaluate((node) =>
      node.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "start",
      }),
    );
    await expect
      .poll(() => track.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(250);

    const previewDensity = await imageDensity(cards.nth(1).locator("img"));
    expect(previewDensity.physicalWidth).toBeGreaterThanOrEqual(
      previewDensity.renderedWidth * previewDensity.devicePixelRatio,
    );

    await cards.nth(1).click();
    const dialog = page.getByRole("dialog", {
      name: "AI screenshot viewer",
    });
    const dialogTrack = page.locator("[data-dialog-track]");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Show next screenshot" }).last(),
    ).not.toBeVisible();
    await expect(dialogTrack).toHaveCSS("scroll-snap-type", /mandatory/);
    await expect(dialogTrack).toHaveCSS("touch-action", /pan-x/);

    await dialogTrack.evaluate((node) =>
      node.scrollTo({ left: node.clientWidth * 2, behavior: "auto" }),
    );
    await expect(page.locator("[data-dialog-counter]")).toHaveCount(0);
    await expect.poll(() => snappedIndex(dialogTrack)).toBe(2);

    const fullDensity = await imageDensity(
      page.locator("[data-dialog-slide] img").nth(2),
    );
    expect(fullDensity.physicalWidth).toBeGreaterThanOrEqual(
      fullDensity.renderedWidth * fullDensity.devicePixelRatio,
    );
  });
});

async function imageDensity(locator: Locator) {
  return locator.evaluate(async (node) => {
    const image = node as HTMLImageElement;
    await image.decode();
    const response = await fetch(image.currentSrc);
    const bitmap = await createImageBitmap(await response.blob());
    const value = {
      physicalWidth: bitmap.width,
      renderedWidth: image.getBoundingClientRect().width,
      devicePixelRatio: window.devicePixelRatio,
      source: image.currentSrc,
    };
    bitmap.close();
    return value;
  });
}

async function segmentState(locator: Locator) {
  return locator.evaluate((node) => ({
    count: node.children.length,
    active: [...node.children].filter(
      (segment) => segment.getAttribute("data-active") === "true",
    ).length,
  }));
}

async function segmentColors(locator: Locator) {
  return locator.evaluate((node) =>
    [...node.children].map(
      (segment) => getComputedStyle(segment).backgroundColor,
    ),
  );
}

async function snappedIndex(viewport: Locator) {
  return viewport.evaluate((node) => {
    const track = node as HTMLElement;
    const slides = [
      ...track.querySelectorAll<HTMLElement>("[data-dialog-slide]"),
    ];
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (const [index, slide] of slides.entries()) {
      const candidate = Math.abs(slide.offsetLeft - track.scrollLeft);
      if (candidate < distance) {
        closest = index;
        distance = candidate;
      }
    }
    return closest;
  });
}

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function previewVariantUrl(srcset: string | null) {
  if (!srcset) throw new Error("Expected gallery image srcset.");
  return srcset.split(",", 1)[0].trim().split(/\s+/, 1)[0];
}
