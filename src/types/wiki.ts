/**
 * F-4 — shared timing context for time-accurate recency wording.
 *
 * The wiki engine (`computeTiming` in `services/wiki/engine.ts`) OWNS this
 * computation (calendar-day arithmetic, validity checks); the prompt builder
 * (`services/llm/prompts/update-page.ts`) OWNS the wording it derives from
 * these numbers. Lives in `src/types` so the prompt builder can depend on the
 * type without a cycle into the engine module (engine → deep-model → prompts).
 */
export interface TimingContext {
  /** Whole calendar days the page sat dark between its latest synthesis and
   *  THIS entry's date. Null when there's no prior content (first synthesis),
   *  the entry predates the page's latest synthesis ({@link isHistoricalEntry}),
   *  or the entry's timestamp is in the future ({@link isFutureEntry}). The
   *  prompt must NOT emit a negative evolution gap.
   *  Positive => the page genuinely went quiet before this entry arrived (the
   *  legitimate case for "how has this theme changed" language). */
  gapDays: number | null
  /** Whole calendar days between the entry's date and processing `now`. 0
   *  means the entry is from the current local day ("today"). Large values
   *  indicate a stale import. Null when the entry timestamp is in the future
   *  ({@link isFutureEntry}) — don't trust a negative age. */
  entryAgeDays: number | null
  /** The entry predates the page's latest synthesis => it is historical
   *  evidence that ADDS to the page's understanding, NOT a signal the theme
   *  has changed after the current page. The prompt must not emit an
   *  "intensified / eased / shifted" timeline claim relative to NOW. */
  isHistoricalEntry: boolean
  /** The entry's timestamp is in the future relative to processing `now` =>
   *  corrupt/invalid timing. The prompt must use neutral "this reflection"
   *  wording and must NOT invent a temporal-evolution storyline. */
  isFutureEntry: boolean
}
