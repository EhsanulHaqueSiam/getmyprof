import { expect, test } from "@playwright/test";
import { FILL_FIELDS, READ_FIELDS } from "../../apps/desktop/src/portal-page.ts";

// A portal page the way they come: labels three ways, a select, a radio group, a checkbox to
// certify, a short answer, a file, a password, a hidden token and a Submit button.
const FORM = `
<form onsubmit="window.submitted = true; return false">
  <label for="fn">First name *</label><input id="fn" required>
  <label>Email <input type="email" name="email"></label>
  <input aria-label="Cumulative GPA" name="gpa">
  <label for="term">Term</label>
  <select id="term"><option value="">Choose</option><option value="f27">Fall 2027</option><option value="s28">Spring 2028</option></select>
  <fieldset><legend>Need funding?</legend>
    <label><input type="radio" name="fund" value="y">Yes</label>
    <label><input type="radio" name="fund" value="n">No</label>
  </fieldset>
  <label><input type="checkbox" name="agree"> I certify this is true</label>
  <label for="why">Why this program? (100 words)</label><textarea id="why"></textarea>
  <label for="cv">CV</label><input type="file" id="cv">
  <label for="pw">Password</label><input type="password" id="pw" value="secret">
  <input type="hidden" name="csrf" value="x">
  <button type="submit">Submit</button>
</form>`;

type Field = { key: string; label: string; kind: string; required: boolean; options: string[] };

test("the portal scripts read a form's fields and fill only what they're given", async ({
  page,
}) => {
  await page.setContent(FORM);
  const fields = await page.evaluate<Field[]>(READ_FIELDS);
  expect(fields.map((f) => [f.label, f.kind, f.required])).toEqual([
    ["First name", "text", true],
    ["Email", "email", false],
    ["Cumulative GPA", "text", false],
    ["Term", "select", false],
    ["Need funding?", "radio", false],
    ["I certify this is true", "checkbox", false],
    ["Why this program? (100 words)", "textarea", false],
    ["CV", "file", false],
    ["Password", "password", false],
  ]);
  expect(fields.find((f) => f.kind === "select")?.options).toEqual([
    "Choose",
    "Fall 2027",
    "Spring 2028",
  ]);
  // The password's value never leaves the page.
  expect(fields.find((f) => f.kind === "password")).toMatchObject({ value: "" });

  const key = (label: string) => fields.find((f) => f.label === label)?.key ?? "";
  const values = [
    { key: key("First name"), value: "Nadia" },
    { key: key("Cumulative GPA"), value: "3.62" },
    { key: key("Term"), value: "Fall 2027" },
    { key: key("Need funding?"), value: "Yes" },
    { key: key("Why this program? (100 words)"), value: "DF-RAG's diversity step." },
    { key: key("CV"), value: "cv.pdf" },
    { key: key("Password"), value: "guess" },
  ];
  const results = await page.evaluate<{ key: string; ok: boolean; note: string }[]>(
    `(${FILL_FIELDS})(${JSON.stringify(values)})`,
  );
  expect(results.map((r) => [r.ok, r.note])).toEqual([
    [true, ""],
    [true, ""],
    [true, ""],
    [true, ""],
    [true, ""],
    [false, "yours to do"],
    [false, "yours to do"],
  ]);
  await expect(page.locator("#fn")).toHaveValue("Nadia");
  await expect(page.locator('[name="gpa"]')).toHaveValue("3.62");
  await expect(page.locator("#term")).toHaveValue("f27");
  await expect(page.locator('input[value="y"]')).toBeChecked();
  await expect(page.locator("#why")).toHaveValue("DF-RAG's diversity step.");
  await expect(page.locator("#pw")).toHaveValue("secret");
  // Read again, a select reads as its option's text, so a filled one matches its answer.
  const again = await page.evaluate<(Field & { value: string })[]>(READ_FIELDS);
  expect(again.find((f) => f.label === "Term")?.value).toBe("Fall 2027");
  // Nothing it does submits the form or ticks a box it wasn't given.
  await expect(page.locator('[name="agree"]')).not.toBeChecked();
  expect(await page.evaluate(() => "submitted" in window)).toBe(false);
});
