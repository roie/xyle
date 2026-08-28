import { expect, test } from "@playwright/test";
import { editNode, findNodeByText, focusCaret, loginAndOpenEditor, opsCount } from "./helpers.ts";

test.describe("Xyle sign in", () => {
  test("is responsive and reports an associated accessible error", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/edit");

    await expect(page.getByRole("heading", { name: "Open your site editor" })).toBeVisible();
    await expect(page.getByText("Enter the editor key for this site")).toBeVisible();
    const input = page.getByLabel("Editor key");
    await expect(input).not.toBeFocused();
    await expect(input).toHaveAttribute("aria-describedby", /login-error/);
    const formBox = await page.locator("#login").boundingBox();
    expect(formBox).toBeTruthy();
    expect(formBox!.x).toBeGreaterThanOrEqual(0);
    expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(320);
    const viewportGeometry = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(viewportGeometry.scrollWidth).toBeLessThanOrEqual(viewportGeometry.viewportWidth);

    await page.getByRole("button", { name: "Sign in to Xyle" }).click();
    const error = page.locator("#login-error");
    await expect(error).toHaveText("Enter your editor key.");
    await expect(error).toHaveAttribute("aria-live", "polite");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();

    await input.fill("wrong-key");
    await expect(error).toBeEmpty();
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await page.getByRole("button", { name: "Sign in to Xyle" }).click();
    await expect(error).toHaveText("That editor key was not accepted.");
    await expect(input).toHaveAttribute("aria-invalid", "true");
  });

  test("keeps the form usable when the login service fails", async ({ page }) => {
    await page.goto("/edit");
    await page.route("**/__xyle/api/login", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    const input = page.getByLabel("Editor key");
    await input.fill("temporarily-unavailable");
    await page.getByRole("button", { name: "Sign in to Xyle" }).click();
    await expect(page.locator("#login-error")).toHaveText("Xyle could not sign you in. Try again.");
    await expect(input).toBeFocused();
    await expect(page.getByRole("button", { name: "Sign in to Xyle" })).toBeEnabled();
  });
});

test.describe("logout", () => {
  test("failed logout keeps the editor and draft open", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    const id = await findNodeByText(page, "Plumbing you can depend on");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" LOGOUT-DRAFT");
    await page
      .frameLocator("#xyle-preview")
      .locator("html")
      .click({ position: { x: 1, y: 1 } });
    await expect.poll(async () => opsCount(page)).toBe(1);

    let mutationHeader = "";
    await page.route("**/__xyle/api/logout", async (route) => {
      mutationHeader = route.request().headers()["x-xyle-request"] ?? "";
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    await page.click("#xyle-menu-btn");
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.click("#xyle-discard-confirmation [data-discard]");

    await expect(page.locator("#xyle-flash")).toContainText(
      "Could not log out. Your draft is still open.",
    );
    await expect(page).toHaveURL(/\/edit/);
    await expect.poll(async () => opsCount(page)).toBe(1);
    await expect(
      page.frameLocator("#xyle-preview").locator(`[data-xyle-node="${id}"]`),
    ).toContainText("LOGOUT-DRAFT");
    await expect(page.locator("#xyle-menu-btn")).toBeFocused();
    expect(mutationHeader).toBe("1");
  });

  test("canceling logout keeps the draft and returns focus to the menu button", async ({
    page,
  }) => {
    await loginAndOpenEditor(page, "/index.html");
    const id = await findNodeByText(page, "Plumbing you can depend on");
    await editNode(page, id!);
    await focusCaret(page, id!, "end");
    await page.keyboard.type(" KEEP-ME");
    await page
      .frameLocator("#xyle-preview")
      .locator("html")
      .click({ position: { x: 1, y: 1 } });
    await expect.poll(async () => opsCount(page)).toBe(1);

    await page.click("#xyle-menu-btn");
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.click("#xyle-discard-confirmation [data-keep]");

    await expect(page.locator("#xyle-menu-btn")).toBeFocused();
    await expect.poll(async () => opsCount(page)).toBe(1);
  });

  test("successful logout opens the sign-in experience", async ({ page }) => {
    await loginAndOpenEditor(page, "/index.html");
    await page.click("#xyle-menu-btn");
    await page.getByRole("menuitem", { name: "Log out" }).click();

    await expect(page).toHaveURL(/\/edit$/);
    await expect(page.getByRole("heading", { name: "Open your site editor" })).toBeVisible();
    await expect(page.locator("#xyle-preview")).toHaveCount(0);
  });
});
