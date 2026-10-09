// What the desktop app runs inside an application portal's page (main.ts, executeJavaScript):
// read its fields, and fill the ones the student approved. Plain JS strings, so no bundler can
// rewrite them into something that needs a helper the page doesn't have. e2e/specs/portal.spec.ts
// runs both on a real form. They never click a button, choose a file or type a password.

/**
 * Reads the visible fields as PortalField objects: a key to find each again (stamped on it as
 * data-gmp-key; a radio group's key is "radio:<name>"), its label, kind, whether it's required,
 * its options and its value.
 */
export const READ_FIELDS = String.raw`(() => {
  const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").replace(/\*\s*$/, "").trim() : "");
  const labelOf = (el) => {
    if (el.labels && el.labels.length) return text(el.labels[0]);
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) return by.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ").trim();
    return (el.getAttribute("placeholder") || el.name || el.id || "").trim();
  };
  const kinds = ["text","textarea","select","radio","checkbox","date","email","tel","number","url","file","password"];
  const out = [];
  const groups = new Set();
  let n = 0;
  for (const el of document.querySelectorAll("input, select, textarea")) {
    const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (el.getAttribute("type") || "text").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type) || el.disabled) continue;
    if (!el.getClientRects().length) continue;
    const required = el.required || el.getAttribute("aria-required") === "true";
    if (type === "radio") {
      if (!el.name || groups.has(el.name)) continue;
      groups.add(el.name);
      const radios = [...document.querySelectorAll('input[type="radio"]')].filter((r) => r.name === el.name);
      const legend = el.closest("fieldset") && el.closest("fieldset").querySelector("legend");
      const checked = radios.find((r) => r.checked);
      out.push({ key: "radio:" + el.name, label: legend ? text(legend) : el.name, kind: "radio", required, options: radios.map(labelOf), value: checked ? labelOf(checked) : "" });
      continue;
    }
    if (!el.dataset.gmpKey) el.dataset.gmpKey = "gmp-" + n++ + "-" + Date.now();
    out.push({
      key: el.dataset.gmpKey,
      label: labelOf(el),
      kind: kinds.includes(type) ? type : "text",
      required,
      options: type === "select" ? [...el.options].map((o) => o.text.trim()).filter(Boolean) : [],
      value: type === "checkbox" ? (el.checked ? "yes" : "") : type === "file" || type === "password" ? "" : el.value,
    });
  }
  return out;
})()`;

/**
 * A function that fills fields by key with the given values, the way typing would (the native
 * value setter, then input and change events, so framework forms see it), and says how each went.
 * Files and passwords are skipped; a select or radio takes the option whose text matches.
 */
export const FILL_FIELDS = String.raw`((values) => {
  const results = [];
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const near = (a, b) => a.trim().toLowerCase().includes(b.trim().toLowerCase());
  for (const { key, value } of values) {
    if (key.startsWith("radio:")) {
      const name = key.slice(6);
      const radios = [...document.querySelectorAll('input[type="radio"]')].filter((r) => r.name === name);
      const label = (r) => (r.labels && r.labels.length ? r.labels[0].textContent : r.value) || "";
      const pick = radios.find((r) => same(label(r), value) || same(r.value, value)) || radios.find((r) => near(label(r), value));
      if (pick) { pick.click(); results.push({ key, ok: true, note: "" }); }
      else results.push({ key, ok: false, note: "no choice matches" });
      continue;
    }
    const el = document.querySelector('[data-gmp-key="' + CSS.escape(key) + '"]');
    if (!el) { results.push({ key, ok: false, note: "gone from the page" }); continue; }
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "file" || type === "password") { results.push({ key, ok: false, note: "yours to do" }); continue; }
    if (el.readOnly || el.disabled) { results.push({ key, ok: false, note: "read-only" }); continue; }
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => same(o.text, value) || same(o.value, value)) || [...el.options].find((o) => near(o.text, value));
      if (!opt) { results.push({ key, ok: false, note: "no option matches" }); continue; }
      el.value = opt.value;
    } else if (type === "checkbox") {
      const want = /^(yes|true|1|on)$/i.test(value);
      if (el.checked !== want) el.click();
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur"));
    results.push({ key, ok: true, note: "" });
  }
  return results;
})`;
