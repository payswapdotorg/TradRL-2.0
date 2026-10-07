/**
 * Public surface of the W013 engine `journal` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ journal`).
 * Consumed by the world engine (command lifecycle append + restore/replay)
 * and, later, by W016's snapshot/branch engine (records + cursor + digest).
 */

export {
  EMPTY_JOURNAL_CURSOR,
  FIRST_EVENT_SEQUENCE,
  JournalLawViolationError,
  createEventJournal,
  createEventJournalFromRecords,
  entryIdFor,
  eventIdFor,
  matchesEventQuery,
  type AppendOptions,
  type EventJournal,
  type JournalRecord,
  type JournalViolationKind,
  type PendingEventDraft,
} from "./eventJournal.js";
export { replayJournal, type ReplayOutcome } from "./replay.js";
