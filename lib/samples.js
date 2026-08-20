/**
 * Sample datasets for people who want to see the tool work before uploading
 * anything of their own.
 *
 * These are generated rather than hard-coded because the previous five-row
 * mocks were too small to plan a real deck against — the planner needs enough
 * rows and enough distinct category values to propose trends, distributions and
 * correlations. Generation is seeded, so the same sample always produces the
 * same analysis.
 */

// Small deterministic PRNG (mulberry32) — same seed, same dataset, every time.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toCsv = (headers, rows) =>
  [headers.join(','), ...rows.map((r) => r.map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v)).join(','))].join('\n');

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const round = (v, d = 2) => Number(v.toFixed(d));

function retailCsv() {
  const r = rng(20260820);
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const categories = ['Electronics', 'Apparel', 'Home & Garden', 'Grocery', 'Sports', 'Beauty'];
  const channels = ['Store', 'Online', 'Partner'];
  const regionLift = { North: 1.15, South: 0.9, East: 1.0, West: 1.25, Central: 0.8 };
  const catPrice = { Electronics: 420, Apparel: 65, 'Home & Garden': 120, Grocery: 28, Sports: 95, Beauty: 45 };

  const rows = [];
  for (let d = 0; d < 240; d++) {
    const date = new Date(Date.UTC(2025, 0, 1 + Math.floor(d * 1.5)));
    const iso = date.toISOString().slice(0, 10);
    // A gentle upward trend plus a seasonal wave, so the time chart says something.
    const seasonal = 1 + 0.28 * Math.sin((d / 240) * Math.PI * 2) + d * 0.0015;
    for (let k = 0; k < 3; k++) {
      const region = pick(r, regions);
      const category = pick(r, categories);
      const units = Math.max(1, Math.round((3 + r() * 22) * regionLift[region] * seasonal));
      const price = catPrice[category] * (0.85 + r() * 0.3);
      const discount = round(r() < 0.3 ? r() * 25 : 0, 1);
      const revenue = round(units * price * (1 - discount / 100));
      rows.push([
        iso,
        region,
        category,
        pick(r, channels),
        units,
        round(price),
        discount,
        revenue,
        round(3 + r() * 2, 1),
      ]);
    }
  }
  return toCsv(
    ['order_date', 'region', 'product_category', 'channel', 'units_sold', 'unit_price', 'discount_pct', 'revenue', 'satisfaction_score'],
    rows
  );
}

function churnCsv() {
  const r = rng(77713);
  const regions = ['North', 'South', 'East', 'West'];
  const contracts = ['Month-to-month', 'One year', 'Two year'];
  const plans = ['Basic', 'Standard', 'Premium', 'Enterprise'];
  const planCharge = { Basic: 32, Standard: 58, Premium: 92, Enterprise: 148 };
  const contractRisk = { 'Month-to-month': 0.42, 'One year': 0.16, 'Two year': 0.06 };

  const rows = [];
  for (let i = 0; i < 900; i++) {
    const contract = pick(r, contracts);
    const plan = pick(r, plans);
    const tenure = Math.max(1, Math.round(contract === 'Two year' ? 12 + r() * 48 : contract === 'One year' ? 6 + r() * 30 : 1 + r() * 24));
    const supportCalls = Math.round(r() * (contract === 'Month-to-month' ? 9 : 4));
    // Churn probability rises with support load and falls with tenure.
    const p = contractRisk[contract] + supportCalls * 0.035 - Math.min(tenure, 48) * 0.004;
    rows.push([
      `C${String(1000 + i)}`,
      pick(r, regions),
      contract,
      plan,
      round(planCharge[plan] * (0.9 + r() * 0.25)),
      tenure,
      supportCalls,
      round(1 + r() * 4, 1),
      r() < p ? 'Yes' : 'No',
    ]);
  }
  return toCsv(
    ['customer_id', 'region', 'contract_type', 'plan_tier', 'monthly_charge', 'tenure_months', 'support_calls', 'satisfaction', 'churned'],
    rows
  );
}

function campaignCsv() {
  const r = rng(414141);
  const channels = ['Paid Search', 'Social', 'Display', 'Email', 'Affiliate', 'Video'];
  const audiences = ['New', 'Returning', 'Lapsed'];
  const channelCvr = { 'Paid Search': 0.042, Social: 0.021, Display: 0.008, Email: 0.061, Affiliate: 0.028, Video: 0.014 };
  const channelCpm = { 'Paid Search': 14, Social: 8, Display: 3.5, Email: 1.2, Affiliate: 6, Video: 18 };

  const rows = [];
  for (let m = 0; m < 18; m++) {
    const month = new Date(Date.UTC(2024, m, 1)).toISOString().slice(0, 10);
    for (const channel of channels) {
      for (const audience of audiences) {
        const impressions = Math.round((40000 + r() * 460000) * (1 + m * 0.02));
        const spend = round((impressions / 1000) * channelCpm[channel] * (0.85 + r() * 0.3));
        const ctr = round((0.4 + r() * 3.2) / 100, 4);
        const clicks = Math.round(impressions * ctr);
        const conversions = Math.max(0, Math.round(clicks * channelCvr[channel] * (0.7 + r() * 0.7)));
        rows.push([
          month,
          channel,
          audience,
          `${channel.split(' ')[0]}_${audience}_M${m + 1}`,
          spend,
          impressions,
          clicks,
          conversions,
          conversions > 0 ? round(spend / conversions) : 0,
        ]);
      }
    }
  }
  return toCsv(
    ['month', 'channel', 'audience', 'campaign_name', 'spend', 'impressions', 'clicks', 'conversions', 'cost_per_acquisition'],
    rows
  );
}

export const SAMPLES = [
  {
    key: 'retail',
    title: 'Retail sales',
    description: '720 orders across regions, categories and channels, with a seasonal trend',
    get csv() {
      return retailCsv();
    },
  },
  {
    key: 'churn',
    title: 'Subscription churn',
    description: '900 customers with contract type, tenure, support load and churn outcome',
    get csv() {
      return churnCsv();
    },
  },
  {
    key: 'campaigns',
    title: 'Marketing campaigns',
    description: '324 monthly campaign rows with spend, clicks, conversions and CPA',
    get csv() {
      return campaignCsv();
    },
  },
];
