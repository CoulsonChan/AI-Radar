const state = {
  data: null,
  filter: "all",
  productBrand: "all"
};

const el = {
  updateTime: document.querySelector("#updateTime"),
  modeLabel: document.querySelector("#modeLabel"),
  totalItems: document.querySelector("#totalItems"),
  opportunityIndex: document.querySelector("#opportunityIndex"),
  riskIndex: document.querySelector("#riskIndex"),
  goldPrice: document.querySelector("#goldPrice"),
  goldMeta: document.querySelector("#goldMeta"),
  signals: document.querySelector("#signals"),
  questions: document.querySelector("#questions"),
  actions: document.querySelector("#actions"),
  sourceStatus: document.querySelector("#sourceStatus"),
  officialCompetitors: document.querySelector("#officialCompetitors"),
  products: document.querySelector("#products"),
  productFilters: document.querySelector("#productFilters"),
  productStatus: document.querySelector("#productStatus"),
  tabs: document.querySelectorAll(".tab"),
  briefBtn: document.querySelector("#briefBtn"),
  briefBox: document.querySelector("#briefBox"),
  briefText: document.querySelector("#briefText"),
  refreshBtn: document.querySelector("#refreshBtn")
};

async function loadIntel() {
  const response = await fetch(`./data/intel.json?t=${Date.now()}`);
  if (!response.ok) throw new Error(`无法读取情报数据：${response.status}`);
  state.data = await response.json();
  render();
}

function render() {
  const data = state.data;
  const summary = data.summary ?? {};
  const generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;

  el.updateTime.textContent = generatedAt ? `更新时间：${formatDate(generatedAt)}` : "更新时间：未知";
  el.modeLabel.textContent = data.mode === "live" ? "自动采集" : "种子数据";
  el.totalItems.textContent = summary.totalItems ?? data.signals?.length ?? 0;
  el.opportunityIndex.textContent = summary.opportunityIndex ?? "-";
  el.riskIndex.textContent = summary.riskIndex ?? "-";
  el.briefText.textContent = buildBrief(data.signals ?? []);
  renderGold(data.gold);
  renderProducts(data.products ?? [], data.productCollection ?? {});
  renderOfficialCompetitors(data.officialCompetitors ?? [], data.signals ?? []);
  renderSignals();
  renderQuestions(data.signals ?? []);
  renderActions(data.signals ?? []);
  renderSourceStatus(data);
}

function renderProducts(products, collection) {
  const brands = [...new Set(products.map((item) => item.brand).filter(Boolean))];
  if (state.productBrand !== "all" && !brands.includes(state.productBrand)) {
    state.productBrand = "all";
  }

  el.productFilters.innerHTML = ["all", ...brands].map((brand) => `
    <button class="product-filter${state.productBrand === brand ? " active" : ""}" type="button" data-brand="${escapeHtml(brand)}">
      ${brand === "all" ? "全部品牌" : escapeHtml(brand)}
    </button>
  `).join("");

  el.productFilters.querySelectorAll(".product-filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.productBrand = button.dataset.brand;
      renderProducts(products, collection);
    });
  });

  const visible = state.productBrand === "all"
    ? interleaveProducts(products, brands).slice(0, 12)
    : products.filter((item) => item.brand === state.productBrand).slice(0, 12);
  const totalStores = collection.stores?.length ?? 0;
  const successfulStores = collection.successfulStores ?? 0;
  const newItems = products.filter((item) => item.isNew).length;
  const sourceText = totalStores ? `${successfulStores}/${totalStores} 个官网来源正常` : "等待官网采集";
  el.productStatus.textContent = `${newItems} 个近 72 小时新发现 · ${sourceText}`;

  if (!visible.length) {
    const storeLinks = (collection.stores ?? []).map((store) => `
      <a href="${safeAttr(store.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(store.brand)}</a>
    `).join(" · ");
    el.products.innerHTML = `<div class="empty product-empty">尚未完成首次商品采集。${storeLinks ? `可先查看 ${storeLinks}` : ""}</div>`;
    return;
  }

  el.products.innerHTML = visible.map((item) => {
    const observedAt = item.sourcePublishedAt ?? item.firstSeenAt;
    const dateLabel = item.sourcePublishedAt ? "官网日期" : "首次发现";
    const image = item.image
      ? `<img src="${safeAttr(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="product-placeholder">${escapeHtml(item.brand)}</div>`;
    return `
      <article class="product-card">
        <a class="product-image" href="${safeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
          ${image}
          ${item.isNew ? "<span class=\"new-badge\">新发现</span>" : ""}
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
}

function interleaveProducts(products, brands) {
  const queues = new Map(brands.map((brand) => [brand, products.filter((item) => item.brand === brand)]));
  const result = [];
  const maxLength = Math.max(0, ...[...queues.values()].map((items) => items.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const brand of brands) {
      const item = queues.get(brand)?.[index];
      if (item) result.push(item);
    }
  }
  return result;
}

async function renderGold(fallbackGold) {
  const gold = await fetchRealtimeGold().catch(() => fallbackGold);
  if (!gold || !Number.isFinite(Number(gold.price))) {
    el.goldPrice.textContent = "暂无数据";
    el.goldMeta.textContent = "实时行情读取失败，等待下一次自动采集。";
    return;
  }

  const changeText = gold.changePercent != null && Number.isFinite(Number(gold.changePercent))
    ? `，${Number(gold.changePercent) >= 0 ? "+" : ""}${Number(gold.changePercent).toFixed(2)}%`
    : "";
  el.goldPrice.textContent = `${Number(gold.price).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${gold.unit ?? "USD/oz"}`;
  el.goldMeta.textContent = `${gold.source ?? "Gold"} · ${gold.status === "live" ? "实时" : "兜底"} · ${formatDate(new Date(gold.updatedAt ?? Date.now()))}${changeText}`;
}

async function fetchRealtimeGold() {
  const providers = [
    {
      source: "COMEX Gold Futures",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=1d&interval=1m",
      unit: "USD/oz"
    },
    {
      source: "XAU/USD Spot",
      url: "https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X?range=1d&interval=1m",
      unit: "USD/oz"
    }
  ];

  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      const previousClose = Number(meta?.chartPreviousClose ?? meta?.previousClose);
      if (!Number.isFinite(price)) continue;
      const change = Number.isFinite(previousClose) ? price - previousClose : null;
      return {
        source: provider.source,
        price: Number(price.toFixed(2)),
        unit: provider.unit,
        change,
        changePercent: Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : null,
        updatedAt: new Date((meta?.regularMarketTime ?? Date.now() / 1000) * 1000).toISOString(),
        status: "live"
      };
    } catch {
      // Try next provider.
    }
  }
  throw new Error("gold price unavailable");
}

function renderOfficialCompetitors(competitors, signals) {
  const officialSignals = new Map(
    signals.filter((item) => item.official).map((item) => [item.sourceId, item])
  );

  el.officialCompetitors.innerHTML = competitors.map((item) => {
    const signal = officialSignals.get(item.id);
    const title = signal?.summary || item.focus;
    return `
      <a class="official-item" href="${safeAttr(item.url)}" target="_blank" rel="noopener noreferrer">
        <b>${escapeHtml(item.name)}</b>
        <span>${escapeHtml(title)}</span>
      </a>
    `;
  }).join("");
}

function renderSignals() {
  const signals = (state.data?.signals ?? []).filter((item) => {
    return state.filter === "all" || item.category === state.filter;
  });

  if (!signals.length) {
    el.signals.innerHTML = `<div class="empty">当前分类暂无情报。可以等待明日自动采集，或手动运行 GitHub Actions。</div>`;
    return;
  }

  el.signals.innerHTML = signals.map((item) => `
    <article class="signal-card">
      <div class="signal-head">
        <h3><a href="${safeAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
        <span class="badge">${escapeHtml(item.priority ?? "中")}</span>
      </div>
      <div class="signal-meta">
        <span>${escapeHtml(item.category ?? "未分类")}</span>
        <span>${escapeHtml(item.source ?? "未知来源")}</span>
        <span>${formatDate(new Date(item.publishedAt ?? Date.now()))}</span>
        ${item.official ? "<span>官网来源</span>" : ""}
      </div>
      <div class="signal-body">
        <div><b>对潮宏基影响</b>${escapeHtml(item.impact ?? "需人工补充判断。")}</div>
        <div><b>建议动作</b>${escapeHtml(item.action ?? "纳入董事长助理周报跟踪。")}</div>
      </div>
    </article>
  `).join("");
}

function renderQuestions(signals) {
  const categories = new Set(signals.slice(0, 12).map((item) => item.category));
  const questions = [
    categories.has("经营风险") ? "哪些风险需要从周报升级为董事长专题会？对应的内部指标是否已经能拿到？" : null,
    categories.has("竞品观察") ? "竞品的动作是在抢规模、抢心智、抢渠道，还是抢年轻消费者？潮宏基要避开什么同质化竞争？" : null,
    categories.has("出海机会") ? "海外市场当前最应该验证的是客群、产品、价格带、门店模型，还是品牌表达？" : null,
    categories.has("资本市场") ? "这些外部信号对港股 IPO 叙事、增长质量和投资者问答有什么影响？" : null,
    "高金价周期下，潮宏基应如何平衡克重产品、轻量黄金、串珠和高毛利时尚珠宝？",
    "加盟扩张阶段，单店质量和加盟商盈利应该用哪 3 个指标做董事长看板？",
    "哪些信号值得形成专题研究，哪些只需要继续观察？",
    "董事长助理下一周应推动哪些跨部门信息补齐？"
  ].filter(Boolean).slice(0, 8);

  el.questions.innerHTML = questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderActions(signals) {
  const top = signals.slice(0, 5);
  const actions = top.length ? top.map((item) => item.action) : [
    "补充公司内部经营数据后重新生成风险看板。",
    "维护竞品与珠宝新品关键词。",
    "每周固定输出董事长战略情报简报。"
  ];
  el.actions.innerHTML = actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderSourceStatus(data) {
  const errors = data.errors ?? [];
  if (!errors.length) {
    el.sourceStatus.textContent = data.mode === "live"
      ? "本次自动采集无明显源错误。仍需人工复核每条公开信息的可信度。"
      : "当前展示兜底数据；上线后由 GitHub Actions 自动更新。";
    return;
  }
  if (data.mode === "fallback") {
    el.sourceStatus.textContent = "当前环境未能访问公开源，页面已启用兜底样例；上线到 GitHub Actions 后会自动联网采集。";
    return;
  }
  el.sourceStatus.textContent = `本次有 ${errors.length} 个数据源读取失败，页面已保留其他来源结果。`;
}

function buildBrief(signals) {
  const top = signals.slice(0, 5);
  if (!top.length) return "今日暂未采集到有效公开情报，建议检查数据源或手动运行采集任务。";
  const risk = top.find((item) => item.category === "经营风险") ?? signals.find((item) => item.category === "经营风险");
  const opportunity = top.find((item) => item.category === "战略机会" || item.category === "出海机会");
  const competitor = top.find((item) => item.category === "竞品观察");
  return [
    opportunity ? `机会侧重点是“${opportunity.title}”，${opportunity.impact}` : "机会侧仍围绕东方美学、年轻化渠道和出海验证展开。",
    risk ? `风险侧需要关注“${risk.title}”，${risk.action}` : "风险侧暂未出现需要升级的公开信号，但仍建议跟踪金价、库存和加盟质量。",
    competitor ? `竞品侧出现“${competitor.title}”，建议纳入竞品周报并拆解其产品、渠道和传播动作。` : "竞品侧建议继续固定跟踪头部品牌的新品、渠道和传播动作。",
    "我的建议是：把高优先级信号进入本周董事长助理行动清单，并在正式汇报前用内部销售、库存、会员和渠道数据做二次验证。"
  ].join("");
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

function formatShortDate(date) {
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function safeAttr(value) {
  const text = String(value ?? "#");
  if (text === "#" || text.startsWith("https://") || text.startsWith("http://")) return escapeHtml(text);
  return "#";
}

el.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.filter = tab.dataset.filter;
    el.tabs.forEach((item) => item.classList.toggle("active", item === tab));
    renderSignals();
  });
});

el.briefBtn.addEventListener("click", () => {
  el.briefBox.hidden = !el.briefBox.hidden;
  el.briefBtn.textContent = el.briefBox.hidden ? "生成董事长简报" : "收起董事长简报";
});

el.refreshBtn.addEventListener("click", () => {
  loadIntel().catch((error) => {
    el.signals.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  });
});

loadIntel().catch((error) => {
  el.signals.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  el.sourceStatus.textContent = "数据读取失败，请检查 docs/data/intel.json 是否存在。";
});
