import { describe, expect, it } from "vite-plus/test";
import { guessKind } from "./files";

describe("a document's kind", () => {
  it("comes from its file name, or the picker when the name says nothing", () => {
    expect(guessKind("passport-scan.pdf", "cv")).toBe("passport");
    expect(guessKind("Siam_CV_2026.pdf", "other")).toBe("cv");
    expect(guessKind("ielts-booking.pdf", "other")).toBe("test");
    expect(guessKind("transcript.pdf", "cv")).toBe("transcript");
    expect(guessKind("scan-0042.pdf", "certificate")).toBe("certificate");
  });
});
