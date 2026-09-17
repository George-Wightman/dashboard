// Called under the planner's ScriptLock. A durable claim is written BEFORE the
// paid request; a lost response is visible and never automatically charged again.
import { goalReviewPrompt, checkGoalReview, applyGoalReview, scheduleGoalReviews } from '../js/goal-review.js';
import { addDays } from '../js/dates.js';
import { readProperty, writeProperty } from './properties.js';

export async function runGoalReviews({ store, props, request, limit = 2 }) {
  scheduleGoalReviews(store);
  if (!request) return 0;
  const today = store.today();
  const ledger = readProperty(props, 'GOAL_REVIEWS');
  const budget = readProperty(props, 'GOAL_REVIEW_BUDGET', { day: today, calls: 0 });
  if (budget.day !== today) { budget.day = today; budget.calls = 0; }
  // Keep claims while their corresponding document remains pending, even if old.
  for (const [id, entry] of Object.entries(ledger)) {
    const state = store.doc().reviews[id]?.result.state;
    if ((state && state !== 'pending') || (!state && entry.day < addDays(today, -14))) delete ledger[id];
  }
  let calls = 0;
  for (const review of Object.values(store.doc().reviews ?? {}).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id))) {
    if (review.status !== 'active' || review.result.state !== 'pending') continue;
    if (review.reason.startsWith('Scheduled review') && !store.doc().goals[review.goalId]?.details?.reviewEveryDays) {
      store.putWorkflow('reviews', review.id, { result: { state: 'cancelled', message: 'Scheduled reviews were turned off' } }); continue;
    }
    if (store.doc().goals[review.goalId]?.status !== 'active') {
      store.putWorkflow('reviews', review.id, { result: { state: 'cancelled', message: 'Goal is no longer active' } }); continue;
    }
    const cached = ledger[review.id];
    if (cached?.state === 'complete') { applyGoalReview(store, review, cached.reply); continue; }
    if (cached) {
      store.putWorkflow('reviews', review.id, { result: { state: cached.state === 'failed' ? 'failed' : 'unknown',
        message: 'The previous attempt did not produce a saved review. It will not be called again automatically.' } }); continue;
    }
    if (calls >= limit || budget.calls >= 6) continue;
    // A bounded retained ledger prevents a broken sync from creating unbounded claims.
    if (Object.keys(ledger).length >= 20) continue;
    ledger[review.id] = { state: 'started', day: today };
    writeProperty(props, 'GOAL_REVIEWS', ledger);
    budget.calls++; calls++;
    writeProperty(props, 'GOAL_REVIEW_BUDGET', budget);
    try {
      const reply = checkGoalReview(await request(goalReviewPrompt(store.doc(), review)));
      ledger[review.id] = { state: 'complete', day: today, reply };
      writeProperty(props, 'GOAL_REVIEWS', ledger);
      applyGoalReview(store, review, reply);
    } catch {
      // Do not expose API bodies or keys in a synced error message.
      if (ledger[review.id].state !== 'complete') {
        ledger[review.id] = { state: 'failed', day: today };
        writeProperty(props, 'GOAL_REVIEWS', ledger);
      }
      store.putWorkflow('reviews', review.id, { result: { state: 'failed', message: 'Review unavailable or invalid. No tasks were changed.' } });
    }
  }
  return calls;
}
