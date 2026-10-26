// Counts paid API calls so spending is visible and capped.
//
// Live mode keeps a per-day ledger on disk (usage-YYYY-MM-DD.json) so the count
// survives restarts, and refuses new calls once the daily cap is reached. Cache
// hits are free and are counted separately. Mock mode counts in memory only and
// is never capped.
//
// Dollar figures need prices, which change: set PRICE_IN_PER_MTOK and
// PRICE_OUT_PER_MTOK (USD per million tokens) to see an estimate; otherwise only
// tokens are reported.

import fs from 'node:fs';
import path from 'node:path';

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const blank = (date) => ({ date, calls: 0, cacheHits: 0, errors: 0, inputTokens: 0, outputTokens: 0 });

export function createUsageTracker({ dir = null, cap = 50, enforce = true, priceIn = null, priceOut = null, log = console } = {}) {
  let ledger = null;
  let persisted = false;
  const session = blank('session');

  const filePath = (date) => path.join(dir, `usage-${date}.json`);

  function load() {
    const date = today();
    if (ledger?.date === date) return ledger;
    ledger = blank(date);
    persisted = false;
    if (dir && enforce) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(filePath(date))) ledger = { ...ledger, ...JSON.parse(fs.readFileSync(filePath(date), 'utf8')) };
        persisted = true;
      } catch (err) {
        log.error?.(`[usage] not persisting the daily count (${err.code || err.message}); counting in memory only`);
      }
    }
    return ledger;
  }

  function save() {
    if (!persisted) return;
    try {
      fs.writeFileSync(filePath(ledger.date), JSON.stringify(ledger, null, 2));
    } catch (err) {
      persisted = false;
      log.error?.(`[usage] could not save the daily count (${err.code || err.message})`);
    }
  }

  const cost = (l) => (priceIn != null && priceOut != null
    ? (l.inputTokens * priceIn + l.outputTokens * priceOut) / 1e6
    : null);

  return {
    /** May a paid call start? (Cache hits never need this.) */
    canCall() {
      return !enforce || load().calls < cap;
    },

    /** A paid call finished. `usage` is the Messages API usage object. */
    recordCall(usage) {
      const l = load();
      const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
      const output = usage?.output_tokens || 0;
      for (const t of [l, session]) {
        t.calls += 1;
        t.inputTokens += input;
        t.outputTokens += output;
      }
      save();
      return { inputTokens: input, outputTokens: output };
    },

    /** A paid call was attempted and failed (still counts toward the cap: it may have been billed). */
    recordError() {
      const l = load();
      for (const t of [l, session]) {
        t.calls += 1;
        t.errors += 1;
      }
      save();
    },

    recordCacheHit() {
      const l = load();
      l.cacheHits += 1;
      session.cacheHits += 1;
      save();
    },

    snapshot() {
      const l = load();
      return {
        date: l.date,
        calls: l.calls,
        cap: enforce ? cap : null,
        remaining: enforce ? Math.max(0, cap - l.calls) : null,
        cacheHits: l.cacheHits,
        errors: l.errors,
        inputTokens: l.inputTokens,
        outputTokens: l.outputTokens,
        estimatedUsd: cost(l),
        persisted,
        session: { calls: session.calls, cacheHits: session.cacheHits, inputTokens: session.inputTokens, outputTokens: session.outputTokens, estimatedUsd: cost(session) },
      };
    },
  };
}
