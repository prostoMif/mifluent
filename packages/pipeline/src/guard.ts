/**
 * The question every model-calling loop asks before each call: has the
 * instance's daily budget run out?
 *
 * A function rather than a boolean passed in at the start, because a long run
 * can cross the cap halfway through and must stop there, not at the end.
 */
export type CostGuard = () => Promise<boolean>;

/** For runs that must never be stopped by the cap: tests, and `--no-llm`. */
export const neverCapped: CostGuard = async () => false;
