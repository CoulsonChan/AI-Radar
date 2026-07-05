const state = {
  data: null,
  filter: "all"
};

const el = {
  updateTime: document.querySelector("#updateTime"),
  modeLabel: document.querySelector("#modeLabel"),
  totalItems: document.querySelector("#totalItems"),
  opportunityIndex: document.querySelector("#opportunityIndex"),
  riskIndex: document.querySelector("#riskIndex"),
  highPriority: document.querySelector("#highPriority"),
  signals: document.querySelector("#signals"),
  questions: document.querySelector("#questions"),
  actions: document.querySelector("#actions"),
  sourceStatus: document.querySelector("#sourceStatus"),
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
  el.highPriority.textContent = summary.highPriority ?? "-";
  el.briefText.textContent = buildBrief(data.signals ?? []);
  renderSignals();
  renderQuestions(data.signals ?? []);
  renderActions(data.signals ?? []);
  renderSourceStatus(data);
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
        <span>分值 ${Number(item.score ?? 0)}</span>
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
      : "当前展示种子数据。上线后 GitHub Actions 会每天自动生成 live 数据。";
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
    "董事长，今天的 AI 战略情报雷达显示：",
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
