// What each row action asks the agent to do for the selected Results rows; runner.ts sends it
// with the rows (threads.rowAction).
import type { RowOp } from "@getmyprof/contracts";

export const ROW_INSTRUCTIONS: Record<RowOp, string> = {
  email:
    "Find and check the email address of each professor below. Look for it on their own page first (read_contact_rule lists the addresses a page gives) or their NSF award (nsf_awards with pi). If treg is available: only when neither has one, find it with find_email, then check each address with verify_email (free). Pass the professor's sheet key as `about` on every treg call. Record email and emailCheck for each with propose_professor.",
  lasts:
    "For each professor below, look up their active NSF and NIH awards and record money and how long it lasts after the intake (lasts) with propose_professor.",
  taking:
    "For each professor below, run read_contact_rule on their homepage or lab page (WebFetch a page it can't read), then record with propose_professor: taking (yes, no or not stated, then their sentence copied exactly in quotes, with the page it is on, which read_contact_rule names, and the date read), contact (how they want to be reached, with any form's link), subjectRule (the words their subject line must carry) and stage apply-only when they say not to email, to apply first or to use a form.",
  work: 'For each professor below, look them up with openalex_author, then read their homepage or lab page (and their Google Scholar page when OpenAlex is thin), and record with propose_professor: recent (their latest two or three papers or projects, newest first, each dated), niche (their area and current topics), seeking (what they want students to work on or bring, in their words, or "not stated") and scholar (their Google Scholar profile URL, when their page or CSRankings links it).',
  lab: "For each professor below, run lab_members, then read their lab's people page, and record lab with propose_professor: how many students are in the lab now, recent graduates and where they went, and who to ask about the lab (a current student, with the address their page prints).",
  personalize:
    'For each professor below, run warm_paths and openalex_author, then vault_search for the applicant\'s fact closest to their recent work, and record with propose_professor: warm (a true path to them, e.g. a co-author of the applicant who wrote with them, with the paper; or "none found") and hook (one line tying that fact to one of their recent papers, by title).',
  draft:
    "Draft a short first message for each professor below with draft_email (touch first), by the first email playbook. When their recent or hook is empty, find one recent paper and one detail of it first (openalex_author, warm_paths). Email goes only to a reviewed address. Without one, if the sheet has their LinkedIn profile, draft a LinkedIn note instead (channel linkedin, to that URL, under 200 characters so it also fits a connection request). Skip apply-only professors, anyone whose taking says no (unless the applicant asked to write anyway) and anyone with neither, and say so. The applicant approves each draft in Pipeline before anything is sent.",
};
