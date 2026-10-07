import { Offer } from "@gradcode/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { Choice } from "~/components/Table";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { daysLeft, due, leftAfterRent } from "~/lib/vault";
import { call } from "~/rpc/client";
import { useStore } from "~/state/store";

const SYMBOL: Record<string, string> = { USD: "$", GBP: "£", EUR: "€", AUD: "A$", CAD: "C$" };
const money = (n: number | null, currency: string) =>
  n == null ? "?" : `${SYMBOL[currency] ?? `${currency} `}${Math.round(n).toLocaleString("en-US")}`;

const save = (value: Offer) => void call("vault.save", { kind: "offer", value });
const input =
  "h-6.5 w-full rounded-md border border-input bg-transparent px-1.5 text-foreground text-xs outline-none placeholder:text-placeholder";

/** A text cell that saves on blur. */
function Text({
  value,
  label,
  onSave,
  className,
}: {
  value: string;
  label: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  return (
    <input
      defaultValue={value}
      aria-label={label}
      placeholder="?"
      onBlur={(e) => e.target.value !== value && onSave(e.target.value)}
      className={cn(input, className)}
    />
  );
}

/** A number cell that saves on blur; empty means unknown. */
function Num({
  value,
  label,
  onSave,
  className,
}: {
  value: number | null;
  label: string;
  onSave: (v: number | null) => void;
  className?: string;
}) {
  return (
    <input
      type="number"
      min="0"
      defaultValue={value ?? ""}
      aria-label={label}
      placeholder="?"
      onBlur={(e) => {
        const next = e.target.value === "" ? null : Number(e.target.value);
        if (next !== value) onSave(next);
      }}
      className={cn(input, className)}
    />
  );
}

/** One attribute across every offer: a label, then a cell per offer. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th className="sticky left-0 w-32 border-b bg-background px-3 py-1.5 text-left align-top font-normal text-muted-foreground text-xs">
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cn("w-44 min-w-44 border-b px-3 py-1.5 align-top", className)}>{children}</td>
  );
}

/**
 * Funding offers side by side, one column each, compared by what a year of stipend leaves after
 * rent. Accepting one is where the hunt ends; the agent drafts negotiation letters on request.
 */
export function VaultOffers() {
  const vault = useStore((s) => s.vault);
  const navigate = useNavigate();
  const offers = vault?.offers ?? [];
  // With dependents, rent is for a family home.
  const family = useStore((s) => s.app?.applicant.dependents ?? false);
  const lefts = offers.map((o) => leftAfterRent(o, family));
  const best = Math.max(...lefts.map((l) => l ?? Number.NEGATIVE_INFINITY));
  const accepted = offers.find((o) => o.status === "accepted");
  const of = (label: string, i: number) => `${label}, offer ${i + 1}`;

  const add = () => {
    const app = vault?.applications.find((a) => a.status === "admitted");
    const program = vault?.programs.find((p) => p.id === app?.programId);
    save({
      id: `off_${crypto.randomUUID().slice(0, 12)}`,
      university: program?.university ?? "",
      program: program?.name ?? "",
      stipend: null,
      stipendPer: "year",
      currency: "USD",
      tuition: "full",
      years: null,
      insurance: "",
      duties: "",
      rentPerMonth: null,
      respondBy: null,
      status: "open",
      note: "",
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <h1 className="mr-auto font-semibold text-sm">Offers</h1>
        <Button size="xs" variant="outline" onClick={add}>
          Add offer
        </Button>
      </header>
      {accepted ? (
        <p className="px-4 pb-2 text-success-foreground text-xs">
          You accepted {accepted.university}. The hunt settles here: decline the others and thank
          the people who helped.{" "}
          <Button
            size="xs"
            variant="outline"
            onClick={async () => {
              const t = await call("writing.start", {
                kind: "visa",
                programId: null,
                scholarshipId: null,
                basedOn: null,
                about: [accepted.university, accepted.program].filter(Boolean).join(" · "),
              });
              void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
            }}
          >
            Write visa steps
          </Button>
        </p>
      ) : null}
      {offers.length === 0 ? (
        <div className="border-t px-6 py-16 text-center text-muted-foreground text-xs">
          No offers yet. Add one when an admit comes with money.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto border-t" data-testid="offers">
          <table className="border-collapse text-[12.5px]">
            <tbody>
              <Field label="Offer">
                {offers.map((o, i) => (
                  <Cell key={o.id} className="font-medium">
                    <Text
                      value={o.university}
                      label={of("University", i)}
                      onSave={(university) => save({ ...o, university })}
                    />
                    <div className="mt-1">
                      <Text
                        value={o.program}
                        label={of("Program", i)}
                        onSave={(program) => save({ ...o, program })}
                      />
                    </div>
                  </Cell>
                ))}
              </Field>
              <Field label="Stipend">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <span className="flex items-center gap-1">
                      <Num
                        value={o.stipend}
                        label={of("Stipend", i)}
                        className="w-20 shrink-0"
                        onSave={(stipend) => save({ ...o, stipend })}
                      />
                      <Choice
                        label={of("Stipend per", i)}
                        value={o.stipendPer}
                        options={Offer.shape.stipendPer.options}
                        onChange={(stipendPer) => save({ ...o, stipendPer })}
                      />
                      <Text
                        value={o.currency}
                        label={of("Currency", i)}
                        className="w-12 shrink-0 uppercase"
                        onSave={(currency) => save({ ...o, currency: currency.toUpperCase() })}
                      />
                    </span>
                  </Cell>
                ))}
              </Field>
              <Field label="Rent a month">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <Num
                      value={o.rentPerMonth}
                      label={of("Rent a month", i)}
                      onSave={(rentPerMonth) => save({ ...o, rentPerMonth })}
                    />
                    {o.rentPerMonth == null ? (
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        onClick={async () => {
                          const t = await call("threads.create", {
                            title: `Rent near ${o.university}`,
                            text: `Find the current median monthly rent for a 1-bedroom near ${o.university}${family ? " and for a 2-bedroom" : ""}, from a page that states it, and record the 1-bedroom figure in USD with set_offer_rent (offer ${o.id}).`,
                          });
                          void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
                        }}
                      >
                        Find rent
                      </Button>
                    ) : null}
                  </Cell>
                ))}
              </Field>
              <Field label="Left a year">
                {offers.map((o, i) => (
                  <Cell
                    key={o.id}
                    className={cn(
                      "font-medium tabular-nums",
                      lefts[i] != null &&
                        lefts[i] === best &&
                        offers.length > 1 &&
                        "text-success-foreground",
                      (lefts[i] ?? 0) < 0 && "text-destructive-foreground",
                    )}
                  >
                    {money(lefts[i] ?? null, o.currency)}
                  </Cell>
                ))}
              </Field>
              <Field label="Tuition">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <Choice
                      label={of("Tuition", i)}
                      value={o.tuition}
                      options={Offer.shape.tuition.options}
                      onChange={(tuition) => save({ ...o, tuition })}
                    />
                  </Cell>
                ))}
              </Field>
              <Field label="Years funded">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <Num
                      value={o.years}
                      label={of("Years funded", i)}
                      onSave={(years) => save({ ...o, years })}
                    />
                  </Cell>
                ))}
              </Field>
              <Field label="Duties">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <Text
                      value={o.duties}
                      label={of("Duties", i)}
                      onSave={(duties) => save({ ...o, duties })}
                    />
                  </Cell>
                ))}
              </Field>
              <Field label="Insurance">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <Text
                      value={o.insurance}
                      label={of("Insurance", i)}
                      onSave={(insurance) => save({ ...o, insurance })}
                    />
                  </Cell>
                ))}
              </Field>
              <Field label="Respond by">
                {offers.map((o, i) => (
                  <Cell
                    key={o.id}
                    className={cn(
                      o.respondBy && daysLeft(o.respondBy) <= 7 && "text-warning-foreground",
                    )}
                  >
                    <input
                      type="date"
                      defaultValue={o.respondBy ?? ""}
                      aria-label={of("Respond by", i)}
                      onBlur={(e) => save({ ...o, respondBy: e.target.value || null })}
                      className={input}
                    />
                    {o.respondBy ? <div className="mt-0.5 text-2xs">{due(o.respondBy)}</div> : null}
                  </Cell>
                ))}
              </Field>
              <Field label="Status">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <Choice
                      label={of("Status", i)}
                      value={o.status}
                      options={Offer.shape.status.options}
                      onChange={(status) => save({ ...o, status })}
                    />
                  </Cell>
                ))}
              </Field>
              <Field label="">
                {offers.map((o, i) => (
                  <Cell key={o.id}>
                    <span className="flex items-center gap-1">
                      {o.status === "accepted" || o.status === "declined" ? null : (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={async () => {
                            const t = await call("writing.start", {
                              kind: "letter",
                              programId: null,
                              scholarshipId: null,
                              basedOn: null,
                              offerId: o.id,
                            });
                            void navigate({ to: "/t/$threadId", params: { threadId: t.id } });
                          }}
                        >
                          Negotiate
                        </Button>
                      )}
                      <Button
                        size="icon-micro"
                        variant="ghost-muted"
                        aria-label={of("Remove", i)}
                        onClick={() => void call("vault.remove", { kind: "offer", id: o.id })}
                      >
                        <Trash2Icon />
                      </Button>
                    </span>
                  </Cell>
                ))}
              </Field>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
