import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const SOURCES_PATH = path.join(ROOT, "docs", "data", "sources.json");
const OUT_PATH = path.join(ROOT, "docs", "data", "intel.json");
const SEED_PATH = path.join(ROOT, "docs", "data", "seed.json");
const ARCHIVE_DIR = path.join(ROOT, "docs", "data", "archive");
const DRY_RUN = process.argv.includes("--dry-run");
const MAX_PER_FEED = 8;
const MAX_TOTAL = 48;

const categoryRules = [
  { category: "经营风险", words: ["金价", "黄金价格", "库存", "现金流", "闭店", "加盟", "投诉", "放缓", "下滑", "亏损", "风险"] },
  { category: "战略机会", words: ["新品", "年轻", "国潮", "东方美学", "非遗", "花丝", "串珠", "IP", "联名", "礼赠", "增长"] },
  { category: "出海机会", words: ["东南亚", "新加坡", "马来西亚", "泰国", "柬埔寨", "海外", "国际化", "出海"] },
  { category: "竞品观察", words: ["周大福", "老凤祥", "周大生", "潘多拉", "Pandora", "施华洛世奇", "Swarovski"] },
  { category: "资本市场", words: ["IPO", "港股", "上市", "财报", "业绩", "营收", "利润", "股价"] }
];

const priorityRules = [
  { priority: "高", words: ["潮宏基", "002345", "业绩", "金价", "加盟", "出海", "东南亚", "IPO", "风险", "下滑"] },
  { priority: "中高", words: ["新品", "年轻化", "联名", "门店", "珠宝", "黄金", "消费"] }
];

function decodeXml(value = "") {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .trim();
}

function stripHtml(value = "") {
  return decodeXml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function readTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return decodeXml(block.match(re)?.[1] ?? "");
}

function parseRss(xml, source) {
  const itemBlocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  return itemBlocks.slice(0, MAX_PER_FEED).map((block) => {
    const rawTitle = stripHtml(readTag(block, "title"));
    const rawDescription = stripHtml(readTag(block, "description"));
    const rawLink = readTag(block, "link");
    const published = readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated");
    const publishedDate = Number.isNaN(Date.parse(published)) ? new Date().toISOString() : new Date(published).toISOString();
    const title = rawTitle.replace(/\s+-\s+[^-]+$/u, "").trim() || rawTitle;
    return enrichSignal({
      id: hash(`${source.id}|${rawTitle}|${rawLink}`),
      title,
      summary: rawDescription,
      source: source.name,
      sourceId: source.id,
      group: source.group,
      url: rawLink || "#",
      publishedAt: publishedDate,
      weight: source.weight ?? 1
    });
  });
}

function hash(input) {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function matchRule(text, rules, fallback) {
  const normalized = text.toLowerCase();
  for (const rule of rules) {
    if (rule.words.some((word) => normalized.includes(word.toLowerCase()))) {
      return rule.category ?? rule.priority;
    }
  }
  return fallback;
}

function scoreSignal(signal) {
  const text = `${signal.title} ${signal.summary}`;
  let score = 35 * signal.weight;
  for (const rule of categoryRules) {
    for (const word of rule.words) {
      if (text.toLowerCase().includes(word.toLowerCase())) score += 6;
    }
  }
  const ageHours = Math.max(0, (Date.now() - Date.parse(signal.publishedAt)) / 36e5);
  if (ageHours < 36) score += 10;
  if (ageHours > 24 * 14) score -= 18;
  return Math.max(1, Math.round(score));
}

function enrichSignal(signal) {
  const text = `${signal.title} ${signal.summary}`;
  const category = matchRule(text, categoryRules, signal.group === "competitor" ? "竞品观察" : "战略机会");
  const priority = matchRule(text, priorityRules, "中");
  const impact = buildImpact(category, signal.group);
  const action = buildAction(category, signal.group);
  const score = scoreSignal({ ...signal, category, priority });
  return {
    ...signal,
    category,
    priority,
    score,
    impact,
    action,
    confidence: "公开网络情报，需人工复核"
  };
}

function buildImpact(category, group) {
  if (category === "经营风险") return "可能影响金价周期下的消费意愿、库存周转、加盟质量或经营现金流，需要前置跟踪。";
  if (category === "出海机会") return "有助于判断海外市场的客群、产品、价格带和内容表达是否具备复制价值。";
  if (category === "竞品观察" || group === "competitor") return "可用于判断竞品在产品、渠道、品牌表达和年轻化上的动作，避免同质化竞争。";
  if (category === "资本市场") return "可服务港股 IPO 叙事、投资者沟通和公司增长质量表达。";
  return "可能强化潮宏基在东方美学、时尚黄金、年轻化内容和礼赠场景中的差异化机会。";
}

function buildAction(category, group) {
  if (category === "经营风险") return "加入风险看板，补充内部经营指标后形成董事长周度预警。";
  if (category === "出海机会") return "沉淀国家市场假设卡，并标注需要业务部门验证的数据。";
  if (category === "竞品观察" || group === "competitor") return "纳入竞品周报，拆解其新品、渠道、传播和价格带动作。";
  if (category === "资本市场") return "整理为资本市场观察，评估对港股 IPO 叙事和投资者问答的影响。";
  return "进入战略机会池，判断是否需要形成专题研究或会议议题。";
}

function dedupe(items) {
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = `${item.title}`.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function buildSummary(signals) {
  const risks = signals.filter((item) => item.category === "经营风险");
  const opportunities = signals.filter((item) => item.category === "战略机会" || item.category === "出海机会");
  const opportunityIndex = Math.min(95, 45 + opportunities.length * 5 + Math.round(avg(opportunities.map((item) => item.score)) / 8));
  const riskIndex = Math.min(95, 35 + risks.length * 6 + Math.round(avg(risks.map((item) => item.score)) / 10));
  return {
    totalItems: signals.length,
    opportunityIndex,
    riskIndex,
    highPriority: signals.filter((item) => item.priority === "高").length
  };
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function collectFeed(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "CHJ-AI-Strategic-Radar/1.0 (+public intelligence demo)"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const xml = await response.text();
    return parseRss(xml, source);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const sourceConfig = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  if (DRY_RUN) {
    console.log(`Dry run OK. ${sourceConfig.feeds.length} feeds configured.`);
    return;
  }

  const settled = await Promise.allSettled(sourceConfig.feeds.map(collectFeed));
  const errors = settled
    .map((result, index) => ({ result, source: sourceConfig.feeds[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, source }) => ({ source: source.name, error: result.reason?.message ?? String(result.reason) }));

  const rawSignals = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  let signals = dedupe(rawSignals)
    .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_TOTAL);
  let mode = "live";

  if (!signals.length) {
    const fallback = JSON.parse(await fs.readFile(SEED_PATH, "utf8"));
    signals = fallback.signals ?? [];
    mode = "fallback";
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    mode,
    summary: buildSummary(signals),
    errors,
    signals
  };

  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const day = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(ARCHIVE_DIR, `${day}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Collected ${signals.length} signals. ${errors.length} source errors.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
