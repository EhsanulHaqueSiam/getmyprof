// Every free and paid source the agent reads, by key: the grant databases, OpenAlex, CSRankings
// and treg. The fake provider swaps in fixtures (fixtures.ts).
import type { AwardSource } from "@gradcode/contracts";
import {
  type AwardQuery,
  type Author,
  arcAwards,
  cordisAwards,
  nihAwards,
  nsfAwards,
  openAlexAuthor,
  type RawAward,
  ukriAwards,
} from "../sources.ts";
import {
  adjacentTopics,
  csrankingsFaculty,
  dfgAwards,
  type Faculty,
  nsercAwards,
  openAlexByTopic,
  type TopicAuthor,
} from "../sources-more.ts";
import { tregCall, type TregOutcome, type TregRequest } from "../treg.ts";

type AwardFetch = (q: AwardQuery) => Promise<RawAward[]>;

/** Every grant database by key, plus OpenAlex and treg. The fake provider swaps in fixtures. */
export type Sources = {
  nsf: AwardFetch;
  nih: AwardFetch;
  ukri: AwardFetch;
  cordis: AwardFetch;
  arc: AwardFetch;
  dfg: AwardFetch;
  nserc: AwardFetch;
  openalex: (name: string, university?: string) => Promise<Author | null>;
  /** Faculty CSRankings lists at a school. */
  csrankings: (university: string) => Promise<Faculty[]>;
  /** Who at a school works on a topic, by OpenAlex. */
  byTopic: (topic: string, university: string) => Promise<TopicAuthor[]>;
  /** Topics next to the applicant's fields. */
  adjacent: (fields: string[]) => Promise<string[]>;
  treg: (req: TregRequest) => Promise<TregOutcome>;
};

export const realSources: Sources = {
  nsf: nsfAwards,
  nih: nihAwards,
  ukri: ukriAwards,
  cordis: cordisAwards,
  arc: arcAwards,
  dfg: dfgAwards,
  nserc: nsercAwards,
  openalex: openAlexAuthor,
  csrankings: csrankingsFaculty,
  byTopic: openAlexByTopic,
  adjacent: adjacentTopics,
  treg: (req) => tregCall(req),
};

const SOURCE_KEY = {
  NSF: "nsf",
  NIH: "nih",
  UKRI: "ukri",
  CORDIS: "cordis",
  ARC: "arc",
  DFG: "dfg",
  NSERC: "nserc",
} as const satisfies Record<AwardSource, keyof Sources>;

/** An award source's key in Sources. */
export const sourceKey = (s: AwardSource) => SOURCE_KEY[s];
