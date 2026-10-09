import { describe, expect, it } from "vite-plus/test";
import { prospectivePage, readContactRule } from "./contact-page.ts";

const today = new Date("2026-10-09T12:00:00Z");
const read = (html: string) =>
  readContactRule([{ url: "https://cs.example.edu/~ada/", html }], today);

describe("a professor's page about prospective students", () => {
  it("quotes a not-taking statement with its year, dated", () => {
    const r = read(`
      <h2>Prospective students</h2>
      <p>I am not taking new PhD students until Fall 2028. I am on sabbatical this year.</p>`);
    expect(r).toMatchObject({
      taking: "no",
      statements: ["I am not taking new PhD students until Fall 2028."],
      readOn: "2026-10-09",
      urls: ["https://cs.example.edu/~ada/"],
    });
  });

  it("reads the subject words, the CV ask and a yes", () => {
    const r = read(`
      <div><p>I am recruiting PhD students for Fall 2027.</p>
      <p>If you email me, put &quot;PhD 2027&quot; in the subject line and attach your CV and transcript.</p></div>`);
    expect(r.taking).toBe("yes");
    expect(r.subject).toBe("PhD 2027");
    expect(r.cv).toContain("attach your CV");
    expect(r.noEmail).toBeNull();
  });

  it("finds a form, don't-email and apply-first", () => {
    const r = read(`
      <p>Prospective students: please do not email me about admissions.
      Apply to the PhD program first and mention my name in your statement.</p>
      <p>Fill out <a href="https://forms.gle/abc123">this form</a> instead.</p>`);
    // A contact rule is not a taking statement.
    expect(r.taking).toBeNull();
    expect(r.form).toBe("https://forms.gle/abc123");
    expect(r.noEmail).toContain("please do not email me");
    expect(r.applyFirst).toContain("Apply to the PhD program first");
  });

  it("hears a no inside a don't-email line", () => {
    const r = read(
      "<p>I am not accepting new students, so please do not email me about openings.</p>",
    );
    expect(r.taking).toBe("no");
    expect(r.noEmail).toContain("please do not email me");
  });

  it("says nothing when the page says nothing", () => {
    const r = read(
      "<p>My research is on retrieval for clinical notes. Current projects address clinical trial recruitment and student retention.</p>",
    );
    expect(r).toMatchObject({ taking: null, statements: [], subject: null, form: null });
  });

  it("follows the homepage's link to its prospective-students page on the same site", () => {
    const html = `<a href="https://twitter.com/ada">Join me on X</a>
      <a href="/~ada/publications">Papers</a>
      <a href="/~ada/prospective.html">Prospective students</a>`;
    expect(prospectivePage(html, "https://cs.example.edu/~ada/")).toBe(
      "https://cs.example.edu/~ada/prospective.html",
    );
    expect(prospectivePage("<a href='/x'>Papers</a>", "https://cs.example.edu/")).toBeNull();
  });
});
