import { callerGeminiKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { assertEngineSelect, UnsafeQuery } from '../../../lib/engineSql';
import {
  MAX_PLAN_CHARTS,
  acceptDashboardPlan,
  columnsFromSchema,
  dashboardBriefing,
} from '../../../lib/dashboardPlan';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * A model chooses what the dashboard is about.
 *
 * The same shape as `/api/ask` — schema in, queries out, never a row of data —
 * asked once for a whole deck instead of once per question. See
 * `lib/dashboardPlan.js` for why this decision was worth handing over and what
 * keeps it honest.
 *
 * Every query returned here is checked twice before it can run: once by
 * `acceptDashboardPlan`, which refuses anything reaching for a column the model
 * was not shown, and once by `assertEngineSelect`, which is the same guard the
 * SQL console and the question console use. Then the browser runs it against
 * the real table and reads its own statistics off the result. Nothing the model
 * says about a number survives to the screen, because it is never asked for one.
 *
 * Unconfigured or failing, this returns `{ unavailable: true }` and the caller
 * keeps the deck the engine planned. It is an alternative to the rule list, not
 * a dependency of it.
 */
export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    if (!canGenerate(request)) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }
    const geminiKey = callerGeminiKey(request);

    const refused = await enforceLimit(request, 'dashboardPlan');
    if (refused) return refused;

    const { schema, intent = '', rowCount = 0, max = MAX_PLAN_CHARTS } = await request.json();
    if (!schema) {
      return Response.json({ error: 'schema is required' }, { status: 400 });
    }

    const wanted = Math.max(1, Math.min(Number(max) || MAX_PLAN_CHARTS, MAX_PLAN_CHARTS));
    const raw = await generateJson(
      'Return the dashboard as JSON.',
      dashboardBriefing({ schema, intent, rowCount, max: wanted }),
      { geminiKey }
    );
    if (!raw) return Response.json({ unavailable: true, reason: 'generation_failed' });

    const { charts, rejected } = acceptDashboardPlan(raw, {
      columns: columnsFromSchema(schema),
      max: wanted,
    });

    // The engine guard has the final say on every query that survived.
    const safe = [];
    const refusedSql = [];
    for (const chart of charts) {
      try {
        safe.push({ ...chart, sql: assertEngineSelect(chart.sql) });
      } catch (error) {
        if (error instanceof UnsafeQuery) refusedSql.push(`${chart.title}: ${error.message}`);
        else throw error;
      }
    }

    if (safe.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_usable_charts', rejected: [...rejected, ...refusedSql] });
    }

    return Response.json({ charts: safe, rejected: [...rejected, ...refusedSql] });
  } catch (error) {
    console.error('[dashboard-plan]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
