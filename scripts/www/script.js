/**
 * 随手记 3.0 — 统一数据层与 UI 联动
 * 存储：{ records, theme, appTitle }
 * 公务支出：待报销计入统计，已报销全局剔除
 */

(function () {
  "use strict";

  const APP_VERSION = "3.5";

  // ==================== 常量 ====================
  const STORAGE_KEY = "my_ledger_data";
  const DEFAULT_APP_TITLE = "随手记·日常小账本";
  const THEMES = ["blue", "orange", "green", "dark"];
  const REIMBURSE_CATEGORY = "公务";
  const LEGACY_REIMBURSE_CATEGORIES = [
    "工作性支出",
    "工作性支出（可报销）",
    "差旅采购（可报销）",
  ];
  const REIMBURSE = { PENDING: "pending", REIMBURSED: "reimbursed" };
  const UNDO_SECONDS = 5;
  const SCROLL_THRESHOLD = 10;

  const CATEGORIES = {
    expense: [
      { value: "餐饮", icon: "🍜" },
      { value: "交通", icon: "🚌" },
      { value: "购物", icon: "🛒" },
      { value: "娱乐", icon: "🎮" },
      { value: "教育", icon: "🎓" },
      { value: "房贷", icon: "🏠" },
      { value: "保险", icon: "🛡️" },
      { value: REIMBURSE_CATEGORY, icon: "💼" },
      { value: "其他", icon: "📦" },
    ],
    income: [
      { value: "工资", icon: "💰" },
      { value: "奖金", icon: "🎁" },
      { value: "兼职", icon: "💼" },
      { value: "理财", icon: "📈" },
      { value: "其他", icon: "📦" },
    ],
  };

  const CHART_COLORS = [
    "#3b82f6", "#f97316", "#10b981", "#8b5cf6",
    "#ec4899", "#14b8a6", "#eab308", "#6366f1",
    "#f43f5e", "#0ea5e9",
  ];

  const CHART_THEME_COLORS = {
    blue: { text: "#5c6b7f", grid: "rgba(92,107,127,0.15)" },
    orange: { text: "#8b4518", grid: "rgba(139,69,24,0.15)" },
    green: { text: "#0f766e", grid: "rgba(15,118,110,0.15)" },
    dark: { text: "#94a3b8", grid: "rgba(148,163,184,0.12)" },
  };

  const TREND_LABELS = {
    week: "近7天",
    month: "近30天",
    year: "近12个月",
  };

  // ==================== DOM ====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    themeSelect: $("#themeSelect"),
    appTitleWrap: $("#appTitleWrap"),
    appTitleDisplay: $("#appTitleDisplay"),
    appTitleText: $("#appTitleText"),
    appTitleEditBtn: $("#appTitleEditBtn"),
    appTitleInput: $("#appTitleInput"),
    pageDetail: $("#pageDetail"),
    pageCharts: $("#pageCharts"),
    monthIncome: $("#monthIncome"),
    monthExpense: $("#monthExpense"),
    todayExpense: $("#todayExpense"),
    netBalance: $("#netBalance"),
    recordForm: $("#recordForm"),
    amount: $("#amount"),
    category: $("#category"),
    date: $("#date"),
    note: $("#note"),
    submitBtn: $("#submitBtn"),
    recordList: $("#recordList"),
    emptyTip: $("#emptyTip"),
    recordCount: $("#recordCount"),
    recordSum: $("#recordSum"),
    historyFilter: $("#historyFilter"),
    yearFilter: $("#yearFilter"),
    monthFilter: $("#monthFilter"),
    expenseChart: $("#expenseChart"),
    chartEmpty: $("#chartEmpty"),
    trendChart: $("#trendChart"),
    trendChartEmpty: $("#trendChartEmpty"),
    editModal: $("#editModal"),
    editModalClose: $("#editModalClose"),
    editForm: $("#editForm"),
    editId: $("#editId"),
    editAmount: $("#editAmount"),
    editCategory: $("#editCategory"),
    editDate: $("#editDate"),
    editNote: $("#editNote"),
    editCancelBtn: $("#editCancelBtn"),
    undoToast: $("#undoToast"),
    undoToastText: $("#undoToastText"),
    undoBtn: $("#undoBtn"),
    undoCountdown: $("#undoCountdown"),
    numKeypadOverlay: $("#numKeypadOverlay"),
    numKeypadDisplay: $("#numKeypadDisplay"),
    numKeypadClose: $("#numKeypadClose"),
    numKeypadConfirm: $("#numKeypadConfirm"),
  };

  // ==================== 状态 ====================
  let state = { records: [], theme: "blue", appTitle: DEFAULT_APP_TITLE };
  let ui = {
    recordType: "expense",
    chartPeriod: "week",
    trendPeriod: "week",
    activePage: "detail",
    historyFilter: "all",
    yearFilter: "all",
    monthFilter: "all",
    titleEditing: false,
    editingRecord: null,
  };
  let pieChartInstance = null;
  let lineChartInstance = null;
  let pendingUndo = null;
  let keypadTarget = null;
  let keypadBuffer = "";

  // ==================== 分类与报销判定 ====================
  function normalizeCategory(cat) {
    if (cat === REIMBURSE_CATEGORY || LEGACY_REIMBURSE_CATEGORIES.includes(cat)) {
      return REIMBURSE_CATEGORY;
    }
    return cat || "其他";
  }

  function isReimbursableRecord(record) {
    return record.type === "expense" && normalizeCategory(record.category) === REIMBURSE_CATEGORY;
  }

  function countsTowardExpense(record) {
    if (record.type !== "expense") return false;
    if (!isReimbursableRecord(record)) return true;
    return record.reimburseStatus !== REIMBURSE.REIMBURSED;
  }

  function isReimbursed(record) {
    return isReimbursableRecord(record) && record.reimburseStatus === REIMBURSE.REIMBURSED;
  }

  function getAllCategoryOptions() {
    const seen = new Set();
    const list = [];
    ["expense", "income"].forEach((type) => {
      CATEGORIES[type].forEach((c) => {
        if (!seen.has(c.value)) {
          seen.add(c.value);
          list.push(c);
        }
      });
    });
    return list;
  }

  function getYearOptionsFromRecords() {
    const years = new Set();
    state.records.forEach((r) => {
      if (!r?.date) return;
      const y = parseDate(r.date).getFullYear();
      if (Number.isFinite(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }

  function renderTimeFilterOptions() {
    const years = getYearOptionsFromRecords();
    const currentYear = ui.yearFilter;
    const currentMonth = ui.monthFilter;

    els.yearFilter.innerHTML =
      `<option value="all">全部年份</option>` +
      years.map((y) => `<option value="${y}">${y}年</option>`).join("");
    ui.yearFilter = String(currentYear);
    els.yearFilter.value = years.map(String).includes(String(currentYear)) ? String(currentYear) : "all";

    els.monthFilter.innerHTML =
      `<option value="all">全部月份</option>` +
      Array.from({ length: 12 }, (_, i) => i + 1)
        .map((m) => `<option value="${m}">${m}月</option>`)
        .join("");
    els.monthFilter.value =
      currentMonth === "all" || currentMonth === undefined ? "all" : String(currentMonth);
  }

  // ==================== 存储 ====================
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultData();
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed.records)
        ? parsed.records.map(migrateRecord)
        : [];
      const theme = THEMES.includes(parsed.theme) ? parsed.theme : "blue";
      const appTitle = sanitizeAppTitle(parsed.appTitle) || DEFAULT_APP_TITLE;
      return { records, theme, appTitle };
    } catch (e) {
      console.warn("读取本地数据失败，使用默认数据", e);
      return getDefaultData();
    }
  }

  function getDefaultData() {
    return { records: [], theme: "blue", appTitle: DEFAULT_APP_TITLE };
  }

  function migrateRecord(r) {
    const type = r.type === "income" ? "income" : "expense";
    const category = normalizeCategory(r.category);
    const record = {
      id: r.id || generateId(),
      type,
      amount: Number(r.amount) || 0,
      category,
      date: r.date || todayString(),
      note: r.note || "",
      createdAt: r.createdAt || Date.now(),
    };
    if (type === "expense" && category === REIMBURSE_CATEGORY) {
      record.reimburseStatus =
        r.reimburseStatus === REIMBURSE.REIMBURSED
          ? REIMBURSE.REIMBURSED
          : REIMBURSE.PENDING;
    }
    return record;
  }

  function saveData() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        records: state.records,
        theme: state.theme,
        appTitle: state.appTitle,
      })
    );
  }

  // ==================== 工具 ====================
  function todayString() {
    return formatDateYMD(new Date());
  }

  function formatDateYMD(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function formatMoney(num) {
    const prefix = num >= 0 ? "¥" : "-¥";
    return prefix + Math.abs(num).toFixed(2);
  }

  function parseAmountInput(str) {
    const val = parseFloat(String(str || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(val) ? val : NaN;
  }

  function isSameMonth(dateStr) {
    const now = new Date();
    const d = parseDate(dateStr);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  function getCategoryIcon(type, name) {
    const normalized = normalizeCategory(name);
    const list = CATEGORIES[type] || [];
    const found = list.find((c) => c.value === normalized);
    if (found) return found.icon;
    const all = getAllCategoryOptions().find((c) => c.value === normalized);
    return all ? all.icon : "📦";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function sanitizeAppTitle(title) {
    if (typeof title !== "string") return "";
    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 24) : "";
  }

  function addDays(base, offset) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ==================== 自定义金额键盘 ====================
  function formatKeypadDisplay(buf) {
    if (!buf) return "0.00";
    if (buf.endsWith(".")) return buf;
    const num = parseFloat(buf);
    if (!Number.isFinite(num)) return buf || "0.00";
    if (buf.includes(".")) {
      const parts = buf.split(".");
      return parts[0] + "." + (parts[1] || "").padEnd(2, "0").slice(0, 2);
    }
    return num.toFixed(2);
  }

  function updateKeypadDisplay() {
    els.numKeypadDisplay.textContent = formatKeypadDisplay(keypadBuffer);
  }

  function openKeypad(inputEl) {
    keypadTarget = inputEl;
    const current = inputEl.value.trim();
    keypadBuffer = current && current !== "0.00" ? current.replace(/[^\d.]/g, "") : "";
    updateKeypadDisplay();
    els.numKeypadOverlay.hidden = false;
    document.body.classList.add("keypad-open");
  }

  function closeKeypad(apply) {
    if (apply && keypadTarget) {
      const num = parseAmountInput(keypadBuffer);
      keypadTarget.value = num > 0 ? num.toFixed(2) : "";
    }
    els.numKeypadOverlay.hidden = true;
    document.body.classList.remove("keypad-open");
    keypadTarget = null;
    keypadBuffer = "";
  }

  function handleKeypadKey(key) {
    if (key === "back") {
      keypadBuffer = keypadBuffer.slice(0, -1);
    } else if (key === ".") {
      if (!keypadBuffer.includes(".")) {
        keypadBuffer = keypadBuffer ? keypadBuffer + "." : "0.";
      }
    } else {
      if (keypadBuffer.includes(".")) {
        const decimals = keypadBuffer.split(".")[1] || "";
        if (decimals.length >= 2) return;
      }
      if (keypadBuffer === "0" && key !== ".") keypadBuffer = key;
      else keypadBuffer += key;
    }
    updateKeypadDisplay();
  }

  function bindKeypadEvents() {
    els.amount.addEventListener("click", () => openKeypad(els.amount));
    els.editAmount.addEventListener("click", () => openKeypad(els.editAmount));

    $$(".num-key").forEach((btn) => {
      btn.addEventListener("click", () => handleKeypadKey(btn.dataset.key));
    });

    els.numKeypadClose.addEventListener("click", () => closeKeypad(false));
    els.numKeypadConfirm.addEventListener("click", () => closeKeypad(true));

    els.numKeypadOverlay.addEventListener("click", (e) => {
      if (e.target === els.numKeypadOverlay) closeKeypad(true);
    });
  }

  // ==================== 自定义标题 ====================
  function renderAppTitle() {
    const title = state.appTitle || DEFAULT_APP_TITLE;
    els.appTitleText.textContent = title;
    document.title = title;
  }

  function startEditTitle() {
    if (ui.titleEditing) return;
    ui.titleEditing = true;
    els.appTitleWrap.classList.add("is-editing");
    els.appTitleInput.hidden = false;
    els.appTitleInput.value = state.appTitle;
    els.appTitleInput.focus();
    els.appTitleInput.select();
  }

  function commitTitle() {
    if (!ui.titleEditing) return;
    ui.titleEditing = false;

    const next = sanitizeAppTitle(els.appTitleInput.value) || DEFAULT_APP_TITLE;
    state.appTitle = next;
    saveData();
    renderAppTitle();

    els.appTitleWrap.classList.remove("is-editing");
    els.appTitleInput.hidden = true;
  }

  function cancelTitleEdit() {
    ui.titleEditing = false;
    els.appTitleWrap.classList.remove("is-editing");
    els.appTitleInput.hidden = true;
    renderAppTitle();
  }

  // ==================== 双标签页 ====================
  function setActivePage(page) {
    const isDetail = page === "detail";
    ui.activePage = page;

    els.pageDetail.classList.toggle("is-active", isDetail);
    els.pageCharts.classList.toggle("is-active", !isDetail);
    els.pageDetail.hidden = !isDetail;
    els.pageCharts.hidden = isDetail;

    $$(".bottom-nav__item").forEach((tab) => {
      const active = tab.dataset.page === page;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    if (!isDetail) {
      // 容器从 hidden → visible 时，Chart.js 容易拿到 0 尺寸；这里强制销毁并重建
      destroyCharts();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          refreshCharts({ forceRebuild: true });
        });
      });
    }
  }

  // ==================== 周期范围（饼图） ====================
  function getPeriodRange(period) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    let start;
    let end;

    switch (period) {
      case "week": {
        const day = now.getDay();
        const diffToMon = day === 0 ? 6 : day - 1;
        start = new Date(y, m, d - diffToMon);
        end = new Date(y, m, d - diffToMon + 6);
        break;
      }
      case "month":
        start = new Date(y, m, 1);
        end = new Date(y, m + 1, 0);
        break;
      case "quarter": {
        const qStart = Math.floor(m / 3) * 3;
        start = new Date(y, qStart, 1);
        end = new Date(y, qStart + 3, 0);
        break;
      }
      case "year":
        start = new Date(y, 0, 1);
        end = new Date(y, 11, 31);
        break;
      default:
        start = new Date(y, m, 1);
        end = new Date(y, m + 1, 0);
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  function isDateInPeriod(dateStr, period) {
    const date = parseDate(dateStr);
    const { start, end } = getPeriodRange(period);
    return date >= start && date <= end;
  }

  function getPeriodLabel(period) {
    return (
      { week: "本周", month: "本月", quarter: "本季度", year: "本年度" }[period] || ""
    );
  }

  // ==================== 走势数据（折线图） ====================
  function sumIncomeOnDate(dateStr) {
    let total = 0;
    state.records.forEach((r) => {
      if (r.type === "income" && r.date === dateStr) {
        total += Number(r.amount) || 0;
      }
    });
    return total;
  }

  function sumExpenseOnDate(dateStr) {
    let total = 0;
    state.records.forEach((r) => {
      if (countsTowardExpense(r) && r.date === dateStr) {
        total += Number(r.amount) || 0;
      }
    });
    return total;
  }

  function sumIncomeInMonth(year, monthIndex) {
    let total = 0;
    state.records.forEach((r) => {
      if (r.type !== "income") return;
      const d = parseDate(r.date);
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        total += Number(r.amount) || 0;
      }
    });
    return total;
  }

  function sumExpenseInMonth(year, monthIndex) {
    let total = 0;
    state.records.forEach((r) => {
      if (!countsTowardExpense(r)) return;
      const d = parseDate(r.date);
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        total += Number(r.amount) || 0;
      }
    });
    return total;
  }

  function buildTrendDataset(period) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const labels = [];
    const incomeData = [];
    const expenseData = [];

    if (period === "week") {
      for (let i = 6; i >= 0; i--) {
        const d = addDays(today, -i);
        const key = formatDateYMD(d);
        labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        incomeData.push(sumIncomeOnDate(key));
        expenseData.push(sumExpenseOnDate(key));
      }
    } else if (period === "month") {
      for (let i = 29; i >= 0; i--) {
        const d = addDays(today, -i);
        const key = formatDateYMD(d);
        labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
        incomeData.push(sumIncomeOnDate(key));
        expenseData.push(sumExpenseOnDate(key));
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        labels.push(`${d.getFullYear()}/${d.getMonth() + 1}`);
        incomeData.push(sumIncomeInMonth(d.getFullYear(), d.getMonth()));
        expenseData.push(sumExpenseInMonth(d.getFullYear(), d.getMonth()));
      }
    }

    const hasData =
      incomeData.some((v) => v > 0) || expenseData.some((v) => v > 0);

    return { labels, incomeData, expenseData, hasData };
  }

  // ==================== 统计 ====================
  function calcDashboardStats() {
    const today = todayString();
    let monthIncome = 0;
    let monthExpense = 0;
    let todayExpense = 0;

    state.records.forEach((r) => {
      const amt = Number(r.amount) || 0;
      if (r.type === "income" && isSameMonth(r.date)) {
        monthIncome += amt;
      }
      if (countsTowardExpense(r)) {
        if (isSameMonth(r.date)) monthExpense += amt;
        if (r.date === today) todayExpense += amt;
      }
    });

    return {
      monthIncome,
      monthExpense,
      todayExpense,
      netBalance: monthIncome - monthExpense,
    };
  }

  function aggregateExpenseByCategory(period) {
    const map = {};
    state.records.forEach((r) => {
      if (!countsTowardExpense(r)) return;
      if (!isDateInPeriod(r.date, period)) return;
      const cat = normalizeCategory(r.category);
      map[cat] = (map[cat] || 0) + (Number(r.amount) || 0);
    });
    return map;
  }

  // ==================== 历史筛选 ====================
  function renderHistoryFilterOptions() {
    const current = ui.historyFilter;
    const options = [{ value: "all", label: "📋 全部类型" }];
    getAllCategoryOptions().forEach((c) => {
      options.push({ value: c.value, label: `${c.icon} ${c.value}` });
    });

    els.historyFilter.innerHTML = options
      .map((o) => `<option value="${o.value}">${o.label}</option>`)
      .join("");

    const values = options.map((o) => o.value);
    ui.historyFilter = values.includes(current) ? current : "all";
    els.historyFilter.value = ui.historyFilter;
  }

  function getSortedRecords() {
    return [...state.records].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function getFilteredRecords() {
    const sorted = getSortedRecords();
    return sorted.filter((r) => {
      const catOk = ui.historyFilter === "all" || normalizeCategory(r.category) === ui.historyFilter;

      const d = parseDate(r.date);
      const y = d.getFullYear();
      const m = d.getMonth() + 1;

      const yearOk = ui.yearFilter === "all" || String(y) === String(ui.yearFilter);
      const monthOk = ui.monthFilter === "all" || String(m) === String(ui.monthFilter);

      return catOk && yearOk && monthOk;
    });
  }

  // ==================== 主题 ====================
  function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = "blue";
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    els.themeSelect.value = theme;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const colors = {
        blue: "#3b82f6",
        orange: "#f97316",
        green: "#059669",
        dark: "#0f172a",
      };
      meta.setAttribute("content", colors[theme]);
    }

    saveData();
    if (ui.activePage === "charts") refreshCharts();
  }

  // ==================== 分类下拉 ====================
  function fillCategorySelect(selectEl, type, selectedValue) {
    const list = CATEGORIES[type];
    selectEl.innerHTML = list
      .map((c) => `<option value="${c.value}">${c.icon} ${c.value}</option>`)
      .join("");
    const values = list.map((c) => c.value);
    const normalized = normalizeCategory(selectedValue);
    selectEl.value = values.includes(normalized) ? normalized : values[0];
  }

  function renderCategoryOptions(type) {
    fillCategorySelect(els.category, type, els.category.value);
  }

  function setRecordType(type) {
    ui.recordType = type;
    $$(".type-tab").forEach((tab) => {
      const active = tab.dataset.type === type;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    renderCategoryOptions(type);
    els.submitBtn.textContent = type === "income" ? "记一笔收入" : "记一笔支出";
    els.submitBtn.classList.toggle("is-income-mode", type === "income");
  }

  // ==================== Chart.js ====================
  function destroyCharts() {
    if (pieChartInstance) {
      pieChartInstance.destroy();
      pieChartInstance = null;
    }
    if (lineChartInstance) {
      lineChartInstance.destroy();
      lineChartInstance = null;
    }
  }

  function getChartTheme() {
    return CHART_THEME_COLORS[state.theme] || CHART_THEME_COLORS.blue;
  }

  function isChartsPageVisible() {
    return ui.activePage === "charts" && !els.pageCharts.hidden;
  }

  function refreshPieChart() {
    if (!isChartsPageVisible() || typeof Chart === "undefined") return;

    const period = ui.chartPeriod;
    const aggregated = aggregateExpenseByCategory(period);
    const labels = Object.keys(aggregated);
    const values = labels.map((k) => aggregated[k]);
    const hasData = values.length > 0 && values.some((v) => v > 0);

    els.chartEmpty.hidden = hasData;
    els.expenseChart.hidden = !hasData;

    if (pieChartInstance) {
      pieChartInstance.destroy();
      pieChartInstance = null;
    }

    if (!hasData) return;

    const themeColors = getChartTheme();

    pieChartInstance = new Chart(els.expenseChart, {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 2,
            borderColor: state.theme === "dark" ? "#1e293b" : "#ffffff",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: themeColors.text,
              font: { family: "inherit", size: 11, weight: "500" },
              padding: 14,
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ¥${ctx.raw.toFixed(2)} (${pct}%)`;
              },
              title() {
                return getPeriodLabel(period) + "支出占比";
              },
            },
          },
        },
      },
    });
  }

  function refreshLineChart() {
    if (!isChartsPageVisible() || typeof Chart === "undefined") return;

    const period = ui.trendPeriod;
    const { labels, incomeData, expenseData, hasData } = buildTrendDataset(period);

    els.trendChartEmpty.hidden = hasData;
    els.trendChart.hidden = !hasData;

    if (lineChartInstance) {
      lineChartInstance.destroy();
      lineChartInstance = null;
    }

    if (!hasData) return;

    const themeColors = getChartTheme();
    const incomeColor = state.theme === "dark" ? "#34d399" : "#0d9f6e";
    const expenseColor = state.theme === "dark" ? "#fb923c" : "#e85d24";

    lineChartInstance = new Chart(els.trendChart, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "收入",
            data: incomeData,
            borderColor: incomeColor,
            backgroundColor: incomeColor + "22",
            fill: true,
            tension: 0.35,
            pointRadius: period === "month" ? 0 : 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
          {
            label: "支出",
            data: expenseData,
            borderColor: expenseColor,
            backgroundColor: expenseColor + "22",
            fill: true,
            tension: 0.35,
            pointRadius: period === "month" ? 0 : 3,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: { duration: 400 },
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: themeColors.text,
              font: { family: "inherit", size: 11, weight: "500" },
              usePointStyle: true,
              padding: 12,
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                return ` ${ctx.dataset.label}: ¥${ctx.raw.toFixed(2)}`;
              },
              title(tooltipItems) {
                return TREND_LABELS[period] + " · " + (tooltipItems[0]?.label || "");
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: themeColors.text,
              font: { size: period === "month" ? 8 : 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: period === "month" ? 10 : period === "year" ? 12 : 7,
            },
            grid: { color: themeColors.grid },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: themeColors.text,
              font: { size: 10 },
              callback: (v) => "¥" + v,
            },
            grid: { color: themeColors.grid },
          },
        },
      },
    });
  }

  function refreshCharts(opts = {}) {
    if (opts.forceRebuild) {
      destroyCharts();
    }
    refreshPieChart();
    refreshLineChart();
    if (pieChartInstance) {
      pieChartInstance.resize();
      pieChartInstance.update();
    }
    if (lineChartInstance) {
      lineChartInstance.resize();
      lineChartInstance.update();
    }
  }

  // ==================== 编辑弹窗 ====================
  function openEditModal(record) {
    ui.editingRecord = record;
    els.editId.value = record.id;
    els.editAmount.value = Number(record.amount).toFixed(2);
    els.editDate.value = record.date;
    els.editNote.value = record.note || "";
    fillCategorySelect(els.editCategory, record.type, record.category);
    els.editModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeEditModal() {
    ui.editingRecord = null;
    els.editModal.hidden = true;
    document.body.classList.remove("modal-open");
    els.editForm.reset();
  }

  function handleEditSubmit(e) {
    e.preventDefault();
    const id = els.editId.value;
    const record = state.records.find((r) => r.id === id);
    if (!record) {
      closeEditModal();
      return;
    }

    const amount = parseAmountInput(els.editAmount.value);
    if (!amount || amount <= 0) {
      alert("请输入有效的金额（大于 0）");
      return;
    }

    const category = normalizeCategory(els.editCategory.value);
    record.amount = amount;
    record.category = category;
    record.date = els.editDate.value;
    record.note = els.editNote.value.trim();

    if (record.type === "expense" && category === REIMBURSE_CATEGORY) {
      if (!record.reimburseStatus) {
        record.reimburseStatus = REIMBURSE.PENDING;
      }
    } else if (record.type === "expense" && category !== REIMBURSE_CATEGORY) {
      delete record.reimburseStatus;
    }

    saveData();
    closeEditModal();
    renderAll();
  }

  // ==================== 撤销删除 ====================
  function clearPendingUndo() {
    if (!pendingUndo) return;
    if (pendingUndo.timer) clearTimeout(pendingUndo.timer);
    if (pendingUndo.interval) clearInterval(pendingUndo.interval);
    pendingUndo = null;
    els.undoToast.hidden = true;
  }

  function showUndoToast(record) {
    clearPendingUndo();

    let secondsLeft = UNDO_SECONDS;
    els.undoToastText.textContent = "已删除一笔账目";
    els.undoCountdown.textContent = secondsLeft + "s";
    els.undoToast.hidden = false;

    pendingUndo = { record, secondsLeft };

    pendingUndo.interval = setInterval(() => {
      secondsLeft -= 1;
      pendingUndo.secondsLeft = secondsLeft;
      els.undoCountdown.textContent = Math.max(secondsLeft, 0) + "s";
      if (secondsLeft <= 0) clearPendingUndo();
    }, 1000);

    pendingUndo.timer = setTimeout(() => {
      clearPendingUndo();
    }, UNDO_SECONDS * 1000);
  }

  function undoDelete() {
    if (!pendingUndo?.record) return;
    state.records.push(pendingUndo.record);
    saveData();
    clearPendingUndo();
    renderAll();
  }

  // ==================== 渲染 ====================
  function renderDashboard(stats) {
    els.monthIncome.textContent = formatMoney(stats.monthIncome);
    els.monthExpense.textContent = formatMoney(stats.monthExpense);
    els.todayExpense.textContent = formatMoney(stats.todayExpense);
    els.netBalance.textContent = formatMoney(stats.netBalance);
    els.netBalance.style.color =
      stats.netBalance >= 0 ? "var(--income-color)" : "var(--expense-color)";
  }

  function buildReimburseButton(record) {
    const isDone = record.reimburseStatus === REIMBURSE.REIMBURSED;
    const cls = isDone ? "btn-reimburse--done" : "btn-reimburse--pending";
    const label = isDone ? "已报销" : "待报销";
    return `<button type="button" class="btn-reimburse ${cls}" data-action="reimburse" data-id="${record.id}">${label}</button>`;
  }

  const EDIT_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

  function buildRecordItem(record) {
    const li = document.createElement("li");
    li.className = "record-item";
    li.dataset.id = record.id;

    const isIncome = record.type === "income";
    const reimbursed = isReimbursed(record);
    const displayCategory = normalizeCategory(record.category);
    const icon = getCategoryIcon(record.type, displayCategory);
    const sign = isIncome ? "+" : "-";
    let amountClass = isIncome ? "record-amount--income" : "record-amount--expense";
    if (reimbursed) amountClass += " record-amount--excluded";

    const typeLabel = isIncome ? "收入" : "支出";
    const tagClass = isIncome ? "record-type-tag--income" : "record-type-tag--expense";
    const noteText = escapeHtml(record.note || "无备注");
    const catText = escapeHtml(displayCategory);

    const reimburseBtn = isReimbursableRecord(record) ? buildReimburseButton(record) : "";

    li.innerHTML = `
      <div class="record-icon">${icon}</div>
      <div class="record-info">
        <div class="record-top">
          <span class="record-category">
            ${catText}
            <span class="record-type-tag ${tagClass}">${typeLabel}</span>
          </span>
          <span class="record-amount ${amountClass}">${sign}${formatMoney(Number(record.amount))}</span>
        </div>
        <div class="record-bottom">
          <span>${record.date}</span>
          <span class="record-note">${noteText}</span>
        </div>
      </div>
      <div class="record-actions">
        <button type="button" class="btn-edit" data-action="edit" data-id="${record.id}" aria-label="编辑">${EDIT_ICON_SVG}</button>
        ${reimburseBtn}
        <button type="button" class="btn-delete" data-action="delete" data-id="${record.id}">删除</button>
      </div>
    `;
    return li;
  }

  function renderHistory() {
    const filtered = getFilteredRecords();
    const filterLabel =
      ui.historyFilter === "all"
        ? ""
        : getAllCategoryOptions().find((c) => c.value === ui.historyFilter)?.value || ui.historyFilter;

    els.recordCount.textContent =
      ui.historyFilter === "all"
        ? `共 ${filtered.length} 笔`
        : `共 ${filtered.length} 笔 · ${filterLabel}`;

    const sum = filtered.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
    els.recordSum.textContent = `累计金额：¥${sum.toFixed(2)}`;

    els.recordList.innerHTML = "";

    if (filtered.length === 0) {
      els.recordList.classList.remove("is-scrollable");
      els.recordList.appendChild(els.emptyTip);
      els.emptyTip.hidden = false;
      els.emptyTip.textContent =
        ui.historyFilter === "all" && ui.yearFilter === "all" && ui.monthFilter === "all"
          ? "暂无记录，记一笔开始吧～"
          : "该筛选条件下暂无账单";
      return;
    }

    els.emptyTip.hidden = true;

    els.recordList.classList.toggle(
      "is-scrollable",
      filtered.length > SCROLL_THRESHOLD
    );

    filtered.forEach((r) => els.recordList.appendChild(buildRecordItem(r)));
  }

  function renderAll() {
    renderDashboard(calcDashboardStats());
    renderTimeFilterOptions();
    renderHistory();
    if (ui.activePage === "charts") refreshCharts();
  }

  // ==================== 事件 ====================
  function handleSubmit(e) {
    e.preventDefault();

    const amount = parseAmountInput(els.amount.value);
    if (!amount || amount <= 0) {
      alert("请输入有效的金额（大于 0）");
      return;
    }

    const category = normalizeCategory(els.category.value);
    const record = {
      id: generateId(),
      type: ui.recordType,
      amount,
      category,
      date: els.date.value,
      note: els.note.value.trim(),
      createdAt: Date.now(),
    };

    if (ui.recordType === "expense" && category === REIMBURSE_CATEGORY) {
      record.reimburseStatus = REIMBURSE.PENDING;
    }

    state.records.push(record);
    saveData();
    renderAll();

    els.amount.value = "";
    els.note.value = "";
  }

  function handleDelete(id) {
    const record = state.records.find((r) => r.id === id);
    if (!record) return;

    state.records = state.records.filter((r) => r.id !== id);
    saveData();
    renderAll();
    showUndoToast(record);
  }

  function toggleReimburseStatus(id) {
    const record = state.records.find((r) => r.id === id);
    if (!record || !isReimbursableRecord(record)) return;

    record.reimburseStatus =
      record.reimburseStatus === REIMBURSE.REIMBURSED
        ? REIMBURSE.PENDING
        : REIMBURSE.REIMBURSED;

    saveData();
    renderAll();
  }

  function bindTitleEvents() {
    const openEdit = (e) => {
      e.stopPropagation();
      startEditTitle();
    };

    els.appTitleEditBtn.addEventListener("click", openEdit);
    els.appTitleText.addEventListener("click", openEdit);
    els.appTitleDisplay.addEventListener("click", (e) => {
      if (e.target === els.appTitleEditBtn) return;
      openEdit(e);
    });

    els.appTitleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitTitle();
      } else if (e.key === "Escape") {
        cancelTitleEdit();
      }
    });

    els.appTitleInput.addEventListener("blur", () => {
      if (ui.titleEditing) commitTitle();
    });
  }

  function bindEvents() {
    bindTitleEvents();
    bindKeypadEvents();
    els.recordForm.addEventListener("submit", handleSubmit);

    $$(".type-tab").forEach((tab) => {
      tab.addEventListener("click", () => setRecordType(tab.dataset.type));
    });

    $$(".bottom-nav__item").forEach((tab) => {
      tab.addEventListener("click", () => setActivePage(tab.dataset.page));
    });

    els.themeSelect.addEventListener("change", (e) => applyTheme(e.target.value));

    els.historyFilter.addEventListener("change", (e) => {
      ui.historyFilter = e.target.value;
      renderHistory();
    });

    els.yearFilter.addEventListener("change", (e) => {
      ui.yearFilter = e.target.value;
      renderHistory();
    });

    els.monthFilter.addEventListener("change", (e) => {
      ui.monthFilter = e.target.value;
      renderHistory();
    });

    $$(".period-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".period-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        ui.chartPeriod = tab.dataset.period;
        refreshPieChart();
      });
    });

    $$(".trend-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$(".trend-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        ui.trendPeriod = tab.dataset.trend;
        refreshLineChart();
      });
    });

    els.recordList.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === "delete") handleDelete(id);
      if (action === "reimburse") toggleReimburseStatus(id);
      if (action === "edit") {
        const record = state.records.find((r) => r.id === id);
        if (record) openEditModal(record);
      }
    });

    els.editForm.addEventListener("submit", handleEditSubmit);
    els.editModalClose.addEventListener("click", closeEditModal);
    els.editCancelBtn.addEventListener("click", closeEditModal);
    els.editModal.addEventListener("click", (e) => {
      if (e.target === els.editModal) closeEditModal();
    });

    els.undoBtn.addEventListener("click", undoDelete);

    window.addEventListener("resize", () => {
      if (ui.activePage === "charts") {
        refreshCharts({ forceRebuild: true });
      }
    });
  }

  // ==================== 初始化 ====================
  function init() {
    state = loadData();
    els.date.value = todayString();

    renderAppTitle();
    renderHistoryFilterOptions();
    renderTimeFilterOptions();
    applyTheme(state.theme);
    setRecordType("expense");
    setActivePage("detail");
    bindEvents();
    renderAll();

    console.info(`随手记 v${APP_VERSION} 已就绪`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
