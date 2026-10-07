// The Lifeline's panel: a fact's note (with an answer box for a question), your facts as a CV,
// and a preview of a file. VaultLifeline.tsx shows the line itself.
import { factStatus, type ProfileFact, type VaultDocument } from "@gradcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

export const KIND_LABEL = {
  education: "Education",
  paper: "Papers",
  work: "Roles",
  project: "Projects",
  test: "Tests",
  other: "Other",
} as const satisfies Record<ProfileFact["kind"], string>;

export const FACT_KINDS = ["education", "paper", "work", "project", "test", "other"] as const;

export const STATUS_TONE = {
  confirmed: "text-success-foreground",
  unconfirmed: "text-muted-foreground",
  "needs proof": "text-warning-foreground",
  planned: "text-status-input",
  question: "text-status-input",
} as const satisfies Record<ReturnType<typeof factStatus>, string>;

/** A fact's note: what it says, when, its proof, whether it's confirmed, and where it's used. */
export function FactNote(props: {
  fact: ProfileFact;
  proof: VaultDocument | null;
  usedIn: { writing: number; mail: number };
  readOnly: boolean;
  onPreview: () => void;
}) {
  const { fact, proof } = props;
  const facts = useStore((s) => s.app?.facts) ?? [];
  const status = factStatus(fact);
  return (
    <div className="flex flex-col gap-2" data-testid="fact-note">
      <div className="font-medium text-foreground text-sm">{fact.text}</div>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{KIND_LABEL[fact.kind]}</dd>
        <dt className="text-muted-foreground">When</dt>
        <dd>{fact.date || "undated"}</dd>
        <dt className="text-muted-foreground">Proof</dt>
        <dd className="break-words">
          {proof ? (
            <button
              type="button"
              className="text-info-foreground hover:underline"
              onClick={props.onPreview}
            >
              {proof.name}
            </button>
          ) : /^https?:\/\//.test(fact.source) ? (
            <a
              href={fact.source}
              target="_blank"
              rel="noreferrer"
              className="text-info-foreground hover:underline"
            >
              {fact.source}
            </a>
          ) : (
            fact.source || "none yet"
          )}
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className={STATUS_TONE[status]}>{status}</dd>
        <dt className="text-muted-foreground">Used in</dt>
        <dd>
          {[
            props.usedIn.writing
              ? `${props.usedIn.writing} piece${props.usedIn.writing === 1 ? "" : "s"}`
              : "",
            props.usedIn.mail
              ? `${props.usedIn.mail} email${props.usedIn.mail === 1 ? "" : "s"}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ") || "nothing yet"}
        </dd>
      </dl>
      {fact.question && !props.readOnly ? <AnswerBox fact={fact} /> : null}
      {props.readOnly || fact.question ? null : (
        <div>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void call("facts.save", {
                facts: facts.map((f) =>
                  f.id === fact.id ? { ...f, confirmed: !f.confirmed, question: false } : f,
                ),
              })
            }
          >
            {fact.confirmed ? "Unconfirm" : "Confirm"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A fact the reader couldn't prove asks you instead. Your answer replaces the question, with you
 * as its source, and waits for your confirm like any other fact.
 */
function AnswerBox({ fact }: { fact: ProfileFact }) {
  const facts = useStore((s) => s.app?.facts) ?? [];
  const [answer, setAnswer] = useState("");
  return (
    <form
      className="flex gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void call("facts.save", {
          facts: facts.map((f) =>
            f.id === fact.id
              ? {
                  ...f,
                  text: answer.trim(),
                  source: "your answer",
                  question: false,
                  confirmed: false,
                }
              : f,
          ),
        });
      }}
    >
      <Input
        size="compact"
        aria-label="Your answer"
        placeholder="Answer, e.g. IELTS Academic 7.5, taken 2025-08"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      <Button size="xs" type="submit" disabled={!answer.trim()}>
        Answer
      </Button>
    </form>
  );
}

const CV_HEADING = {
  education: "Education",
  paper: "Publications",
  work: "Experience",
  project: "Projects",
  test: "Tests",
  other: "Other",
} as const satisfies Record<ProfileFact["kind"], string>;

/** Your facts laid out like a CV, each with its status, and a button to write one from them. */
export function CvView({ facts }: { facts: ProfileFact[] }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-2" data-testid="cv-view">
      {FACT_KINDS.map((kind) => {
        const here = facts.filter((f) => f.kind === kind);
        if (here.length === 0) return null;
        return (
          <section key={kind}>
            <div className="mb-0.5 text-muted-foreground">{CV_HEADING[kind]}</div>
            {here.map((f) => (
              <div key={f.id} className="flex gap-2 py-0.5">
                <span className="flex-1">{f.text}</span>
                <span className={STATUS_TONE[factStatus(f)]}>{factStatus(f)}</span>
              </div>
            ))}
          </section>
        );
      })}
      <div>
        <Button
          size="xs"
          onClick={async () => {
            const t = await call("writing.start", {
              kind: "cv",
              programId: null,
              scholarshipId: null,
              basedOn: null,
            });
            void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
          }}
        >
          Write a CV from these
        </Button>
        <p className="mt-1 text-muted-foreground">Only confirmed facts with proof go in.</p>
      </div>
    </div>
  );
}

/** The file itself: PDFs page by page, images as they are, anything else by download. */
export function Preview({ doc }: { doc: VaultDocument | null }) {
  if (!doc)
    return <p className="text-muted-foreground">Pick a document, or a fact proved by one.</p>;
  const url = `/api/files/${doc.id}`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="preview">
      <div className="text-muted-foreground">{doc.name}</div>
      {doc.mime === "application/pdf" ? (
        <object
          data={url}
          type="application/pdf"
          aria-label={doc.name}
          className="min-h-96 w-full flex-1 rounded-md border"
        >
          <a href={url} className="text-info-foreground hover:underline">
            Open {doc.name}
          </a>
        </object>
      ) : doc.mime.startsWith("image/") && doc.mime !== "image/svg+xml" ? (
        <img
          src={url}
          alt={doc.name}
          className="max-h-96 w-full rounded-md border object-contain"
        />
      ) : (
        <p className="text-muted-foreground">No preview for this kind of file.</p>
      )}
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" render={<a href={url} download={doc.name} />}>
          Download
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          Open full size
        </Button>
      </div>
    </div>
  );
}
