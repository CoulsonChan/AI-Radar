const MARKET_SOURCES = [
  { id: "au9999", secid: "118.AU9999", name: "上金所 Au99.99", scale: 100, unit: "CNY/g", primary: true },
  { id: "autd", secid: "118.AUTD", name: "黄金 T+D", scale: 100, unit: "CNY/g" },
  { id: "xau-usd", secid: "122.XAU", name: "伦敦现货金", scale: 100, unit: "USD/oz" },
  { id: "comex-gold", secid: "101.GC00Y", name: "COMEX 黄金", scale: 10, unit: "USD/oz" }
];

const INTEL_TREND_START = new Date(2026, 6, 19);

const state = {
  data: null,
  productBrand: "all",
  market: null,
  marketTimer: null
};

const el = {
  updateTime: document.querySelector("#updateTime"),
  modeLabel: document.querySelector("#modeLabel"),
  goldPrice: document.querySelector("#goldPrice"),
  goldChange: document.querySelector("#goldChange"),
  goldMeta: document.querySelector("#goldMeta"),
  goldSparkline: document.querySelector("#goldSparkline"),
  goldSecondary: document.querySelector("#goldSecondary"),
  intelTotal: document.querySelector("#intelTotal"),
  intelTrendChart: document.querySelector("#intelTrendChart"),
  products: document.querySelector("#products"),
  productFilters: document.querySelector("#productFilters"),
  productStatus: document.querySelector("#productStatus")
};

async function loadIntel() {
  const response = await fetch(`./data/intel.json?t=${Date.now()}`);
  if (!response.ok) throw new Error(`无法读取情报数据：${response.status}`);
  state.data = await response.json();
  render();
}

function render() {
  const data = state.data;
  const generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;
  el.updateTime.textContent = generatedAt ? `数据更新：${formatDate(generatedAt)}` : "数据更新：未知";
  el.modeLabel.textContent = data.mode === "live" ? "自动采集" : "兜底数据";

  state.market = data.goldMarket ?? (data.gold ? { primary: data.gold, secondary: [], history: [] } : null);
  renderMarket(state.market);
  renderIntelTrend(data.signals ?? []);
  renderProducts(data.products ?? [], data.productCollection ?? {});
  startMarketPolling();
}

function startMarketPolling() {
  if (state.marketTimer) clearInterval(state.marketTimer);
  refreshMarket(true).catch(() => {});
  state.marketTimer = setInterval(() => refreshMarket(false).catch(() => {}), 60_000);
}

async function refreshMarket(includeTrend) {
  const settled = await Promise.allSettled(MARKET_SOURCES.map(fetchMarketQuote));
  const quotes = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const primary = quotes.find((item) => item.id === "au9999");
  if (!primary) throw new Error("国内金价暂不可用");

  let history = state.market?.history ?? [];
  if (includeTrend) {
    history = await fetchMarketTrend(MARKET_SOURCES[0]).catch(() => history);
  } else {
    const point = { time: formatMarketPointTime(primary.updatedAt), price: primary.price };
    if (history.at(-1)?.time !== point.time) history = [...history.slice(-71), point];
  }

  state.market = {
    primary,
    secondary: quotes.filter((item) => item.id !== "au9999"),
    history,
    refreshSeconds: 60,
    checkedAt: new Date().toISOString(),
    status: "live"
  };
  renderMarket(state.market);
}

async function fetchMarketQuote(source) {
  const url = new URL("https://push2.eastmoney.com/api/qt/stock/get");
  url.searchParams.set("secid", source.secid);
  url.searchParams.set("fields", "f43,f44,f45,f46,f57,f58,f60,f86,f170");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${source.name} ${response.status}`);
  const data = (await response.json()).data;
  const price = Number(data?.f43) / source.scale;
  const previousClose = Number(data?.f60) / source.scale;
  if (!Number.isFinite(price)) throw new Error(`${source.name} 行情字段缺失`);
  return {
    id: source.id,
    symbol: data?.f57 ?? source.secid,
    source: source.name,
    price: Number(price.toFixed(2)),
    previousClose: Number.isFinite(previousClose) ? Number(previousClose.toFixed(2)) : null,
    open: Number.isFinite(Number(data?.f46)) ? Number((Number(data.f46) / source.scale).toFixed(2)) : null,
    high: Number.isFinite(Number(data?.f44)) ? Number((Number(data.f44) / source.scale).toFixed(2)) : null,
    low: Number.isFinite(Number(data?.f45)) ? Number((Number(data.f45) / source.scale).toFixed(2)) : null,
    change: Number.isFinite(previousClose) ? Number((price - previousClose).toFixed(2)) : null,
    changePercent: Number.isFinite(Number(data?.f170)) ? Number((Number(data.f170) / 100).toFixed(2)) : null,
    unit: source.unit,
    updatedAt: new Date((Number(data?.f86) || Date.now() / 1000) * 1000).toISOString(),
    status: "live"
  };
}

async function fetchMarketTrend(source) {
  const url = new URL("https://push2his.eastmoney.com/api/qt/stock/trends2/get");
  url.searchParams.set("secid", source.secid);
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58");
  url.searchParams.set("ndays", "1");
  url.searchParams.set("iscr", "0");
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`日内走势 ${response.status}`);
  const trends = (await response.json()).data?.trends ?? [];
  const points = trends.map((row) => {
    const [time, rawPrice] = row.split(",");
    const price = Number(rawPrice);
    return Number.isFinite(price) ? { time, price } : null;
  }).filter(Boolean);
  const step = Math.max(1, Math.floor(points.length / 72));
  const sampled = points.filter((_, index) => index % step === 0);
  const last = points.at(-1);
  if (last && sampled.at(-1)?.time !== last.time) sampled.push(last);
  return sampled;
}

function renderMarket(market) {
  const primary = market?.primary;
  if (!primary || !Number.isFinite(Number(primary.price))) {
    el.goldPrice.textContent = "暂无数据";
    el.goldChange.textContent = "--";
    el.goldMeta.textContent = "等待下一次行情刷新";
    el.goldSparkline.innerHTML = '<div class="chart-empty">行情走势暂不可用</div>';
    el.goldSecondary.innerHTML = '<div class="chart-empty">辅助行情暂不可用</div>';
    return;
  }

  el.goldPrice.textContent = `${formatPrice(primary.price)} ${primary.unit ?? "CNY/g"}`;
  setChange(el.goldChange, primary);
  const range = [
    Number.isFinite(Number(primary.open)) ? `开 ${formatPrice(primary.open)}` : null,
    Number.isFinite(Number(primary.high)) ? `高 ${formatPrice(primary.high)}` : null,
    Number.isFinite(Number(primary.low)) ? `低 ${formatPrice(primary.low)}` : null
  ].filter(Boolean).join(" · ");
  el.goldMeta.textContent = `${range ? `${range} · ` : ""}${formatTime(new Date(primary.updatedAt ?? Date.now()))}`;
  el.goldSparkline.innerHTML = buildSparkline(market.history ?? []);

  const secondary = market.secondary ?? [];
  el.goldSecondary.innerHTML = secondary.length ? secondary.map((item) => `
    <div class="secondary-quote">
      <div>
        <b>${escapeHtml(item.source)}</b>
        <span>${escapeHtml(item.unit ?? "")}</span>
      </div>
      <div class="secondary-value">
        <strong>${formatPrice(item.price)}</strong>
        <span class="${changeClass(item.changePercent)}">${formatPercent(item.changePercent)}</span>
      </div>
    </div>
  `).join("") : '<div class="chart-empty">辅助行情暂不可用</div>';
}

function setChange(node, quote) {
  node.className = `quote-change ${changeClass(quote.changePercent)}`;
  const change = Number(quote.change);
  const changeText = Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}` : "--";
  node.textContent = `${changeText} / ${formatPercent(quote.changePercent)}`;
}

function buildSparkline(history) {
  const points = history.filter((item) => Number.isFinite(Number(item.price)));
  if (points.length < 2) return '<div class="chart-empty">正在积累日内走势</div>';
  const width = 720;
  const height = 150;
  const left = 12;
  const right = 10;
  const top = 18;
  const bottom = 24;
  const values = points.map((item) => Number(item.price));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);
  const coords = points.map((item, index) => ({
    x: left + (index / Math.max(points.length - 1, 1)) * (width - left - right),
    y: top + ((max - Number(item.price)) / range) * (height - top - bottom)
  }));
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const last = coords.at(-1);
  const firstLabel = formatTrendLabel(points[0].time);
  const lastLabel = formatTrendLabel(points.at(-1).time);
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Au99.99 日内价格走势" preserveAspectRatio="none">
      <line class="chart-gridline" x1="${left}" y1="${top}" x2="${width - right}" y2="${top}"></line>
      <line class="chart-gridline" x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}"></line>
      <path class="sparkline-path" d="${line}"></path>
      <circle class="sparkline-point" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4"></circle>
      <text class="chart-label" x="${left}" y="${height - 5}">${escapeHtml(firstLabel)}</text>
      <text class="chart-label" x="${width - right}" y="${height - 5}" text-anchor="end">${escapeHtml(lastLabel)}</text>
      <text class="chart-value-label" x="${left}" y="12">${max.toFixed(2)}</text>
      <text class="chart-value-label" x="${left}" y="${height - bottom - 5}">${min.toFixed(2)}</text>
    </svg>
  `;
}

function renderIntelTrend(signals) {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rollingStart = new Date(today);
  rollingStart.setDate(today.getDate() - 29);
  const start = rollingStart > INTEL_TREND_START ? rollingStart : new Date(INTEL_TREND_START);
  for (const date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) {
    days.push({ date: new Date(date), key: dayKey(date), count: 0 });
  }
  const byKey = new Map(days.map((item) => [item.key, item]));
  signals.forEach((signal) => {
    const published = new Date(signal.publishedAt);
    const bucket = Number.isNaN(published.getTime()) ? null : byKey.get(dayKey(published));
    if (bucket) bucket.count += 1;
  });
  el.intelTotal.textContent = `${days.reduce((total, item) => total + item.count, 0)} 条`;
  el.intelTrendChart.innerHTML = buildThirtyDayChart(days);
}

function buildThirtyDayChart(days) {
  const width = 1000;
  const height = 260;
  const left = 44;
  const right = 18;
  const top = 24;
  const bottom = 42;
  const max = Math.max(1, ...days.map((item) => item.count));
  const coords = days.map((item, index) => ({
    x: left + (index / Math.max(days.length - 1, 1)) * (width - left - right),
    y: top + ((max - item.count) / max) * (height - top - bottom),
    ...item
  }));
  const line = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const grid = [0, 0.5, 1].map((ratio) => {
    const y = top + ratio * (height - top - bottom);
    const value = Math.round(max * (1 - ratio));
    return `<line class="chart-gridline" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>`;
  }).join("");
  const labelStep = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5;
  const shouldLabel = (index) => index % labelStep === 0 || index === days.length - 1;
  const points = coords.map((point) => `<circle class="trend-point" cx="${point.x}" cy="${point.y}" r="4"><title>${point.date.getMonth() + 1}月${point.date.getDate()}日：${point.count} 条</title></circle>`).join("");
  const yLabels = [0, 0.5, 1].map((ratio) => {
    const value = Math.round(max * (1 - ratio));
    const topPosition = top + ratio * (height - top - bottom);
    return `<span class="trend-y-label" style="top:${topPosition}px">${value}</span>`;
  }).join("");
  const pointLabels = coords.map((point, index) => shouldLabel(index) ? `
    <strong class="trend-count-label" style="left:${(point.x / width) * 100}%;top:${Math.max(2, point.y - 24)}px">${point.count}</strong>
    <span class="trend-date-label" style="left:${(point.x / width) * 100}%">${point.date.getMonth() + 1}月${point.date.getDate()}日</span>
  ` : "").join("");
  return `
    <div class="trend-plot">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="最近三十日公开情报数量" preserveAspectRatio="none">
        ${grid}
        <path class="trend-path" d="${line}"></path>
        ${points}
      </svg>
      ${yLabels}
      ${pointLabels}
    </div>
  `;
}

function renderProducts(products, collection) {
  const configuredBrands = (collection.stores ?? []).map((store) => store.brand);
  const brands = [...new Set([...configuredBrands, ...products.map((item) => item.brand).filter(Boolean)])];
  if (state.productBrand !== "all" && !brands.includes(state.productBrand)) state.productBrand = "all";
  const counts = new Map(brands.map((brand) => [brand, products.filter((item) => item.brand === brand).length]));

  el.productFilters.innerHTML = ["all", ...brands].map((brand) => `
    <button class="product-filter${state.productBrand === brand ? " active" : ""}" type="button" data-brand="${escapeHtml(brand)}">
      ${brand === "all" ? "全部品牌" : escapeHtml(brand)}<span>${brand === "all" ? products.length : counts.get(brand) ?? 0}</span>
    </button>
  `).join("");

  el.productFilters.querySelectorAll(".product-filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.productBrand = button.dataset.brand;
      renderProducts(products, collection);
    });
  });

  const visible = (state.productBrand === "all" ? products : products.filter((item) => item.brand === state.productBrand))
    .slice(0, state.productBrand === "all" ? 48 : 12);
  const totalStores = collection.stores?.length ?? 0;
  const successfulStores = collection.successfulStores ?? 0;
  el.productStatus.textContent = `${products.length} 件官网新品 · ${successfulStores}/${totalStores} 个来源正常 · 按官网发布时间降序（无日期按首次发现）`;

  if (!visible.length) {
    el.products.innerHTML = '<div class="empty product-empty">当前品牌暂无可展示商品。</div>';
    return;
  }

  el.products.innerHTML = visible.map((item) => {
    const observedAt = item.sourcePublishedAt ?? item.firstSeenAt;
    const dateLabel = item.sourcePublishedAt ? "官网发布" : "首次发现";
    const image = item.image
      ? `<img src="${safeAttr(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="product-placeholder">${escapeHtml(item.brand)}</div>`;
    return `
      <article class="product-card">
        <a class="product-image" href="${safeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
          ${image}
          ${item.isNew ? '<span class="new-badge">新发现</span>' : ""}
        </a>
        <div class="product-content">
          <div class="product-brand">${escapeHtml(item.brand)} · ${escapeHtml(item.platform ?? "品牌官网")}</div>
          <h3><a href="${safeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
          <div class="product-foot">
            <strong>${escapeHtml(item.priceLabel ?? "价格见官网")}</strong>
            <span>${dateLabel} ${formatShortDate(new Date(observedAt ?? Date.now()))}</span>
          </div>
        </div>
      </article>
    `;
  }).join("");

  el.products.querySelectorAll(".product-image img").forEach((image) => {
    image.addEventListener("error", () => {
      const placeholder = document.createElement("div");
      placeholder.className = "product-placeholder";
      placeholder.textContent = image.alt || "品牌新品";
      image.replaceWith(placeholder);
    }, { once: true });
  });
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number >= 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function changeClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "flat";
  return number > 0 ? "positive" : "negative";
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMarketPointTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${dayKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTrendLabel(value) {
  const text = String(value ?? "");
  return text.includes(" ") ? text.split(" ").at(-1).slice(0, 5) : text.slice(-5);
}

function formatDate(date) {
  if (Number.isNaN(date.getTime())) return "日期未知";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTime(date) {
  if (Number.isNaN(date.getTime())) return "时间未知";
  return `更新 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function formatShortDate(date) {
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAttr(value) {
  const text = String(value ?? "#");
  if (text === "#" || text.startsWith("https://") || text.startsWith("http://")) return escapeHtml(text);
  return "#";
}

loadIntel().catch((error) => {
  el.productStatus.textContent = error.message;
  el.products.innerHTML = '<div class="empty product-empty">新品数据读取失败，请稍后刷新。</div>';
  startMarketPolling();
});
