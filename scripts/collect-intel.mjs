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
const PRODUCT_NEW_WINDOW_HOURS = 72;
const GOLD_SOURCES = [
  {
    id: "gc-futures",
    name: "COMEX Gold Futures",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=1m",
    unit: "USD/oz"
  },
  {
    id: "xau-usd",
    name: "XAU/USD Spot",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X?range=1d&interval=1m",
    unit: "USD/oz"
  }
];

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

function extractHtmlText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html, fallback) {
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return title || fallback;
}

function absoluteUrl(value, baseUrl) {
  const cleaned = decodeXml(String(value ?? ""))
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/")
    .trim();
  if (!cleaned || cleaned.startsWith("data:")) return null;
  try {
    return new URL(cleaned.startsWith("//") ? `https:${cleaned}` : cleaned, baseUrl).href;
  } catch {
    return null;
  }
}

function readAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return decodeXml(match?.[1] ?? "");
}

function cleanProductTitle(value) {
  return stripHtml(value)
    .replace(/^\s*(?:新品|New)\s*/i, "")
    .replace(/\s+-\s+Swarovski,?\s*\d+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createProduct(store, fields, previousById) {
  const now = new Date().toISOString();
  const id = `${store.id}:${fields.productId}`;
  const previous = previousById.get(id);
  const firstSeenAt = previous?.firstSeenAt ?? now;
  const ageHours = Math.max(0, (Date.now() - Date.parse(firstSeenAt)) / 36e5);
  return {
    id,
    productId: fields.productId,
    storeId: store.id,
    brand: store.brand,
    storeName: store.name,
    platform: store.platform,
    title: fields.title || previous?.title || "未命名商品",
    price: fields.price ?? previous?.price ?? null,
    currency: fields.currency ?? previous?.currency ?? null,
    priceLabel: fields.priceLabel ?? previous?.priceLabel ?? null,
    url: fields.url || previous?.url || store.storeUrl,
    image: fields.image || previous?.image || null,
    listedOrder: fields.listedOrder,
    sourcePublishedAt: Object.hasOwn(fields, "sourcePublishedAt")
      ? fields.sourcePublishedAt
      : previous?.sourcePublishedAt ?? null,
    firstSeenAt,
    lastSeenAt: now,
    isNew: ageHours <= PRODUCT_NEW_WINDOW_HOURS,
    official: true
  };
}

function parseCtfProducts(html, store, previousById) {
  const products = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1];
    const href = readAttribute(attributes, "href");
    const idMatch = href.match(/\/jewelry\/[^"']*\/info_(\d+)\.(?:html|aspx)/i);
    if (!idMatch || seen.has(idMatch[1]) || !/<h3\b/i.test(match[2])) continue;
    const title = cleanProductTitle(match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "");
    const imageValue = match[2].match(/<img\b[^>]*(?:src|data-src|data-original)=["']([^"']+)["']/i)?.[1];
    const image = absoluteUrl(imageValue, store.url);
    if (!title) continue;
    seen.add(idMatch[1]);
    products.push(createProduct(store, {
      productId: idMatch[1],
      title,
      priceLabel: "官网未展示价格",
      url: absoluteUrl(href, store.url),
      image,
      listedOrder: products.length + 1,
      sourcePublishedAt: null
    }, previousById));
    if (products.length >= (store.maxItems ?? 8)) break;
  }
  return products;
}

function parseSwarovskiProducts(html, store, previousById) {
  const products = [];
  const seen = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1];
    const href = readAttribute(attributes, "href");
    if (!href.includes("/p-")) continue;
    const variant = readAttribute(attributes, "data-gtm-product-variant")
      || href.match(/[?&]variantID=(\d+)/i)?.[1]
      || readAttribute(attributes, "data-gtm-product-id");
    if (!variant || seen.has(variant)) continue;
    const alt = match[2].match(/<img\b[^>]*alt=["']([^"']+)["']/i)?.[1] ?? "";
    const title = cleanProductTitle(alt);
    const price = Number(readAttribute(attributes, "data-gtm-product-price"));
    const srcset = match[2].match(/<source\b[^>]*srcset=["']([^"']+)["']/i)?.[1];
    const imageValue = srcset?.split(/\s+\d+(?:\.\d+)?x\s*,/)[0]?.trim()
      || match[2].match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i)?.[1];
    if (!title) continue;
    seen.add(variant);
    products.push(createProduct(store, {
      productId: variant,
      title,
      price: Number.isFinite(price) ? price : null,
      currency: Number.isFinite(price) ? "CNY" : null,
      priceLabel: Number.isFinite(price) ? `${price.toLocaleString("zh-CN")} 元` : null,
      url: absoluteUrl(href, store.url),
      image: absoluteUrl(imageValue, store.url),
      listedOrder: products.length + 1
    }, previousById));
    if (products.length >= (store.maxItems ?? 8)) break;
  }
  return products;
}

function parseShopifyProducts(html, store, previousById) {
  const normalized = html.replaceAll("\\/", "/");
  const products = [];
  const seen = new Set();
  const headingPattern = /<h3\b[^>]*class=["'][^"']*card__heading[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi;
  for (const match of normalized.matchAll(headingPattern)) {
    const heading = match[1];
    const href = heading.match(/<a\b[^>]*href=["']([^"']*\/products\/([a-z0-9][a-z0-9-]+)[^"']*)["'][^>]*>/i);
    const slug = href?.[2];
    const title = cleanProductTitle(heading);
    if (!slug || seen.has(slug) || !title) continue;
    const start = Math.max(0, (match.index ?? 0) - 5200);
    const end = Math.min(normalized.length, (match.index ?? 0) + 3600);
    const before = normalized.slice(start, match.index ?? 0);
    const after = normalized.slice(match.index ?? 0, end);
    const imageTags = [...before.matchAll(/<img\b[^>]*>/gi)];
    const imageAttributes = [...imageTags].reverse()
      .find((candidate) => cleanProductTitle(readAttribute(candidate[0], "alt")) === title)?.[0]
      ?? [...imageTags].reverse().find((candidate) => /alt=["'][^"']{4,}["']/i.test(candidate[0]))?.[0]
      ?? "";
    const imageValue = readAttribute(imageAttributes, "src")
      || readAttribute(imageAttributes, "data-src")
      || readAttribute(imageAttributes, "srcset").split(/[ ,]/)[0];
    const priceText = stripHtml(after).match(/(?:From\s+)?(?:HK\$|US\$|\$)\s?[\d,.]+(?:\.\d{2})?(?:\s+(?:HKD|USD))?/i)?.[0] ?? null;
    seen.add(slug);
    products.push(createProduct(store, {
      productId: slug,
      title,
      priceLabel: priceText,
      currency: priceText?.includes("HK$") || priceText?.includes("HKD") ? "HKD" : priceText ? "USD" : null,
      url: absoluteUrl(href[1], store.url),
      image: absoluteUrl(imageValue, store.url),
      listedOrder: products.length + 1
    }, previousById));
    if (products.length >= (store.maxItems ?? 8)) break;
  }
  return products;
}

function parseShopifyJsonProducts(json, store, previousById) {
  const data = JSON.parse(json);
  const sourceProducts = Array.isArray(data.products) ? data.products : [];
  return sourceProducts
    .sort((a, b) => Date.parse(b.published_at ?? b.created_at ?? 0) - Date.parse(a.published_at ?? a.created_at ?? 0))
    .slice(0, store.maxItems ?? 8)
    .map((item, index) => {
      const variant = item.variants?.find((candidate) => candidate.available) ?? item.variants?.[0];
      const price = Number(variant?.price);
      const publishedAt = item.published_at ?? item.created_at;
      return createProduct(store, {
        productId: String(item.id),
        title: cleanProductTitle(item.title),
        price: Number.isFinite(price) ? price : null,
        currency: Number.isFinite(price) ? store.currency ?? null : null,
        priceLabel: Number.isFinite(price)
          ? `${store.currencySymbol ?? ""}${price.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${store.currencySuffix ?? ""}`
          : null,
        url: absoluteUrl(`/products/${item.handle}`, store.storeUrl ?? store.url),
        image: absoluteUrl(item.images?.[0]?.src ?? item.image?.src, store.storeUrl ?? store.url),
        listedOrder: index + 1,
        sourcePublishedAt: Number.isNaN(Date.parse(publishedAt)) ? null : new Date(publishedAt).toISOString()
      }, previousById);
    });
}

function parseLukfookApiProducts(json, store, previousById) {
  const data = JSON.parse(json);
  const sourceProducts = data.DataResponse?.itemList;
  if (!Array.isArray(sourceProducts)) return [];
  return sourceProducts.slice(0, store.maxItems ?? 8).map((item, index) => {
    const price = Number(item.fprice);
    return createProduct(store, {
      productId: item.fmould || item.fid,
      title: cleanProductTitle(item.fname),
      price: Number.isFinite(price) ? price : null,
      currency: Number.isFinite(price) ? "CNY" : null,
      priceLabel: Number.isFinite(price) ? `¥ ${price.toLocaleString("zh-CN")}` : null,
      url: absoluteUrl(`/lfg-category/${item.fcategoryparentename || item.fcategoryename}/${item.fmould}`, store.storeUrl),
      image: absoluteUrl(item.fimage, store.imageBaseUrl ?? store.storeUrl),
      listedOrder: index + 1,
      sourcePublishedAt: Number.isNaN(Date.parse(item.date)) ? null : new Date(item.date).toISOString()
    }, previousById);
  });
}

function parseChowSangSangJsonProducts(json, store, previousById) {
  const data = JSON.parse(json);
  const sourceProducts = data.productRefinements?.[0]?.productList;
  if (!Array.isArray(sourceProducts)) return [];
  return sourceProducts.slice(0, store.maxItems ?? 8).map((item, index) => {
    const price = Number(item.price ?? item.originalPrice);
    return createProduct(store, {
      productId: item.productCode || item.documentId,
      title: cleanProductTitle(item.name2 || item.name),
      price: Number.isFinite(price) ? price : null,
      currency: Number.isFinite(price) ? "HKD" : null,
      priceLabel: Number.isFinite(price) ? `HK$ ${price.toLocaleString("zh-CN")}` : null,
      url: absoluteUrl(`${store.productBaseUrl?.replace(/\/$/, "") ?? ""}${item.productDetailUrl}`, store.storeUrl),
      image: absoluteUrl(item.imageUrl, store.storeUrl),
      listedOrder: index + 1
    }, previousById);
  });
}

function parseTmallProducts(html, store, previousById) {
  const normalized = decodeXml(html).replaceAll("\\/", "/").replaceAll("\\u002F", "/");
  const products = [];
  const seen = new Set();
  const linkPattern = /(?:https?:)?\/\/detail\.(?:tmall|taobao)\.com\/item\.htm[^"'<>\s]*?[?&]id=(\d+)[^"'<>\s]*/gi;
  for (const match of normalized.matchAll(linkPattern)) {
    const productId = match[1];
    if (seen.has(productId)) continue;
    const start = Math.max(0, (match.index ?? 0) - 1800);
    const end = Math.min(normalized.length, (match.index ?? 0) + 2600);
    const block = normalized.slice(start, end);
    const imageTag = [...block.matchAll(/<img\b[^>]*>/gi)].find((candidate) => /alt=["'][^"']{4,}["']/i.test(candidate[0]));
    const title = cleanProductTitle(readAttribute(imageTag?.[0] ?? "", "alt"));
    const imageValue = readAttribute(imageTag?.[0] ?? "", "data-ks-lazyload")
      || readAttribute(imageTag?.[0] ?? "", "data-src")
      || readAttribute(imageTag?.[0] ?? "", "src");
    const priceText = stripHtml(block).match(/(?:¥|￥)\s?[\d,.]+(?:\.\d{1,2})?/i)?.[0] ?? null;
    if (!title) continue;
    seen.add(productId);
    products.push(createProduct(store, {
      productId,
      title,
      priceLabel: priceText,
      currency: priceText ? "CNY" : null,
      url: absoluteUrl(match[0], store.url),
      image: absoluteUrl(imageValue, store.url),
      listedOrder: products.length + 1
    }, previousById));
    if (products.length >= (store.maxItems ?? 8)) break;
  }
  return products;
}

function parseStoreProducts(html, store, previousById, parserType = store.type) {
  if (parserType === "ctf-html") return parseCtfProducts(html, store, previousById);
  if (parserType === "swarovski-html") return parseSwarovskiProducts(html, store, previousById);
  if (parserType === "shopify-html") return parseShopifyProducts(html, store, previousById);
  if (parserType === "shopify-json") return parseShopifyJsonProducts(html, store, previousById);
  if (parserType === "lukfook-api") return parseLukfookApiProducts(html, store, previousById);
  if (parserType === "chowsangsang-json") return parseChowSangSangJsonProducts(html, store, previousById);
  if (parserType === "tmall-html") return parseTmallProducts(html, store, previousById);
  throw new Error(`Unsupported product source type: ${parserType}`);
}

function parseOfficialPage(html, source) {
  const text = extractHtmlText(html);
  const title = extractTitle(html, source.name);
  const snippets = text
    .split(/(?<=[。.!?？])\s+|\s{2,}/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 10 && item.length <= 120)
    .filter((item) => /新品|新闻|公告|门店|品牌|珠宝|黄金|jewel|press|release|store|collection|diamond|sustain/i.test(item))
    .slice(0, 3);

  return enrichSignal({
    id: hash(`official|${source.id}|${title}`),
    title: `${source.name} 官方更新入口`,
    summary: snippets.join(" / ") || title,
    source: `${source.name}官网`,
    sourceId: source.id,
    group: "competitor",
    url: source.url,
    publishedAt: new Date().toISOString(),
    weight: 1.25,
    official: true,
    focus: source.focus
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
    confidence: signal.official ? "竞品官方网站，需人工复核页面更新" : "公开网络情报，需人工复核"
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

async function collectOfficialPage(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "user-agent": "CHJ-AI-Strategic-Radar/1.0 (+official competitor source monitor)"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    return parseOfficialPage(html, source);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProductHtml(url, store, parserType) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const request = {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
        "cache-control": "no-cache",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 CHJ-Radar/1.0",
        "referer": store.storeUrl ?? url
      }
    };
    if (parserType === "lukfook-api") {
      request.method = "POST";
      request.headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      request.body = new URLSearchParams({
        DataRequest: JSON.stringify({
          frow: store.maxItems ?? 8,
          fpage: 1,
          fcounttypeList: [],
          applicationidList: [],
          textureidList: [],
          categoryidList: [],
          seriesidList: [],
          priceFlage: "",
          dateFlage: 1,
          fsalesFlage: "",
          startPrice: null,
          endPrice: null
        }),
        SID: ""
      });
    }
    const response = await fetch(url, request);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    if (/login\.taobao\.com|sec\.taobao\.com|punish/i.test(response.url)
      || /<title[^>]*>[^<]*(?:安全验证|验证码|登录淘宝)[^<]*<\/title>/i.test(html.slice(0, 12000))) {
      throw new Error("页面要求登录或安全验证");
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function collectProductStore(store, previousById) {
  const attempts = [
    { url: store.url, parserType: store.type },
    ...(store.fallbackUrl ? [{ url: store.fallbackUrl, parserType: "tmall-html" }] : [])
  ];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const html = await fetchProductHtml(attempt.url, store, attempt.parserType);
      const products = parseStoreProducts(html, store, previousById, attempt.parserType);
      if (!products.length) throw new Error("页面可访问，但未识别到商品卡片");
      return { store, products, sourceUrl: attempt.url };
    } catch (error) {
      failures.push(`${attempt.url}: ${error.message}`);
    }
  }
  throw new Error(failures.join(" | "));
}

async function collectGoldPrice() {
  for (const source of GOLD_SOURCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(source.url, {
        signal: controller.signal,
        headers: { "user-agent": "CHJ-AI-Strategic-Radar/1.0" }
      });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const data = await response.json();
      const result = data.chart?.result?.[0];
      const meta = result?.meta;
      const regularMarketPrice = Number(meta?.regularMarketPrice);
      const previousClose = Number(meta?.chartPreviousClose ?? meta?.previousClose);
      if (!Number.isFinite(regularMarketPrice)) continue;
      const change = Number.isFinite(previousClose) ? regularMarketPrice - previousClose : null;
      const changePercent = Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : null;
      return {
        source: source.name,
        symbol: source.id,
        price: Number(regularMarketPrice.toFixed(2)),
        unit: source.unit,
        change: change == null ? null : Number(change.toFixed(2)),
        changePercent: changePercent == null ? null : Number(changePercent.toFixed(2)),
        updatedAt: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
        status: "live"
      };
    } catch {
      // Try next source.
    }
  }

  return {
    source: "兜底样例",
    symbol: "gold-demo",
    price: 2350,
    unit: "USD/oz",
    change: null,
    changePercent: null,
    updatedAt: new Date().toISOString(),
    status: "fallback"
  };
}

async function main() {
  const sourceConfig = JSON.parse(await fs.readFile(SOURCES_PATH, "utf8"));
  if (DRY_RUN) {
    console.log(`Dry run OK. ${sourceConfig.feeds.length} feeds and ${(sourceConfig.productStores ?? []).length} product stores configured.`);
    return;
  }

  const previousData = await fs.readFile(OUT_PATH, "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => ({}));
  const previousProducts = previousData.products ?? [];
  const previousById = new Map(previousProducts.map((item) => [item.id, item]));
  const gold = await collectGoldPrice();
  const settled = await Promise.allSettled(sourceConfig.feeds.map(collectFeed));
  const officialSettled = await Promise.allSettled((sourceConfig.officialCompetitors ?? []).map(collectOfficialPage));
  const productStores = sourceConfig.productStores ?? [];
  const productSettled = await Promise.allSettled(productStores.map((store) => collectProductStore(store, previousById)));
  const errors = settled
    .map((result, index) => ({ result, source: sourceConfig.feeds[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, source }) => ({ source: source.name, error: result.reason?.message ?? String(result.reason) }));
  const officialErrors = officialSettled
    .map((result, index) => ({ result, source: sourceConfig.officialCompetitors?.[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, source }) => ({ source: source?.name ?? "official", error: result.reason?.message ?? String(result.reason) }));
  const productErrors = productSettled
    .map((result, index) => ({ result, source: productStores[index] }))
    .filter(({ result }) => result.status === "rejected")
    .map(({ result, source }) => ({ source: source?.name ?? "product-store", type: "product", error: result.reason?.message ?? String(result.reason) }));

  const successfulProductResults = productSettled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const successfulStoreIds = new Set(successfulProductResults.map((result) => result.store.id));
  const collectedProducts = successfulProductResults.flatMap((result) => result.products);
  const retainedProducts = previousProducts
    .filter((product) => !successfulStoreIds.has(product.storeId))
    .map((product) => ({
      ...product,
      isNew: Math.max(0, (Date.now() - Date.parse(product.firstSeenAt ?? 0)) / 36e5) <= PRODUCT_NEW_WINDOW_HOURS
    }));
  const products = [...collectedProducts, ...retainedProducts]
    .sort((a, b) => Date.parse(b.sourcePublishedAt ?? b.firstSeenAt) - Date.parse(a.sourcePublishedAt ?? a.firstSeenAt)
      || a.listedOrder - b.listedOrder)
    .slice(0, 48);
  const productCollection = {
    checkedAt: new Date().toISOString(),
    totalItems: products.length,
    newItems: products.filter((product) => product.isNew).length,
    successfulStores: successfulStoreIds.size,
    failedStores: productErrors.length,
    stores: productStores.map((store, index) => {
      const result = productSettled[index];
      return {
        id: store.id,
        brand: store.brand,
        name: store.name,
        platform: store.platform,
        url: store.storeUrl ?? store.url,
        status: result?.status === "fulfilled" ? "ok" : "failed",
        count: result?.status === "fulfilled" ? result.value.products.length : previousProducts.filter((item) => item.storeId === store.id).length,
        message: result?.status === "rejected" ? (result.reason?.message ?? String(result.reason)) : null
      };
    })
  };

  const rawSignals = [
    ...officialSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    ...settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])
  ];
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
    gold,
    products,
    productCollection,
    officialCompetitors: sourceConfig.officialCompetitors ?? [],
    summary: buildSummary(signals),
    errors: [...errors, ...officialErrors, ...productErrors],
    signals
  };

  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  const day = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(ARCHIVE_DIR, `${day}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Collected ${signals.length} signals and ${products.length} products. ${errors.length + officialErrors.length + productErrors.length} source errors.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
