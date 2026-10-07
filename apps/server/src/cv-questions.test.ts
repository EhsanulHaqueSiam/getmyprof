import { describe, expect, it } from "vite-plus/test";
import { answerCvQuestion, askCvQuestions } from "./cv-questions.ts";
import { openDb } from "./db.ts";
import { getFacts, saveFacts } from "./state.ts";
import { getThread, listEvents } from "./threads.ts";

const fact = (id: string, text: string, question: boolean) => ({
  id,
  text,
  source: "cv.pdf",
  kind: "other" as const,
  date: "",
  confirmed: false,
  question,
  planned: false,
});

describe("questions from a CV", () => {
  it("wait in Input, once each, and a reply turns the oldest into a fact", () => {
    const db = openDb(":memory:");
    saveFacts(db, [
      fact("f1", "BSc Computer Science 2025", false),
      fact("f2", "IELTS score?", true),
    ]);
    const thread = askCvQuestions(db);
    if (!thread) throw new Error("no thread");
    expect(askCvQuestions(db)).toBe(thread);
    expect(getThread(db, thread)?.status).toBe("input");
    expect(listEvents(db, thread).filter((e) => e.type === "question")).toHaveLength(1);

    expect(answerCvQuestion(db, "another-thread", "7.5")).toBeNull();
    expect(answerCvQuestion(db, thread, "7.5 overall, May 2026")).not.toBeNull();
    expect(getFacts(db).find((f) => f.id === "f2")).toMatchObject({
      text: "IELTS score? 7.5 overall, May 2026",
      question: false,
      confirmed: false,
    });
    expect(getThread(db, thread)?.status).toBe("idle");
  });
});
