import { expect, test, type Locator } from "@playwright/test";

const pluginPath = "/plugins/ai/";

test("desktop carousel, health segments, and install geometry match the registry contract", async ({
  page,
}) => {
  await page.goto(pluginPath);

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
    };
  });
  expect(installGeometry).toEqual({
    height: 44,
    radius: "8px",
    padding: "12px 24px",
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "500",
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
