import { GoogleGenerativeAI } from "@google/generative-ai";
// Cache-breaker: v2
import Groq from "groq-sdk";
import alasql from "alasql";
import path from "path";
import fs from "fs";
import { sanitizeDataset } from "../../utils/dataCleaner";
import { generateDatasetSummary } from "../../utils/dataCompressor";
import { resolveChart, isAggregatedSql, ADVANCED_TYPES } from "../../../lib/chartResolver";
import { planCharts, planKpis, recommendedChartCount } from "../../../lib/analystPlanner";
import { analyzeStoryboard } from "../../../lib/insightEngine";

// Initialize Clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// Anthropic Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const MOCK_SCHEMA = `
Table: SalesData
Columns:
- date (DATE)
- region (VARCHAR)
- product_category (VARCHAR)
- revenue (DECIMAL)
- units_sold (INTEGER)
`;

const CHART_INSIGHT_PROMPT = `
# ROLE AND DIRECTIVE
You are an Elite Enterprise Strategic Analyst. Your task is to analyze the provided visualization results (the resultData array) and generate specific, boardroom-ready insights for THIS specific visual.

# ANALYTICAL PROTOCOL
1. Identify the most significant statistical fact in the provided data (e.g., the largest category, a growth trend, or a significant outlier).
2. Calculate a supporting delta or ratio (e.g., "30% higher than average").
3. Determine the "So What" - how does this data impact business operations or revenue?
4. Propose a specific, targeted question for the next executive board meeting.

# OUTPUT FORMAT (STRICT ENFORCEMENT)
You must return your analysis as a strictly valid, minified JSON object. Do not include markdown formatting, markdown code blocks, or any conversational text.

You must strictly adhere to this exact JSON schema:
{
  "storyboard": [
    {
      "insight_anchor": "String (The analytical fact with the calculated metric, max 500 chars)",
      "insight_implication": "String (Operational or financial impact based ONLY on verified data, max 500 chars)",
      "insight_question": "String (Actionable strategic question for executive decisioning, max 500 chars)",
      "markdownAnalysis": "String (A short markdown summary of the findings)"
    }
  ]
}
`;


const getAnalystInstruction = (groundedFindings = [], synthesis = {}) => {
  return `
# WHO YOU ARE
You are a clear-headed business analyst writing for busy, non-technical executives. Your job is to turn already-computed statistics into plain, confident English that a CEO can read in seconds.

# THE MOST IMPORTANT RULE
Every number has ALREADY been calculated for you and is provided below under VERIFIED FINDINGS. You must NOT invent, estimate, or recompute any number. Use only the figures given. If a number isn't in the findings, don't state it. This is non-negotiable — your only job is wording, not math.

# HOW TO WRITE
- Plain language. No jargon, no buzzwords ("synergy", "leverage", "boardroom-ready"), no filler.
- Short, direct sentences. Lead with the point.
- Concrete and specific: name the segment and the real number from the findings.
- Honest: if a relationship is weak or a trend is flat, say so.

# FOR EACH CHART, WRITE THREE THINGS
1. insight_anchor — the single most important finding, stated in one plain sentence WITH the verified number.
2. insight_implication — what it means for the business, in plain terms, grounded only in the verified findings.
3. insight_question — one specific question the leadership team should ask or decide next (not generic).

# VERIFIED FINDINGS (your only source of facts)
${JSON.stringify(groundedFindings)}

# DATASET-LEVEL SYNTHESIS (already computed)
${JSON.stringify(synthesis)}

# OUTPUT FORMAT (STRICT)
Return ONE strictly valid, minified JSON object. No markdown, no code fences, no commentary.

{
  "slideZero": {
    "title": "Executive Summary",
    "macroInsights": ["Exactly 3 plain-English takeaways, each citing a verified number"],
    "strategicScorecard": {
      "focus": "The single most important thing to act on",
      "risk": "The biggest risk or concentration in the data",
      "opportunity": "The clearest opportunity or positive trend"
    }
  },
  "storyboard": [
    {
      "id": "Matching id from the findings",
      "pageTitle": "Short, plain slide title (no jargon)",
      "insight_anchor": "The key finding in one sentence, with the verified number",
      "insight_implication": "What it means for the business, plainly",
      "insight_question": "One specific next question or decision"
    }
  ]
}
`;
};


export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      userQuestion, 
      customSchema, 
      csvData,
      jsonData,
      perspective,
      chartData,
      fullDataset 
    } = body;


    if (!userQuestion && !perspective) {
      return Response.json({ error: "userQuestion or perspective is required" }, { status: 400 });
    }

    const activeSchema = customSchema || MOCK_SCHEMA;
    const tableName = "SalesData"; // Force consistency with Engineer instructions

    // 2. LLM Translation (Executive Mode)
    let data = [];
    if (jsonData) {
      data = jsonData;
    } else {
      const rawCsv = csvData || fs.readFileSync(path.join(process.cwd(), "sales_data.csv"), 'utf8');
      data = await alasql.promise(`SELECT * FROM CSV(?, {headers:true})`, [rawCsv]);
    }
    
    console.log(`[PASS 1] Data loaded: ${data.length} rows. Table: ${tableName}`);
    
    // Sanitize the data to fix currency strings and empty values before SQL execution
    const { cleanedData } = sanitizeDataset(data);
    data = cleanedData;

    const compressedContext = generateDatasetSummary(data);

    // --- PASS 1: THE ENGINEER (Generate SQL) ---
    let charts = [];
    let kpis = [];

    if (perspective === 'Chart Insight' && chartData) {
      // Bypass planning if we already have the chart(s) to analyze
      charts = chartData;
    } else {
      // HYBRID PLANNING: a deterministic analyst playbook proposes strong,
      // single-dimension candidate charts (correct SQL/type/axes guaranteed); the
      // LLM then curates the order/titles and drops weak ones. If the LLM is
      // unavailable, the planner output is used directly.
      // Slide count adapts to the data's richness (wider schema -> more slides),
      // anchored at ~7 and capped for executive readability.
      const slideTarget = recommendedChartCount(data);
      const candidates = planCharts(data, { max: slideTarget });
      kpis = planKpis(data);

      const focus = (userQuestion && userQuestion !== "GLOBAL_INIT") ? userQuestion : null;
      charts = await curateCharts(candidates, focus);
      if (!charts || charts.length === 0) charts = candidates;
    }

    // Ensure every chart has a unique ID (System-enforced)
    charts = charts.map((c, i) => ({ ...c, id: c.id || `slide_${i + 1}` }));

    // NOTE: Chart-type diversity is enforced AFTER execution (see
    // enforceChartDiversity below), once each chart's real result shape is
    // known — so we never assign a type the data cannot support.

    // --- EXECUTION PHASE (Run the Math) ---
    // Ensure the table exists and is fresh for this request
    try {
      alasql(`DROP TABLE IF EXISTS [${tableName}]`);
      alasql(`DROP TABLE IF EXISTS ${tableName}`);
      alasql(`CREATE TABLE [${tableName}]`);
      alasql.tables[tableName].data = data;
    } catch (e) {
      console.warn("Table setup warning:", e.message);
    }

    const fullTechnicalCharts = [];
    const strippedAnalystPayload = [];

    for (const chart of charts) {
      try {
        const rawSql = chart.sql || chart.sql_query || "";
        let resultData = chart.resultData;
        if (!resultData || resultData.length === 0) {
          // Robust SQL Cleaning: AI often puts brackets or weird spacing
          let cleanSql = rawSql
            .replace(/\[SalesData\]/gi, tableName)
            .replace(/SalesData/gi, tableName);

          try {
            resultData = alasql(cleanSql);
          } catch (e) {
            console.warn(`[SQL_RETRY] Failed ${chart.title}: ${e.message}`);
            resultData = [];
          }
        }

        // --- SELF-HEALING FALLBACK ---
        // Trigger when the query returned nothing, returned too many rows, OR was
        // never aggregated in the first place (raw row dumps make noisy charts).
        const wasAggregated = isAggregatedSql(rawSql) || (chart.resultData && chart.resultData.length > 0);
        if (!resultData || resultData.length === 0 || resultData.length > 30 || !wasAggregated) {
          const idRegex = /(^id$|_id$|key|code|guid|uuid|index|row|sr|sno|serial)/i;
          const stringCols = Object.keys(data[0] || {}).filter(k => typeof data[0][k] === 'string' && !idRegex.test(k));
          const numCols = Object.keys(data[0] || {}).filter(k => typeof data[0][k] === 'number' && !idRegex.test(k));
          
          if (stringCols.length > 0 && numCols.length > 0) {
            // Pick the most meaningful numeric column (skip the first if it looks like an index)
            const firstNumVals = data.slice(0, 5).map(r => r[numCols[0]]);
            const isSequential = firstNumVals.every((v, i) => i === 0 || v === firstNumVals[i-1] + 1);
            const metricCol = isSequential && numCols.length > 1 ? numCols[1] : numCols[0];
            
            
            
            // Adapt chart_type only for types that REQUIRE dual metrics
            const originalType = (chart.chart_type || '').toLowerCase();
            if (['composed', 'radar'].includes(originalType)) {
              chart.chart_type = 'bar';
              console.warn(`[SELF_HEAL] Overriding chart_type from '${originalType}' to 'bar' (single-metric fallback)`);
            }
            
            let fallbackSql;
            if (originalType === 'scatter' && numCols.length >= 2) {
              // For scatter charts, produce dual-metric SQL to preserve the scatter type
              const secondMetric = numCols.find(c => c !== metricCol) || numCols[1];
              fallbackSql = `SELECT [${stringCols[0]}], AVG([${metricCol}]) as [Avg${metricCol.replace(/\s/g,'')}], AVG([${secondMetric}]) as [Avg${secondMetric.replace(/\s/g,'')}] FROM SalesData GROUP BY [${stringCols[0]}] ORDER BY [Avg${metricCol.replace(/\s/g,'')}] DESC LIMIT 10`;
              chart.xAxisKey = `Avg${metricCol.replace(/\s/g,'')}`;
              chart.yAxisKey = `Avg${secondMetric.replace(/\s/g,'')}`;
            } else if (originalType === 'scatter') {
              // Not enough numeric columns for scatter — downgrade to bar
              chart.chart_type = 'bar';
              fallbackSql = `SELECT [${stringCols[0]}], AVG([${metricCol}]) as [Average] FROM SalesData GROUP BY [${stringCols[0]}] ORDER BY [Average] DESC LIMIT 10`;
              chart.xAxisKey = stringCols[0];
              chart.yAxisKey = "Average";
            } else {
              // For bar, line, area, donut — standard single-metric fallback
              fallbackSql = `SELECT [${stringCols[0]}], AVG([${metricCol}]) as [Average] FROM SalesData GROUP BY [${stringCols[0]}] ORDER BY [Average] DESC LIMIT 10`;
              chart.xAxisKey = stringCols[0];
              chart.yAxisKey = "Average";
            }
            console.warn(`[SELF_HEAL] Triggered for ${chart.title} (Rows: ${resultData ? resultData.length : 0}). Type: ${chart.chart_type}`);
            
            try {
              resultData = alasql(fallbackSql);
            } catch(e) {
              console.error(`[SELF_HEAL] Fallback SQL failed:`, e.message);
              resultData = [];
            }
          }
        }
        
        if (!resultData) resultData = [];

        // Combine multiple categorical columns into one composite X label so we
        // don't render duplicate/irrelevant ticks (preserved from the original
        // engine). Skipped for correlation charts, which need raw dimensions.
        let requestedXKey = chart.xAxisKey;
        if (resultData.length > 0) {
          const stringKeys = Object.keys(resultData[0]).filter(k => typeof resultData[0][k] === 'string');
          const wantsScatter = /scatter|distribution|correlation/.test((chart.chart_type || '').toLowerCase());
          if (stringKeys.length > 1 && !wantsScatter) {
            const compositeKey = stringKeys.join(' & ');
            resultData = resultData.map(row => ({
              ...row,
              [compositeKey]: stringKeys.map(k => String(row[k] || '')).join(' - '),
            }));
            requestedXKey = compositeKey;
          }
        }

        // SINGLE SOURCE OF TRUTH: resolve the final, data-validated chart spec
        // from the real query results. This subsumes all the old axis heuristics
        // and per-type suitability guards, and matches the frontend exactly.
        if (resultData.length > 0) {
          const spec = resolveChart(resultData, {
            type: chart.chart_type,
            xKey: requestedXKey,
            yKey: chart.yAxisKey,
            secondaryYAxisKey: chart.secondaryYAxisKey,
          });
          chart.chart_type = spec.type;
          chart.xAxisKey = spec.xKey;
          chart.yAxisKey = spec.yKey;
          chart.secondaryYAxisKey = spec.secondaryKey || chart.secondaryYAxisKey;
        }

        fullTechnicalCharts.push({ ...chart, resultData });
        strippedAnalystPayload.push({ 
          id: chart.id,
          title: chart.title,
          resultData 
        });
      } catch (dbError) {
        console.error(`CRITICAL SQL FAILURE [${chart.title}]:`, dbError.message);
        console.error(`Query attempted:`, chart.sql || chart.sql_query);
        fullTechnicalCharts.push({ ...chart, resultData: [] });
      }
    }
    alasql(`DROP TABLE ${tableName}`);

    // --- DATA-AWARE CHART DIVERSITY ENFORCEMENT ---
    // Encourage visual variety, but only switch a chart to a type its own result
    // data can actually support (verified through the resolver).
    enforceChartDiversity(fullTechnicalCharts);

    // --- DETERMINISTIC INSIGHT ENGINE (Verified Math) ---
    // Compute every statistic from the REAL query results before any LLM runs.
    // These findings are the single source of numerical truth: they are attached
    // to each slide, fed to the LLM as the ONLY facts it may cite, and used to
    // write a correct narrative if the LLM is unavailable.
    const { perChart, synthesis } = analyzeStoryboard(fullTechnicalCharts, data);
    const findingsById = Object.fromEntries(perChart.map((f) => [String(f.id), f]));

    // --- PASS 2: THE ANALYST (Phrase the verified findings) ---
    // The LLM only rewrites the deterministic findings into polished, plain-English
    // executive language. It never computes numbers.
    const groundedFindings = perChart.map((f) => ({
      id: f.id,
      title: f.title,
      type: f.type,
      finding: f.headline,
      context: f.detail,
      suggested_next_step: f.recommendation,
      verified_numbers: f.verifiedFacts,
    }));

    const analystInstruction = getAnalystInstruction(groundedFindings, synthesis);
    const analystPrompt = `Rewrite the ${groundedFindings.length} VERIFIED FINDINGS into a clear executive storyboard for a non-technical leader.

RULES:
1. Use ONLY the numbers in the verified findings. Never invent or recompute a figure.
2. Plain English. No jargon or buzzwords. Short, direct sentences.
3. Return a 'slideZero' object AND exactly ${groundedFindings.length} entries in 'storyboard', each with the matching id.`;

    let analystJson = await generateWithFallback(analystPrompt, analystInstruction, "analyst");

    // Did the LLM produce usable narrative? If not, fall back to the deterministic
    // findings — which are already exec-ready prose grounded in verified math.
    const llmStoryboard = Array.isArray(analystJson?.storyboard) ? analystJson.storyboard : [];
    const aiAnalystFailed =
      analystJson?.slideZero?.title === "Synthesis Error" ||
      (llmStoryboard.length === 0 && !analystJson?.insight_anchor);

    if (aiAnalystFailed) {
      console.warn("[AUTONOMOUS_ANALYST] LLM unavailable — using deterministic findings narrative.");
    }

    // slideZero: prefer the LLM phrasing, but always backstop with the deterministic
    // synthesis so the executive summary is never empty or wrong.
    const slideZero = {
      title: analystJson?.slideZero?.title || synthesis.title || "Executive Summary",
      macroInsights:
        (Array.isArray(analystJson?.slideZero?.macroInsights) && analystJson.slideZero.macroInsights.length
          ? analystJson.slideZero.macroInsights
          : synthesis.macroInsights) || [],
      strategicScorecard: {
        focus: analystJson?.slideZero?.strategicScorecard?.focus || synthesis.strategicScorecard.focus,
        risk: analystJson?.slideZero?.strategicScorecard?.risk || synthesis.strategicScorecard.risk,
        opportunity:
          analystJson?.slideZero?.strategicScorecard?.opportunity || synthesis.strategicScorecard.opportunity,
      },
      rowsAnalyzed: synthesis.rowsAnalyzed,
      chartsAnalyzed: synthesis.chartsAnalyzed,
    };

    const narratives = llmStoryboard;

    // --- FINAL MERGE ---
    // Each slide carries: verified `findings` (always), plus narrative text from the
    // LLM when available, otherwise the deterministic headline/detail/recommendation.
    const finalStoryboard = fullTechnicalCharts.map((chart, index) => {
      const finding = findingsById[String(chart.id)] || null;

      // Match the LLM narrative to this chart (by id, then title, then index).
      let narrative =
        narratives.find(
          (n) => n.id?.toString().toLowerCase().trim() === chart.id?.toString().toLowerCase().trim()
        ) ||
        narratives.find(
          (n) =>
            n.pageTitle?.toLowerCase().trim() === chart.title?.toLowerCase().trim() ||
            n.title?.toLowerCase().trim() === chart.title?.toLowerCase().trim() ||
            (n.insight_anchor && narratives.length === 1)
        ) ||
        narratives[index] ||
        null;

      // Ground each field: LLM text if present, else the verified deterministic text.
      const anchor = narrative?.insight_anchor || finding?.headline || "";
      const implication = narrative?.insight_implication || finding?.detail || "";
      const question = narrative?.insight_question || finding?.recommendation || "";

      // Build a "Verified Metrics" markdown block straight from the computed facts so
      // the audit/PDF view always shows real numbers, regardless of the LLM.
      const verifiedBlock = finding
        ? `**Verified metrics**\n\n${finding.verifiedFacts.map((x) => `- ${x}`).join("\n")}`
        : "";
      const markdownAnalysis =
        narrative?.markdownAnalysis ||
        narrative?.analysis ||
        (finding ? `### ${finding.title || chart.title}\n\n${finding.headline}\n\n${finding.detail}\n\n${verifiedBlock}` :
          "### Analysis Unavailable\nNo data points were returned for this visual. Review the raw results in the Audit Trail.");

      return {
        pageTitle: narrative?.pageTitle || narrative?.title || chart.title,
        insight_anchor: anchor,
        insight_implication: implication,
        insight_question: question,
        markdownAnalysis,
        findings: finding ? { metrics: finding.metrics, verifiedFacts: finding.verifiedFacts } : null,
        chart: chart,
      };
    });

    return Response.json({
      slideZero: slideZero,
      storyboard: finalStoryboard,
      kpis: kpis,
    });

  } catch (error) {
    console.error("Route Error:", error.message);
    return Response.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
  }
}

// HYBRID CURATION: let the LLM select/order the strongest planner candidates and
// improve their titles — WITHOUT touching the (already-validated) SQL, type or
// axes. Falls back to the planner's own ordering if the LLM is unavailable.
async function curateCharts(candidates, focus) {
  if (!candidates || candidates.length === 0) return [];

  const instruction = `You are a senior data analyst curating an executive dashboard.
You are given CANDIDATE charts already validated against the data.
Select and order the most insightful subset and rewrite each title to be
concise, specific and executive-friendly.${focus ? ` Prioritize charts relevant to: "${focus}".` : ''}

STRICT RULES:
- Choose only from the provided candidate ids. Do NOT invent charts.
- Do NOT change chart_type, sql or axis keys — only the title and the selection/order.
- Return strictly valid minified JSON: {"charts":[{"id":"slide_1","title":"..."}]}`;

  const list = candidates.map(c => ({
    id: c.id,
    title: c.title,
    chart_type: c.chart_type,
    shows: `${c.xAxisKey} vs ${c.yAxisKey}`,
  }));
  const prompt = `CANDIDATES:\n${JSON.stringify(list)}\n\nReturn the curated, ordered selection as JSON.`;

  try {
    const res = await generateWithFallback(prompt, instruction, "curator");
    const chosen = res?.charts;
    if (!Array.isArray(chosen) || chosen.length === 0) return candidates;

    const byId = Object.fromEntries(candidates.map(c => [c.id, c]));
    const curated = [];
    const used = new Set();
    for (const sel of chosen) {
      const base = byId[sel.id];
      if (base && !used.has(sel.id)) {
        used.add(sel.id);
        curated.push({ ...base, title: sel.title || base.title });
      }
    }
    return curated.length > 0 ? curated : candidates;
  } catch (e) {
    console.warn("[CURATOR] Falling back to planner order:", e.message);
    return candidates;
  }
}

// Reassign duplicate chart types to under-represented "advanced" types, but only
// when the chart's own result data can support the new type (checked via the
// resolver). Runs after execution, so it is fully data-aware.
function enforceChartDiversity(charts) {
  if (!charts || charts.length < 3) return;

  const typeOf = (c) => (c.chart_type || 'bar').toLowerCase();
  const counts = {};
  charts.forEach(c => { const t = typeOf(c); counts[t] = (counts[t] || 0) + 1; });

  const missing = ADVANCED_TYPES.filter(t => !counts[t]);
  if (missing.length === 0) return;

  let mi = 0;
  for (let i = charts.length - 1; i >= 0 && mi < missing.length; i--) {
    const chart = charts[i];
    const t = typeOf(chart);
    if (counts[t] < 2) continue; // keep at least one of each existing type
    const rd = chart.resultData;
    if (!rd || rd.length === 0) continue;

    const target = missing[mi];
    const spec = resolveChart(rd, {
      type: target,
      xKey: chart.xAxisKey,
      yKey: chart.yAxisKey,
      secondaryYAxisKey: chart.secondaryYAxisKey,
    });

    // Accept the swap only if the data genuinely supports the requested type.
    if (spec.type === target) {
      console.log(`[DIVERSITY] ${chart.title}: '${t}' -> '${target}'`);
      counts[t]--;
      counts[target] = (counts[target] || 0) + 1;
      chart.chart_type = spec.type;
      chart.xAxisKey = spec.xKey;
      chart.yAxisKey = spec.yKey;
      chart.secondaryYAxisKey = spec.secondaryKey || chart.secondaryYAxisKey;
      mi++;
    } else {
      mi++; // can't satisfy this one with available data; move on
    }
  }
}

async function generateWithFallback(prompt, systemInstruction, debugTag = "gen") {
  // --- Primary Attempt: Groq ---
  if (groq) {
    try {
      return await generateWithGroq(prompt, systemInstruction);
    } catch (error) {
      console.error("Groq Primary Attempt failed, falling back to Gemini:", error.message);
    }
  }

  // --- Fallback Attempt 1: Anthropic (Claude) ---
  if (ANTHROPIC_API_KEY) {
    try {
      console.log(`Attempting Anthropic Fallback: claude-3-5-sonnet-20240620`);
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20240620",
          max_tokens: 4096,
          system: systemInstruction,
          messages: [
            { role: "user", content: prompt }
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Anthropic API error: ${err}`);
      }

      const anthropicData = await response.json();
      const rawText = anthropicData.content[0].text;
      return JSON.parse(cleanJson(rawText));
    } catch (error) {
      console.error(`Anthropic Fallback failed:`, error.message);
    }
  }

  // --- Fallback Attempt 2: Gemini ---
  const modelOptions = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash"
  ];
  
  // Single pass — if all models 404, the key is likely bad. Don't waste time retrying.
  for (const modelName of modelOptions) {
    try {
      console.log(`Attempting Gemini generation: ${modelName} via v1beta`);
      
      const model = genAI.getGenerativeModel({ 
        model: modelName
      }, { apiVersion: 'v1beta' });

      const generationConfig = {
        temperature: 0,
        responseMimeType: "application/json"
      };

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      });

      const rawText = result.response.text();
      return JSON.parse(cleanJson(rawText));
    } catch (error) {
      console.error(`Gemini [${modelName}] failed:`, error.message);
    }
  }

  // Final emergency fallback if ALL engines fail
  console.warn(`[AUTONOMOUS_FALLBACK] All AI engines exhausted for ${debugTag}. Generating programmatic response.`);
  return debugTag === "analyst" ? { slideZero: { title: "Synthesis Error", macroInsights: [] }, storyboard: [] } : { charts: [], kpis: [] };
}

function cleanJson(text) {
  try {
    const startObj = text.indexOf('{');
    const startArr = text.indexOf('[');
    let start = -1;
    if (startObj !== -1 && (startArr === -1 || startObj < startArr)) start = startObj;
    else if (startArr !== -1) start = startArr;

    const endObj = text.lastIndexOf('}');
    const endArr = text.lastIndexOf(']');
    let end = -1;
    if (endObj !== -1 && (endArr === -1 || endObj > endArr)) end = endObj;
    else if (endArr !== -1) end = endArr;

    if (start !== -1 && end !== -1 && end > start) {
      return text.substring(start, end + 1);
    }
  } catch (e) {
    console.error("Failed to clean JSON:", e);
  }
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

async function generateWithGroq(prompt, systemInstruction) {
  const groqModels = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  
  for (const model of groqModels) {
    try {
      console.log(`Attempting Groq generation with model: ${model}`);
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        model: model,
        temperature: 0,
        response_format: { type: "json_object" }
      });

      const rawText = chatCompletion.choices[0]?.message?.content || "{}";
      return JSON.parse(cleanJson(rawText));
    } catch (error) {
      console.error(`Groq [${model}] failed:`, error.message);
      // If we exhausted all Groq models, throw to trigger Anthropic/Gemini fallback
      if (model === groqModels[groqModels.length - 1]) throw error;
    }
  }
}
