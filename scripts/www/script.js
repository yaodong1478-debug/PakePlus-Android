/**
 * 随手记 5.2 — 飞牛私有云家庭账本
 * 本地优先 + WebDAV 时间戳合并同步 + 机主无感记账
 */

(function () {
  "use strict";

  const APP_VERSION = "5.2";
  const BACKUP_FORMAT = "my_ledger_backup_v1";
  const WEBDAV_LEDGER_FILE = "ledger.json";

  // ==================== 常量 ====================
  const STORAGE_KEY = "my_ledger_data";
  const SNAPSHOT_KEY = "ledger_snapshot_backup";
  const CREATOR = { MALE: "male", FEMALE: "female" };
  const CREATOR_ICONS = { male: "🎩", female: "💄" };
  const CREATOR_ARIA = { male: "先生", female: "夫人" };
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
      { value: "医疗", icon: "🏥" },
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
    year: "本年各月",
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
    pieYearSelect: $("#pieYearSelect"),
    pieWeekSelect: $("#pieWeekSelect"),
    pieMonthSelect: $("#pieMonthSelect"),
    pieQuarterSelect: $("#pieQuarterSelect"),
    pieWeekFilterWrap: $("#pieWeekFilterWrap"),
    pieMonthFilterWrap: $("#pieMonthFilterWrap"),
    pieQuarterFilterWrap: $("#pieQuarterFilterWrap"),
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
    exportBackupBtn: $("#exportBackupBtn"),
    importBackupBtn: $("#importBackupBtn"),
    backupToggleBtn: $("#backupToggleBtn"),
    backupPanel: $("#backupPanel"),
    backupImportArea: $("#backupImportArea"),
    importTextarea: $("#importTextarea"),
    importCancelBtn: $("#importCancelBtn"),
    importConfirmBtn: $("#importConfirmBtn"),
    clearAllDataBtn: $("#clearAllDataBtn"),
    restoreSnapshotBtn: $("#restoreSnapshotBtn"),
    exportFallbackModal: $("#exportFallbackModal"),
    exportFallbackText: $("#exportFallbackText"),
    exportFallbackClose: $("#exportFallbackClose"),
    exportFallbackOk: $("#exportFallbackOk"),
    webdavUrl: $("#webdavUrl"),
    webdavUser: $("#webdavUser"),
    webdavPass: $("#webdavPass"),
    deviceCreator: $("#deviceCreator"),
    manualSyncBtn: $("#manualSyncBtn"),
    autoSyncToggle: $("#autoSyncToggle"),
    webdavStatus: $("#webdavStatus"),
    familyLedgerToggle: $("#familyLedgerToggle"),
    householdViewBar: $("#householdViewBar"),
    webdavSection: $("#webdavSection"),
  };

  // ==================== 状态 ====================
  let state = {
    records: [],
    theme: "blue",
    appTitle: DEFAULT_APP_TITLE,
    deletedIds: [],
    webdav: {
      url: "",
      username: "",
      password: "",
      deviceCreator: CREATOR.MALE,
      autoSync: true,
    },
    syncMeta: { lastSyncAt: null, lastSyncOk: null },
    familyLedgerEnabled: false,
  };
  let ui = {
    recordType: "expense",
    viewScope: "family",
    chartPeriod: "week",
    pieChartYear: new Date().getFullYear(),
    pieChartWeek: 1,
    pieChartMonth: new Date().getMonth() + 1,
    pieChartQuarter: Math.floor(new Date().getMonth() / 3) + 1,
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
  let syncInProgress = false;
  let syncQueued = false;

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

  /** 图表与看板：所有未删除支出均计入，不再剔除已报销公务 */
  function countsTowardExpense(record) {
    return record && record.type === "expense";
  }

  function parseRecordAmount(record) {
    const amt = parseFloat(String(record?.amount ?? ""));
    return Number.isFinite(amt) ? amt : 0;
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

  function normalizeCreator(value) {
    return value === CREATOR.FEMALE ? CREATOR.FEMALE : CREATOR.MALE;
  }

  /** 静默读取「本机身份绑定」，记一笔时自动赋值 creator */
  function getBoundDeviceCreator() {
    return normalizeCreator(state.webdav?.deviceCreator);
  }

  /** 按总账 / 先生 / 夫人视角过滤（未启用家庭账本时始终全量） */
  function getViewRecords() {
    const all = state.records || [];
    if (!isFamilyLedgerEnabled() || ui.viewScope === "family") return all;
    return all.filter((r) => normalizeCreator(r.creator) === ui.viewScope);
  }

  function getYearOptionsFromRecords() {
    const years = new Set();
    getViewRecords().forEach((r) => {
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
      `<option value="all">全部</option>` +
      years.map((y) => `<option value="${y}">${y}年</option>`).join("");
    ui.yearFilter = String(currentYear);
    els.yearFilter.value = years.map(String).includes(String(currentYear)) ? String(currentYear) : "all";

    els.monthFilter.innerHTML =
      `<option value="all">全部</option>` +
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
      const deletedIds = Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [];
      const webdav = migrateWebDAVConfig(parsed.webdav);
      const syncMeta = parsed.syncMeta && typeof parsed.syncMeta === "object" ? parsed.syncMeta : {};
      const familyLedgerEnabled = parsed.familyLedgerEnabled === true;
      return { records, theme, appTitle, deletedIds, webdav, syncMeta, familyLedgerEnabled };
    } catch (e) {
      console.warn("读取本地数据失败，使用默认数据", e);
      return getDefaultData();
    }
  }

  function migrateWebDAVConfig(raw) {
    const base = getDefaultData().webdav;
    if (!raw || typeof raw !== "object") return base;
    return {
      url: typeof raw.url === "string" ? raw.url : base.url,
      username: typeof raw.username === "string" ? raw.username : base.username,
      password: typeof raw.password === "string" ? raw.password : base.password,
      deviceCreator: normalizeCreator(raw.deviceCreator),
      autoSync: raw.autoSync !== false,
    };
  }

  function getDefaultData() {
    return {
      records: [],
      theme: "blue",
      appTitle: DEFAULT_APP_TITLE,
      deletedIds: [],
      webdav: {
        url: "",
        username: "",
        password: "",
        deviceCreator: CREATOR.MALE,
        autoSync: true,
      },
      syncMeta: { lastSyncAt: null, lastSyncOk: null },
      familyLedgerEnabled: false,
    };
  }

  function migrateRecord(r) {
    const type = r.type === "income" ? "income" : "expense";
    const category = normalizeCategory(r.category);
    const now = Date.now();
    const record = {
      id: r.id || generateId(),
      type,
      amount: parseFloat(r.amount) || 0,
      category,
      date: r.date || todayString(),
      note: r.note || "",
      creator: normalizeCreator(r.creator),
      createdAt: r.createdAt || now,
      updatedAt: r.updatedAt || r.createdAt || now,
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
        deletedIds: state.deletedIds || [],
        webdav: state.webdav,
        syncMeta: state.syncMeta || {},
        familyLedgerEnabled: !!state.familyLedgerEnabled,
      })
    );
  }

  function isFamilyLedgerEnabled() {
    return !!state.familyLedgerEnabled;
  }

  function applyFamilyLedgerUI() {
    const enabled = isFamilyLedgerEnabled();
    document.body.classList.toggle("family-ledger-enabled", enabled);

    if (els.familyLedgerToggle) {
      els.familyLedgerToggle.checked = enabled;
    }

    if (!enabled) {
      ui.viewScope = "family";
      syncHouseholdViewTabsUI();
    }

    renderAll();
    if (enabled && ui.activePage === "charts") {
      destroyCharts();
      requestAnimationFrame(() => refreshCharts({ forceRebuild: true }));
    }
  }

  function setFamilyLedgerEnabled(enabled) {
    state.familyLedgerEnabled = !!enabled;
    saveData();
    applyFamilyLedgerUI();
  }

  function buildCloudPayload() {
    return {
      version: APP_VERSION,
      updatedAt: Date.now(),
      records: state.records,
      theme: state.theme,
      appTitle: state.appTitle,
      deletedIds: state.deletedIds || [],
    };
  }

  function parseCloudPayload(text) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { records: parsed.map(migrateRecord), deletedIds: [], theme: null, appTitle: null };
    }
    if (parsed && Array.isArray(parsed.records)) {
      return {
        records: parsed.records.map(migrateRecord),
        deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
        theme: parsed.theme,
        appTitle: parsed.appTitle,
        updatedAt: parsed.updatedAt || 0,
      };
    }
    throw new Error("云端 ledger.json 格式无效");
  }

  function getRecordTimestamp(record) {
    return Number(record?.updatedAt || record?.createdAt || 0);
  }

  /** 按唯一 ID 全量去重合并，时间戳较新者胜出 */
  function mergeLedgerData(localPayload, remotePayload) {
    const deletedIds = new Set([
      ...(localPayload.deletedIds || []),
      ...(remotePayload.deletedIds || []),
    ]);

    const map = new Map();
    [...(remotePayload.records || []), ...(localPayload.records || [])].forEach((raw) => {
      if (!raw?.id || deletedIds.has(raw.id)) return;
      const record = migrateRecord(raw);
      const existing = map.get(record.id);
      if (!existing || getRecordTimestamp(record) >= getRecordTimestamp(existing)) {
        map.set(record.id, record);
      }
    });

    const remoteUpdated = Number(remotePayload.updatedAt || 0);
    const localUpdated = Number(localPayload.updatedAt || 0);
    const remoteWinsMeta = remoteUpdated >= localUpdated;

    return {
      records: Array.from(map.values()),
      deletedIds: Array.from(deletedIds),
      theme: remoteWinsMeta && THEMES.includes(remotePayload.theme)
        ? remotePayload.theme
        : localPayload.theme,
      appTitle: remoteWinsMeta && sanitizeAppTitle(remotePayload.appTitle)
        ? sanitizeAppTitle(remotePayload.appTitle)
        : localPayload.appTitle,
    };
  }

  function isWebDAVConfigured() {
    const w = state.webdav || {};
    return !!(w.url && w.url.trim() && w.username && w.password);
  }

  function normalizeWebDAVUrl(url) {
    let base = String(url || "").trim();
    if (!base) return "";
    if (!/^https?:\/\//i.test(base)) base = "https://" + base;
    if (!base.endsWith("/")) base += "/";
    return base + WEBDAV_LEDGER_FILE;
  }

  function getBasicAuthHeader() {
    const { username, password } = state.webdav;
    return "Basic " + btoa(unescape(encodeURIComponent(username + ":" + password)));
  }

  async function webdavGetLedger(url) {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: getBasicAuthHeader() },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("读取 NAS 失败（HTTP " + res.status + "）");
    return await res.text();
  }

  async function webdavPutLedger(url, body) {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: getBasicAuthHeader(),
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
    });
    if (!res.ok) throw new Error("写入 NAS 失败（HTTP " + res.status + "）");
  }

  function updateWebDAVStatus(text, type) {
    if (!els.webdavStatus) return;
    els.webdavStatus.textContent = text;
    els.webdavStatus.classList.remove("is-ok", "is-error");
    if (type) els.webdavStatus.classList.add(type);
  }

  function readWebDAVFormToState() {
    if (!state.webdav) state.webdav = getDefaultData().webdav;
    state.webdav.url = els.webdavUrl?.value?.trim() || "";
    state.webdav.username = els.webdavUser?.value?.trim() || "";
    state.webdav.password = els.webdavPass?.value || "";
    state.webdav.deviceCreator = normalizeCreator(els.deviceCreator?.value);
    state.webdav.autoSync = !!els.autoSyncToggle?.checked;
    saveData();
  }

  function renderWebDAVForm() {
    const w = state.webdav || getDefaultData().webdav;
    if (els.webdavUrl) els.webdavUrl.value = w.url || "";
    if (els.webdavUser) els.webdavUser.value = w.username || "";
    if (els.webdavPass) els.webdavPass.value = w.password || "";
    if (els.deviceCreator) els.deviceCreator.value = normalizeCreator(w.deviceCreator);
    if (els.autoSyncToggle) els.autoSyncToggle.checked = w.autoSync !== false;

    const meta = state.syncMeta || {};
    if (!isWebDAVConfigured()) {
      updateWebDAVStatus("同步状态：未配置 WebDAV", null);
    } else if (meta.lastSyncOk === true) {
      const t = meta.lastSyncAt ? new Date(meta.lastSyncAt).toLocaleString() : "";
      updateWebDAVStatus("同步状态：已成功 " + (t || ""), "is-ok");
    } else if (meta.lastSyncOk === false) {
      updateWebDAVStatus("同步状态：上次失败 " + (meta.lastError || ""), "is-error");
    } else {
      updateWebDAVStatus("同步状态：已配置，等待同步", null);
    }
  }

  function applyMergedState(merged, options = {}) {
    state.records = merged.records;
    state.deletedIds = merged.deletedIds || [];
    if (merged.theme && THEMES.includes(merged.theme)) state.theme = merged.theme;
    if (merged.appTitle) state.appTitle = merged.appTitle;
    saveData();
    if (options.refreshUI !== false) {
      renderAppTitle();
      renderHistoryFilterOptions();
      renderTimeFilterOptions();
      renderPieSubFilterOptions();
      if (state.theme) applyTheme(state.theme);
      renderAll();
      if (ui.activePage === "charts") {
        destroyCharts();
        requestAnimationFrame(() => refreshCharts({ forceRebuild: true }));
      }
    }
  }

  async function syncWithFlyNAS(options = { silent: true, manual: false }) {
    if (!isWebDAVConfigured()) {
      if (options.manual) alert("请先完整填写飞牛 WebDAV 地址、用户名和密码。");
      return { ok: false, reason: "not_configured" };
    }

    if (syncInProgress) {
      syncQueued = true;
      return { ok: false, reason: "busy" };
    }

    syncInProgress = true;
    if (options.manual) updateWebDAVStatus("同步状态：正在同步…", null);

    try {
      const fileUrl = normalizeWebDAVUrl(state.webdav.url);
      const localPayload = buildCloudPayload();
      const remoteText = await webdavGetLedger(fileUrl);
      let merged;

      if (remoteText === null) {
        merged = {
          records: localPayload.records,
          deletedIds: localPayload.deletedIds,
          theme: localPayload.theme,
          appTitle: localPayload.appTitle,
        };
      } else {
        const remotePayload = parseCloudPayload(remoteText);
        merged = mergeLedgerData(localPayload, remotePayload);
      }

      const cloudBody = JSON.stringify({
        version: APP_VERSION,
        updatedAt: Date.now(),
        records: merged.records,
        theme: merged.theme || state.theme,
        appTitle: merged.appTitle || state.appTitle,
        deletedIds: merged.deletedIds,
      });

      await webdavPutLedger(fileUrl, cloudBody);
      applyMergedState(merged, { refreshUI: true });

      state.syncMeta = {
        lastSyncAt: Date.now(),
        lastSyncOk: true,
        lastError: null,
      };
      saveData();
      updateWebDAVStatus(
        "同步状态：已成功 " + new Date().toLocaleString(),
        "is-ok"
      );

      if (options.manual) {
        alert("🎉 飞牛 NAS 同步成功！已合并最新家庭账本。");
      }

      return { ok: true, merged: true };
    } catch (err) {
      console.warn("[随手记] WebDAV 同步失败", err);
      state.syncMeta = {
        lastSyncAt: Date.now(),
        lastSyncOk: false,
        lastError: err.message || String(err),
      };
      saveData();
      updateWebDAVStatus("同步状态：失败 - " + (err.message || err), "is-error");
      if (options.manual || !options.silent) {
        alert("同步失败：" + (err.message || "请检查网络与 WebDAV 配置"));
      }
      return { ok: false, error: err };
    } finally {
      syncInProgress = false;
      if (syncQueued) {
        syncQueued = false;
        syncWithFlyNAS(options);
      }
    }
  }

  function triggerBackgroundSync() {
    if (!isFamilyLedgerEnabled()) return;
    if (!isWebDAVConfigured()) return;
    if (state.webdav.autoSync === false) return;
    syncWithFlyNAS({ silent: true }).catch(() => {});
  }

  function markRecordUpdated(record) {
    record.updatedAt = Date.now();
  }

  function trackDeletedId(id) {
    if (!state.deletedIds) state.deletedIds = [];
    if (!state.deletedIds.includes(id)) state.deletedIds.push(id);
  }

  function untrackDeletedId(id) {
    if (!state.deletedIds) return;
    state.deletedIds = state.deletedIds.filter((x) => x !== id);
  }

  // ==================== 4.0 快照与安全 ====================
  function saveSnapshotBeforeOverwrite() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        localStorage.setItem(SNAPSHOT_KEY, current);
        updateSnapshotButtonState();
      }
    } catch (e) {
      console.warn("[随手记] 快照保存失败", e);
    }
  }

  function hasSnapshot() {
    try {
      return !!localStorage.getItem(SNAPSHOT_KEY);
    } catch (e) {
      return false;
    }
  }

  function updateSnapshotButtonState() {
    if (!els.restoreSnapshotBtn) return;
    const exists = hasSnapshot();
    els.restoreSnapshotBtn.disabled = !exists;
    els.restoreSnapshotBtn.setAttribute("aria-disabled", exists ? "false" : "true");
  }

  function reloadStateFromStorage() {
    state = loadData();
    renderAppTitle();
    renderHistoryFilterOptions();
    renderTimeFilterOptions();
    if (state.theme) applyTheme(state.theme);
    renderAll();
    destroyCharts();
    requestAnimationFrame(() => {
      refreshCharts({ forceRebuild: true });
    });
  }

  function restoreFromSnapshot() {
    const snap = localStorage.getItem(SNAPSHOT_KEY);
    if (!snap) {
      alert("暂无可用快照。系统会在导入、清空或删除账单前自动保存一次。");
      updateSnapshotButtonState();
      return;
    }

    try {
      JSON.parse(snap);
    } catch (e) {
      alert("快照数据已损坏，无法恢复。");
      return;
    }

    if (
      !confirm(
        "确认要用上一次操作前的快照覆盖当前账单吗？\n\n当前数据将被替换，建议先导出备份。"
      )
    ) {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, snap);
      reloadStateFromStorage();
      closeImportArea();
      updateSnapshotButtonState();
      alert("快照恢复成功！已还原至上一次操作前的数据。");
    } catch (e) {
      alert("快照恢复失败：" + (e.message || "未知错误"));
    }
  }

  function handleClearAllData() {
    const confirmed = confirm(
      "⚠️ 警告：此操作将永久清空本地所有记账账单，且无法直接撤销！确认要全部清空吗？"
    );
    if (!confirmed) return;

    saveSnapshotBeforeOverwrite();
    const savedWebdav = state.webdav;
    state = getDefaultData();
    state.webdav = savedWebdav;
    saveData();
    closeImportArea();
    reloadStateFromStorage();
    alert("清空成功");
  }

  function buildBackupPayload() {
    const filtered = getFilteredRecords();
    return {
      format: BACKUP_FORMAT,
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      exportScope: "filtered",
      filters: {
        type: ui.historyFilter,
        year: ui.yearFilter,
        month: ui.monthFilter,
      },
      records: filtered,
      theme: state.theme,
      appTitle: state.appTitle,
    };
  }

  function buildBackupText() {
    return JSON.stringify(buildBackupPayload());
  }

  function validateBackupPayload(parsed) {
    if (!parsed || typeof parsed !== "object") {
      throw new Error("备份数据格式无效：需要 JSON 对象或账单数组");
    }

    let records = null;
    let theme = null;
    let appTitle = null;

    if (Array.isArray(parsed)) {
      records = parsed;
    } else if (Array.isArray(parsed.records)) {
      records = parsed.records;
      theme = parsed.theme;
      appTitle = parsed.appTitle;
    } else if (parsed.data && Array.isArray(parsed.data.records)) {
      records = parsed.data.records;
      theme = parsed.data.theme;
      appTitle = parsed.data.appTitle;
    } else {
      throw new Error("备份数据缺少 records 账单数组");
    }

    records.forEach((r, i) => {
      if (!r || typeof r !== "object") {
        throw new Error(`第 ${i + 1} 条账单数据无效`);
      }
      const type = r.type === "income" ? "income" : "expense";
      const amount = parseFloat(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`第 ${i + 1} 条账单金额无效`);
      }
      if (!r.date || typeof r.date !== "string") {
        throw new Error(`第 ${i + 1} 条账单日期无效`);
      }
      if (type !== r.type && r.type !== undefined) {
        throw new Error(`第 ${i + 1} 条账单类型无效`);
      }
    });

    return {
      records: records.map(migrateRecord),
      theme: THEMES.includes(theme) ? theme : null,
      appTitle: sanitizeAppTitle(appTitle) || null,
    };
  }

  function parseBackupText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      throw new Error("请先粘贴备份文本");
    }
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      throw new Error("JSON 格式错误，请检查是否完整复制了备份文本");
    }
    return validateBackupPayload(parsed);
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  function openExportFallbackModal(text) {
    els.exportFallbackText.value = text;
    els.exportFallbackModal.hidden = false;
    document.body.classList.add("modal-open");
    els.exportFallbackText.focus();
    els.exportFallbackText.select();
  }

  function closeExportFallbackModal() {
    els.exportFallbackModal.hidden = true;
    document.body.classList.remove("modal-open");
    els.exportFallbackText.value = "";
  }

  function toggleBackupPanel() {
    const isOpen = els.backupPanel.classList.toggle("is-active");
    els.backupToggleBtn.classList.toggle("is-active", isOpen);
    els.backupToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    els.backupPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    if (!isOpen) {
      closeImportArea();
    } else {
      updateSnapshotButtonState();
      renderWebDAVForm();
    }
  }

  function openImportArea() {
    if (!els.backupPanel.classList.contains("is-active")) {
      els.backupPanel.classList.add("is-active");
      els.backupToggleBtn.classList.add("is-active");
      els.backupToggleBtn.setAttribute("aria-expanded", "true");
      els.backupPanel.setAttribute("aria-hidden", "false");
      updateSnapshotButtonState();
    }
    els.backupImportArea.hidden = false;
    els.importTextarea.focus();
  }

  function closeImportArea() {
    els.backupImportArea.hidden = true;
    els.importTextarea.value = "";
  }

  async function handleExportBackup() {
    const backupText = buildBackupText();

    try {
      const copied = await copyTextToClipboard(backupText);
      if (copied) {
        const count = getFilteredRecords().length;
        alert(
          `🎉 当前筛选条件下的 ${count} 笔账单已复制到剪贴板！\n请发送到新手机或备忘录妥善保存。`
        );
        return;
      }
    } catch (e) {
      console.warn("剪贴板写入失败，降级为手动复制", e);
    }

    openExportFallbackModal(backupText);
  }

  function refreshAllAfterImport() {
    reloadStateFromStorage();
  }

  function handleImportBackup() {
    let payload;
    try {
      payload = parseBackupText(els.importTextarea.value);
    } catch (e) {
      alert("导入失败：" + (e.message || "数据校验未通过"));
      return;
    }

    const count = payload.records.length;

    saveSnapshotBeforeOverwrite();

    state.records = payload.records;
    if (payload.theme) state.theme = payload.theme;
    if (payload.appTitle) state.appTitle = payload.appTitle;

    saveData();
    closeImportArea();
    refreshAllAfterImport();

    alert(`恢复成功！已成功导入 ${count} 笔账单。`);
    triggerBackgroundSync();
  }

  function syncHouseholdViewTabsUI() {
    $$(".household-view-tab").forEach((tab) => {
      const active = tab.dataset.view === ui.viewScope;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function setViewScope(scope) {
    const allowed = ["family", CREATOR.MALE, CREATOR.FEMALE];
    ui.viewScope = allowed.includes(scope) ? scope : "family";
    syncHouseholdViewTabsUI();
    renderTimeFilterOptions();
    renderPieSubFilterOptions();
    renderAll();
    if (ui.activePage === "charts") {
      destroyCharts();
      requestAnimationFrame(() => refreshCharts({ forceRebuild: true }));
    }
  }

  function bindHouseholdViewEvents() {
    $$(".household-view-tab").forEach((tab) => {
      tab.addEventListener("click", () => setViewScope(tab.dataset.view));
    });
  }

  function bindFamilyLedgerEvents() {
    if (els.familyLedgerToggle) {
      els.familyLedgerToggle.addEventListener("change", (e) => {
        setFamilyLedgerEnabled(e.target.checked);
      });
    }
  }

  function bindWebDAVEvents() {
    const onConfigChange = () => {
      readWebDAVFormToState();
    };

    [els.webdavUrl, els.webdavUser, els.webdavPass, els.deviceCreator].forEach((el) => {
      if (el) el.addEventListener("change", onConfigChange);
    });
    if (els.webdavPass) els.webdavPass.addEventListener("blur", onConfigChange);
    if (els.autoSyncToggle) {
      els.autoSyncToggle.addEventListener("change", onConfigChange);
    }
    if (els.manualSyncBtn) {
      els.manualSyncBtn.addEventListener("click", () => {
        readWebDAVFormToState();
        syncWithFlyNAS({ silent: false, manual: true });
      });
    }
  }

  function bindBackupEvents() {
    els.backupToggleBtn.addEventListener("click", toggleBackupPanel);
    els.exportBackupBtn.addEventListener("click", handleExportBackup);
    els.importBackupBtn.addEventListener("click", openImportArea);
    els.importCancelBtn.addEventListener("click", closeImportArea);
    els.importConfirmBtn.addEventListener("click", handleImportBackup);
    els.clearAllDataBtn.addEventListener("click", handleClearAllData);
    els.restoreSnapshotBtn.addEventListener("click", restoreFromSnapshot);

    els.exportFallbackClose.addEventListener("click", closeExportFallbackModal);
    els.exportFallbackOk.addEventListener("click", closeExportFallbackModal);
    els.exportFallbackModal.addEventListener("click", (e) => {
      if (e.target === els.exportFallbackModal) closeExportFallbackModal();
    });
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
      triggerBackgroundSync();
      // 容器从 hidden → visible 时 Chart.js 易拿到 0 尺寸，强制销毁后重建
      destroyCharts();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          refreshCharts({ forceRebuild: true });
          // WebView / 手机端首次布局较慢时的兜底刷新
          setTimeout(() => refreshCharts({ forceRebuild: true }), 150);
        });
      });
    }
  }

  // ==================== 周期范围（饼图） ====================
  function formatMMDD(date) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${m}/${d}`;
  }

  function getISOWeekNumber(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return { year: d.getFullYear(), week };
  }

  function getISOWeeksInYear(year) {
    return getISOWeekNumber(new Date(year, 11, 28)).week;
  }

  function getWeekDateRange(year, week) {
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setDate(jan4.getDate() - jan4Day + 1);
    const start = new Date(mondayWeek1);
    start.setDate(mondayWeek1.getDate() + (week - 1) * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  /** 计算指定 ISO 年份的全部周及周一至周日日期范围 */
  function getWeeksForYear(year) {
    const totalWeeks = getISOWeeksInYear(year);
    const weeks = [];
    for (let w = 1; w <= totalWeeks; w++) {
      const { start, end } = getWeekDateRange(year, w);
      weeks.push({ week: w, start, end });
    }
    return weeks;
  }

  function formatPieWeekOptionLabel(week, start, end) {
    return `第 ${week} 周 (${formatMMDD(start)} - ${formatMMDD(end)})`;
  }

  function getDefaultWeekForYear(year) {
    const iso = getISOWeekNumber(new Date());
    return iso.year === year ? iso.week : 1;
  }

  function renderPieWeekOptions(preferredWeek) {
    const year = parseInt(ui.pieChartYear, 10) || new Date().getFullYear();
    const weeks = getWeeksForYear(year);
    const weekNumbers = weeks.map((w) => w.week);

    els.pieWeekSelect.innerHTML = weeks
      .map(({ week, start, end }) => {
        const label = formatPieWeekOptionLabel(week, start, end);
        return `<option value="${week}">${label}</option>`;
      })
      .join("");

    let targetWeek =
      preferredWeek !== undefined && preferredWeek !== null
        ? parseInt(preferredWeek, 10)
        : parseInt(ui.pieChartWeek, 10);

    if (!weekNumbers.includes(targetWeek)) {
      targetWeek = getDefaultWeekForYear(year);
    }

    ui.pieChartWeek = targetWeek;
    els.pieWeekSelect.value = String(targetWeek);
  }

  function getPieChartYears() {
    const years = new Set([new Date().getFullYear(), ui.pieChartYear]);
    getYearOptionsFromRecords().forEach((y) => years.add(y));
    return Array.from(years)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
  }

  function initPieChartSubFilters() {
    const now = new Date();
    const iso = getISOWeekNumber(now);
    ui.pieChartYear = iso.year;
    ui.pieChartWeek = iso.week;
    ui.pieChartMonth = now.getMonth() + 1;
    ui.pieChartQuarter = Math.floor(now.getMonth() / 3) + 1;
  }

  function renderPieSubFilterOptions() {
    const years = getPieChartYears();

    els.pieYearSelect.innerHTML = years
      .map((y) => `<option value="${y}">${y}年</option>`)
      .join("");
    if (!years.map(String).includes(String(ui.pieChartYear))) {
      ui.pieChartYear = years[0] || new Date().getFullYear();
    }
    els.pieYearSelect.value = String(ui.pieChartYear);

    renderPieWeekOptions(ui.pieChartWeek);

    els.pieMonthSelect.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((m) => `<option value="${m}">${m}月</option>`)
      .join("");
    els.pieMonthSelect.value = String(ui.pieChartMonth);

    const quarterLabels = ["第一季度", "第二季度", "第三季度", "第四季度"];
    els.pieQuarterSelect.innerHTML = quarterLabels
      .map((label, i) => `<option value="${i + 1}">${label}</option>`)
      .join("");
    els.pieQuarterSelect.value = String(ui.pieChartQuarter);
  }

  function updatePieSubFilterVisibility() {
    const period = ui.chartPeriod;
    els.pieWeekFilterWrap.hidden = period !== "week";
    els.pieMonthFilterWrap.hidden = period !== "month";
    els.pieQuarterFilterWrap.hidden = period !== "quarter";
  }

  function getPieChartDateRange() {
    const period = ui.chartPeriod;
    const year = parseInt(ui.pieChartYear, 10) || new Date().getFullYear();
    let start;
    let end;

    switch (period) {
      case "week": {
        const week = parseInt(ui.pieChartWeek, 10) || 1;
        ({ start, end } = getWeekDateRange(year, week));
        break;
      }
      case "month": {
        const month = parseInt(ui.pieChartMonth, 10) || 1;
        start = new Date(year, month - 1, 1);
        end = new Date(year, month, 0);
        break;
      }
      case "quarter": {
        const quarter = parseInt(ui.pieChartQuarter, 10) || 1;
        const qStart = (quarter - 1) * 3;
        start = new Date(year, qStart, 1);
        end = new Date(year, qStart + 3, 0);
        break;
      }
      case "year":
        start = new Date(year, 0, 1);
        end = new Date(year, 11, 31);
        break;
      default:
        start = new Date(year, 0, 1);
        end = new Date(year, 11, 31);
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  function isDateInPieChartPeriod(dateStr) {
    const date = parseDate(dateStr);
    const { start, end } = getPieChartDateRange();
    return date >= start && date <= end;
  }

  function getPieChartPeriodLabel() {
    const year = ui.pieChartYear;
    switch (ui.chartPeriod) {
      case "week": {
        const { start, end } = getWeekDateRange(year, ui.pieChartWeek);
        return `${year}年 第${ui.pieChartWeek}周 (${formatMMDD(start)} - ${formatMMDD(end)})`;
      }
      case "month":
        return `${year}年 ${ui.pieChartMonth}月`;
      case "quarter": {
        const names = ["一", "二", "三", "四"];
        return `${year}年 第${names[ui.pieChartQuarter - 1] || "一"}季度`;
      }
      case "year":
        return `${year}年`;
      default:
        return "";
    }
  }

  function onPieYearChange() {
    ui.pieChartYear = parseInt(els.pieYearSelect.value, 10) || ui.pieChartYear;

    if (ui.chartPeriod === "week") {
      renderPieWeekOptions(getDefaultWeekForYear(ui.pieChartYear));
    }

    refreshPieChart();
  }

  function onPieWeekChange() {
    ui.pieChartWeek = parseInt(els.pieWeekSelect.value, 10) || ui.pieChartWeek;
    refreshPieChart();
  }

  function onPieMonthChange() {
    ui.pieChartMonth = parseInt(els.pieMonthSelect.value, 10) || ui.pieChartMonth;
    refreshPieChart();
  }

  function onPieQuarterChange() {
    ui.pieChartQuarter = parseInt(els.pieQuarterSelect.value, 10) || ui.pieChartQuarter;
    refreshPieChart();
  }

  function onPiePeriodTabChange(period) {
    ui.chartPeriod = period;
    updatePieSubFilterVisibility();

    if (period === "week") {
      renderPieWeekOptions(getDefaultWeekForYear(ui.pieChartYear));
    }

    refreshPieChart();
  }

  // ==================== 走势数据（折线图） ====================
  function sumIncomeOnDate(dateStr) {
    let total = 0;
    getViewRecords().forEach((r) => {
      if (r.type === "income" && r.date === dateStr) {
        total += parseRecordAmount(r);
      }
    });
    return total;
  }

  function sumExpenseOnDate(dateStr) {
    let total = 0;
    getViewRecords().forEach((r) => {
      if (countsTowardExpense(r) && r.date === dateStr) {
        total += parseRecordAmount(r);
      }
    });
    return total;
  }

  function sumIncomeInMonth(year, monthIndex) {
    let total = 0;
    getViewRecords().forEach((r) => {
      if (r.type !== "income") return;
      const d = parseDate(r.date);
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        total += parseRecordAmount(r);
      }
    });
    return total;
  }

  function sumExpenseInMonth(year, monthIndex) {
    let total = 0;
    getViewRecords().forEach((r) => {
      if (!countsTowardExpense(r)) return;
      const d = parseDate(r.date);
      if (d.getFullYear() === year && d.getMonth() === monthIndex) {
        total += parseRecordAmount(r);
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
      const year = today.getFullYear();
      for (let m = 0; m < 12; m++) {
        labels.push(`${m + 1}月`);
        incomeData.push(sumIncomeInMonth(year, m));
        expenseData.push(sumExpenseInMonth(year, m));
      }
    }

    const hasData =
      expenseData.some((v) => v > 0) || incomeData.some((v) => v > 0);

    return { labels, incomeData, expenseData, hasData };
  }

  // ==================== 统计 ====================
  function calcDashboardStats() {
    const today = todayString();
    let monthIncome = 0;
    let monthExpense = 0;
    let todayExpense = 0;

    getViewRecords().forEach((r) => {
      const amt = parseRecordAmount(r);
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

  function aggregateExpenseByCategory() {
    const map = {};
    getViewRecords().forEach((r) => {
      if (!countsTowardExpense(r)) return;
      if (!isDateInPieChartPeriod(r.date)) return;
      const cat = normalizeCategory(r.category);
      map[cat] = (map[cat] || 0) + parseRecordAmount(r);
    });
    return map;
  }

  // ==================== 历史筛选 ====================
  function renderHistoryFilterOptions() {
    const current = ui.historyFilter;
    const options = [{ value: "all", label: "📋 全部" }];
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
    return [...getViewRecords()].sort((a, b) => {
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
  function isChartJsReady() {
    if (typeof Chart === "undefined") {
      console.warn("[随手记] Chart.js 未加载，图表跳过渲染。请检查网络或 CDN。");
      return false;
    }
    return true;
  }

  function showChartLoadError() {
    const msg = "图表库加载失败，请检查网络后刷新页面";
    if (els.chartEmpty) {
      els.chartEmpty.textContent = msg;
      els.chartEmpty.hidden = false;
    }
    if (els.trendChartEmpty) {
      els.trendChartEmpty.textContent = msg;
      els.trendChartEmpty.hidden = false;
    }
    if (els.expenseChart) els.expenseChart.hidden = true;
    if (els.trendChart) els.trendChart.hidden = true;
  }

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
    if (!isChartsPageVisible()) return;
    if (!isChartJsReady()) {
      showChartLoadError();
      return;
    }

    els.chartEmpty.textContent = "当前筛选条件暂无数据";

    const aggregated = aggregateExpenseByCategory();
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

    try {
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
              generateLabels(chart) {
                const dataset = chart.data.datasets[0];
                const total = dataset.data.reduce((sum, v) => sum + v, 0);
                return chart.data.labels.map((label, i) => {
                  const value = dataset.data[i];
                  const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
                  const icon = getCategoryIcon("expense", label);
                  return {
                    text: `${icon} ${label} (${pct}%)`,
                    fillStyle: dataset.backgroundColor[i],
                    strokeStyle: dataset.borderColor,
                    lineWidth: dataset.borderWidth,
                    hidden: chart.getDataVisibility(i) === false,
                    index: i,
                  };
                });
              },
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                const icon = getCategoryIcon("expense", ctx.label);
                return ` ${icon} ${ctx.label}: ¥${ctx.raw.toFixed(2)} (${pct}%)`;
              },
              title() {
                return getPieChartPeriodLabel() + " 支出占比";
              },
            },
          },
        },
      },
    });
    } catch (err) {
      console.error("[随手记] 饼图初始化失败", err);
      showChartLoadError();
    }
  }

  function refreshLineChart() {
    if (!isChartsPageVisible()) return;
    if (!isChartJsReady()) {
      showChartLoadError();
      return;
    }

    els.trendChartEmpty.textContent = "当前筛选条件暂无数据";

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

    try {
      lineChartInstance = new Chart(els.trendChart, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "收入",
            data: incomeData,
            hidden: true,
            borderColor: incomeColor,
            backgroundColor: incomeColor + "22",
            fill: true,
            tension: 0,
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
            tension: 0,
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
              font: { size: period === "month" ? 8 : period === "year" ? 9 : 10 },
              maxRotation: 0,
              autoSkip: period !== "year",
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
    } catch (err) {
      console.error("[随手记] 折线图初始化失败", err);
      showChartLoadError();
    }
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

    markRecordUpdated(record);
    saveData();
    closeEditModal();
    renderAll();
    triggerBackgroundSync();
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
    untrackDeletedId(pendingUndo.record.id);
    state.records.push(pendingUndo.record);
    markRecordUpdated(pendingUndo.record);
    saveData();
    clearPendingUndo();
    renderAll();
    triggerBackgroundSync();
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
    const creator = normalizeCreator(record.creator);
    const creatorCls = creator === CREATOR.FEMALE ? "record-creator-tag--female" : "record-creator-tag--male";
    const creatorIcon = CREATOR_ICONS[creator] || CREATOR_ICONS.male;
    const creatorAria = CREATOR_ARIA[creator] || CREATOR_ARIA.male;
    const creatorTagHtml = isFamilyLedgerEnabled()
      ? `<span class="record-creator-tag ${creatorCls}" role="img" aria-label="${creatorAria}">${creatorIcon}</span>`
      : "";

    li.innerHTML = `
      <div class="record-icon">${icon}</div>
      <div class="record-info">
        <div class="record-top">
          <span class="record-category">
            ${catText}
            <span class="record-type-tag ${tagClass}">${typeLabel}</span>
            ${creatorTagHtml}
          </span>
          <div class="record-amount-col">
            ${reimburseBtn}
            <span class="record-amount ${amountClass}">${sign}${formatMoney(Number(record.amount))}</span>
          </div>
        </div>
        <div class="record-bottom">
          <span>${record.date}</span>
          <span class="record-note">${noteText}</span>
        </div>
      </div>
      <div class="record-actions">
        <button type="button" class="btn-edit" data-action="edit" data-id="${record.id}" aria-label="编辑">${EDIT_ICON_SVG}</button>
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

    const sum = filtered.reduce((acc, r) => acc + parseRecordAmount(r), 0);
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
    renderPieSubFilterOptions();
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
    const now = Date.now();
    const record = {
      id: generateId(),
      type: ui.recordType,
      amount,
      category,
      date: els.date.value,
      note: els.note.value.trim(),
      creator: getBoundDeviceCreator(),
      createdAt: now,
      updatedAt: now,
    };

    if (ui.recordType === "expense" && category === REIMBURSE_CATEGORY) {
      record.reimburseStatus = REIMBURSE.PENDING;
    }

    state.records.push(record);
    saveData();
    renderAll();
    triggerBackgroundSync();

    els.amount.value = "";
    els.note.value = "";
  }

  function handleDelete(id) {
    const record = state.records.find((r) => r.id === id);
    if (!record) return;

    saveSnapshotBeforeOverwrite();
    trackDeletedId(id);

    state.records = state.records.filter((r) => r.id !== id);
    saveData();
    renderAll();
    showUndoToast(record);
    triggerBackgroundSync();
  }

  function toggleReimburseStatus(id) {
    const record = state.records.find((r) => r.id === id);
    if (!record || !isReimbursableRecord(record)) return;

    record.reimburseStatus =
      record.reimburseStatus === REIMBURSE.REIMBURSED
        ? REIMBURSE.PENDING
        : REIMBURSE.REIMBURSED;

    markRecordUpdated(record);
    saveData();
    renderAll();
    triggerBackgroundSync();
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
    bindBackupEvents();
    bindFamilyLedgerEvents();
    bindHouseholdViewEvents();
    bindWebDAVEvents();
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
        onPiePeriodTabChange(tab.dataset.period);
      });
    });

    els.pieYearSelect.addEventListener("change", onPieYearChange);
    els.pieWeekSelect.addEventListener("change", onPieWeekChange);
    els.pieMonthSelect.addEventListener("change", onPieMonthChange);
    els.pieQuarterSelect.addEventListener("change", onPieQuarterChange);

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
    initPieChartSubFilters();
    renderPieSubFilterOptions();
    updatePieSubFilterVisibility();
    syncHouseholdViewTabsUI();
    applyFamilyLedgerUI();
    renderWebDAVForm();
    bindEvents();
    renderAll();
    updateSnapshotButtonState();

    if (isFamilyLedgerEnabled() && isWebDAVConfigured()) {
      syncWithFlyNAS({ silent: true }).catch(() => {});
    }

    if (!isChartJsReady()) {
      console.warn(`随手记 v${APP_VERSION} 已就绪，但 Chart.js 未加载`);
    } else {
      console.info(`随手记 v${APP_VERSION} 已就绪 · 机主无感家庭账本`);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
