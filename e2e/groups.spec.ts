import { expect, test, type Page } from "@playwright/test";
import { clickOutsideToCommit, editNode, loginAndOpenEditor, setSelection } from "./helpers.ts";

async function openGroupInspector(page: Page): Promise<void> {
  await page.locator("#xyle-structure-shortcut").click();
  const collapsed = page.locator('.xyle-outline-disclosure:not(:disabled)[aria-expanded="false"]');
  while ((await collapsed.count()) > 0) await collapsed.first().click();
  await page.locator(".xyle-outline-group-summary").click();
  await expect(page.locator(".xyle-outline-group-inspector")).toBeVisible();
}

test("discovers and duplicates a source-backed Group item through the human UI", async ({
  page,
}) => {
  await loginAndOpenEditor(page, "/groups.html");
  const preview = page.frameLocator("#xyle-preview");
  const group = preview.locator("[data-xyle-group]");
  const items = preview.locator("[data-xyle-group-item]");
  await expect(group).toHaveCount(1);
  await expect(items).toHaveCount(2);

  const firstItemId = await items.first().getAttribute("data-xyle-group-item");
  expect(firstItemId).toBeTruthy();
  await openGroupInspector(page);
  await page
    .locator(".xyle-outline-group-inspector button", { hasText: "Duplicate item" })
    .first()
    .click();
  await expect(items).toHaveCount(3, { timeout: 10_000 });

  const createdId = await page.evaluate((sourceId) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return [...doc.querySelectorAll<HTMLElement>("[data-xyle-group-item]")]
      .map((item) => item.dataset.xyleGroupItem)
      .find((id) => id && id !== sourceId);
  }, firstItemId);
  expect(createdId).toMatch(/^x-[a-f0-9]{16}$/);

  const referenceState = await page.evaluate((itemId) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    const source = doc.querySelector<HTMLElement>("[data-xyle-group-item]")!;
    const clone = doc.querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)!;
    const ids = [...clone.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id);
    const panel = clone.querySelector<HTMLElement>(".reference-fixture [aria-labelledby]")!;
    const label = clone.querySelector<HTMLElement>("label")!;
    const href = clone.querySelector<HTMLAnchorElement>("a[href^='#']")!;
    return {
      ids,
      originalIds: [...source.querySelectorAll<HTMLElement>("[id]")].map((element) => element.id),
      sectionReference: doc.querySelector("main > section")?.getAttribute("aria-labelledby"),
      labelFor: label.getAttribute("for"),
      labelledBy: panel.getAttribute("aria-labelledby"),
      describedBy: panel.getAttribute("aria-describedby"),
      controls: panel.getAttribute("aria-controls"),
      owns: panel.getAttribute("aria-owns"),
      active: panel.getAttribute("aria-activedescendant"),
      form: panel.getAttribute("form"),
      list: panel.getAttribute("list"),
      headers: panel.getAttribute("headers"),
      href: href.getAttribute("href"),
    };
  }, createdId);
  expect(new Set(referenceState.ids).size).toBe(referenceState.ids.length);
  expect(referenceState.ids.some((id) => referenceState.originalIds.includes(id))).toBe(false);
  expect(referenceState.sectionReference).toBe("groups-title");
  expect(referenceState.labelFor).toMatch(/^#?x-/);
  expect(referenceState.labelledBy).not.toContain("service-a-title");
  expect(referenceState.describedBy).toMatch(/^x-/);
  expect(referenceState.controls).toMatch(/^x-/);
  expect(referenceState.owns).toMatch(/^x-/);
  expect(referenceState.active).toMatch(/^x-/);
  expect(referenceState.form).toMatch(/^x-/);
  expect(referenceState.list).toMatch(/^x-/);
  expect(referenceState.headers).toMatch(/^x-/);
  expect(referenceState.href).toMatch(/^#x-/);

  const originalTitleId = await page.evaluate(() => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return doc
      .querySelector<HTMLElement>("[data-xyle-group-item]")
      ?.querySelector<HTMLElement>("h2[data-xyle-node]")
      ?.getAttribute("data-xyle-node");
  });
  const titleId = await page.evaluate((itemId) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return doc
      .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
      ?.querySelector<HTMLElement>("h2[data-xyle-node]")
      ?.getAttribute("data-xyle-node");
  }, createdId);
  expect(titleId).toBeTruthy();
  const title = preview.locator(`[data-xyle-node="${titleId}"]`);
  await title.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await title.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("Duplicated service");
  await clickOutsideToCommit(page);
  await expect(title).toContainText("Duplicated service");
  expect(originalTitleId).toBeTruthy();
  await editNode(page, originalTitleId!);
  await setSelection(page, { nodeId: originalTitleId!, selectAll: true });
  await page.keyboard.insertText("Original service");
  await clickOutsideToCommit(page);
  await expect(preview.locator(`[data-xyle-node="${originalTitleId}"]`)).toContainText(
    "Original service",
  );

  await page.locator("#xyle-changes").click();
  const groupChange = page.locator('.xyle-change-row[aria-label*="Duplicate Group item"]').first();
  await expect(groupChange.locator(".xyle-change-type")).toHaveText("Group item");
  await expect(groupChange).toContainText("Duplicated “Leaks”");
  await expect(groupChange).not.toContainText("service-a");
  await page.locator("#xyle-changes-close").click();

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  expect((await publishResponse).ok()).toBe(true);
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  await page.goto("/groups.html");
  await expect(page.locator("article")).toHaveCount(3);
  await expect(page.getByText("Duplicated service")).toHaveCount(1);
  await expect(page.getByText("Original service")).toHaveCount(1);
  expect(await page.locator("[data-xyle-node]").count()).toBe(0);
  const publishedClone = page.locator("article").nth(1);
  const publishedPanel = publishedClone.locator(".reference-fixture [aria-labelledby]");
  await expect(publishedPanel).toHaveAttribute("aria-describedby", /^x-/);
  await expect(publishedPanel).toHaveAttribute("aria-controls", /^x-/);
  await expect(publishedPanel.locator("xpath=..")).toContainText("Repair details");
});

test("publishes area deletion after duplicating a draft-only Group item", async ({ page }) => {
  await loginAndOpenEditor(page, "/groups.html");
  await openGroupInspector(page);
  await page
    .locator(".xyle-outline-group-inspector button", { hasText: "Duplicate item" })
    .first()
    .click();
  await expect(page.frameLocator("#xyle-preview").locator("[data-xyle-group-item]")).toHaveCount(3);

  const sectionRow = page.getByRole("dialog", { name: "Outline" }).locator(".xyle-outline-node");
  await sectionRow.locator(".xyle-outline-menu-trigger").click();
  await sectionRow.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  expect((await publishResponse).ok()).toBe(true);
  await expect(page.locator("#xyle-publish")).toContainText("Published", { timeout: 10_000 });
  const source = await (await page.request.get("/groups.html")).text();
  expect(source).not.toContain("<section");
  expect(source).not.toContain("data-xyle-group-item");
});

test("moves a source-backed Group item later through publication", async ({ page }) => {
  await loginAndOpenEditor(page, "/groups-move.html");
  const preview = page.frameLocator("#xyle-preview");
  const items = preview.locator("[data-xyle-group-item]");
  await expect(items).toHaveCount(2);
  await expect(items.first()).not.toHaveAttribute("data-xyle-keyboard-target", "");
  const firstItemId = await items.first().getAttribute("data-xyle-group-item");
  expect(firstItemId).toBeTruthy();
  await openGroupInspector(page);
  await page
    .locator(`[data-outline-group-item="${firstItemId}"][data-outline-group-action="later"]`)
    .click();
  await expect(
    page.locator(`[data-outline-group-item="${firstItemId}"][data-outline-group-action="earlier"]`),
  ).toBeFocused();
  await expect
    .poll(() => items.evaluateAll((elements) => elements.map((item) => item.textContent)))
    .toEqual([expect.stringContaining("Water heaters"), expect.stringContaining("Leaks")]);

  await page.locator("#xyle-changes").click();
  const change = page
    .getByRole("dialog", { name: "Changes" })
    .locator(".xyle-change-row")
    .filter({ hasText: "Moved" });
  await expect(change.locator(".xyle-change-after")).toContainText("Moved “Leaks” later");
  await page.locator("#xyle-changes-close").click();

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  expect((await publishResponse).ok()).toBe(true);
  await page.goto("/groups-move.html");
  await expect(page.locator("article h2").first()).toContainText("Water heaters");
  await expect(page.locator("article h2").nth(1)).toContainText("Leaks");
  expect(await page.locator("[data-xyle-node], [data-xyle-group-item]").count()).toBe(0);
});

test("moves an edited source-backed Group item through the human UI", async ({ page }) => {
  await loginAndOpenEditor(page, "/groups-move.html");
  const preview = page.frameLocator("#xyle-preview");
  const items = preview.locator("[data-xyle-group-item]");
  const sourceItemId = await items.nth(1).getAttribute("data-xyle-group-item");
  expect(sourceItemId).toBeTruthy();
  const titleId = await page.evaluate((itemId) => {
    const doc = (document.querySelector("#xyle-preview") as HTMLIFrameElement).contentDocument!;
    return doc
      .querySelector<HTMLElement>(`[data-xyle-group-item="${itemId}"]`)
      ?.querySelector<HTMLElement>("h2[data-xyle-node]")
      ?.getAttribute("data-xyle-node");
  }, sourceItemId);
  expect(titleId).toBeTruthy();
  await editNode(page, titleId!);
  await setSelection(page, { nodeId: titleId!, selectAll: true });
  await page.keyboard.insertText("Moved service");
  await clickOutsideToCommit(page);

  await openGroupInspector(page);
  await page.getByRole("button", { name: "Move earlier" }).nth(1).click();
  await expect
    .poll(() => items.evaluateAll((elements) => elements.map((item) => item.textContent)))
    .toEqual([expect.stringContaining("Moved service"), expect.stringContaining("Leaks")]);

  const publishResponse = page.waitForResponse((response) =>
    response.url().includes("/__xyle/api/publish"),
  );
  await page.locator("#xyle-publish").click();
  expect((await publishResponse).ok()).toBe(true);
  await page.goto("/groups-move.html");
  await expect(page.locator("article h2").first()).toContainText("Moved service");
});
