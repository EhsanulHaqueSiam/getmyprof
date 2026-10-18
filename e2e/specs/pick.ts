import type { Locator, Page } from "@playwright/test";

/** Picks an option in a kit Select: the trigger is a combobox button, the options a popup list. */
export async function pick(scope: Page | Locator, label: string, option: string) {
  await scope.getByRole("combobox", { name: label }).click();
  const page = "page" in scope ? scope.page() : scope;
  await page.getByRole("option", { name: option, exact: true }).click();
}
