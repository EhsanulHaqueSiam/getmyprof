import type { DocKind } from "@gradcode/contracts";

/** A file's bytes as base64, for upload over the socket. */
export const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.addEventListener("load", () => resolve(String(r.result).split(",")[1] ?? ""));
    r.addEventListener("error", () => reject(r.error));
    r.readAsDataURL(file);
  });

/** A document's kind from its file name, e.g. "passport-scan.pdf"; `fallback` when it says nothing. */
export function guessKind(name: string, fallback: DocKind): DocKind {
  const n = name.toLowerCase();
  if (/passport/.test(n)) return "passport";
  if (/transcript|marksheet|grade/.test(n)) return "transcript";
  if (/\b(cv|resume|résumé)\b|[-_](cv|resume)[-_.]/.test(n)) return "cv";
  if (/ielts|toefl|gre|duolingo|pte|score/.test(n)) return "test";
  if (/letter|recommend|lor/.test(n)) return "letter";
  if (/certificate|moi/.test(n)) return "certificate";
  return fallback;
}

/** Saves bytes or text as a file in the browser's downloads. */
export function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href));
}
