// Every free and paid source the agent reads, by key: the grant databases, OpenAlex (people,
// topics, labs, warm paths), CSRankings and treg. The fake provider swaps in fixtures
// (fixtures.ts).
import type { AwardSource, PositionSource } from "@getmyprof/contracts";
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
import { type Lab, openAlexLab, openAlexWarm, type Warm } from "../sources-people.ts";
import {
  inspirePositions,
  jobsAcUkPositions,
  type PositionQuery,
  type RawPosition,
} from "../sources-positions.ts";
import { tregCall, type TregOutcome, type TregRequest } from "../treg.ts";

type AwardFetch = (q: AwardQuery) => Promise<RawAward[]>;
type PositionFetch = (q: PositionQuery) => Promise<RawPosition[]>;

/** Every grant database by key, plus OpenAlex and treg. The fake provider swaps in fixtures. */
export type Sources = {
  nsf: AwardFetch;
  nih: AwardFetch;
  ukri: AwardFetch;
  cordis: AwardFetch;
  arc: AwardFetch;
  dfg: AwardFetch;
  nserc: AwardFetch;
  /** Advertised PhD positions, by board. */
  jobsacuk: PositionFetch;
  inspire: PositionFetch;
  openalex: (name: string, university?: string) => Promise<Author | null>;
  /** Faculty CSRankings lists at a school. */
  csrankings: (university: string) => Promise<Faculty[]>;
  /** Who at a school works on a topic, by OpenAlex. */
  byTopic: (topic: string, university: string) => Promise<TopicAuthor[]>;
  /** Topics next to the applicant's fields. */
  adjacent: (fields: string[]) => Promise<string[]>;
  /** Who wrote with a professor lately: their lab, by OpenAlex. */
  lab: (name: string, university: string) => Promise<Lab | null>;
  /** What links the applicant's papers (fact texts) to a professor, by OpenAlex. */
  warm: (name: string, university: string, papers: string[]) => Promise<Warm | null>;
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
  jobsacuk: jobsAcUkPositions,
  inspire: inspirePositions,
  openalex: openAlexAuthor,
  csrankings: csrankingsFaculty,
  byTopic: openAlexByTopic,
  adjacent: adjacentTopics,
  lab: openAlexLab,
  warm: openAlexWarm,
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

const POSITION_KEY = {
  "jobs.ac.uk": "jobsacuk",
  INSPIRE: "inspire",
} as const satisfies Record<PositionSource, keyof Sources>;

/** A position board's key in Sources. */
export const positionKey = (s: PositionSource) => POSITION_KEY[s];
