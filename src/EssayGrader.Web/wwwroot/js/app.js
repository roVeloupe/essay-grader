// 高中作文 AI 批改系统 · 前端逻辑（1:1 仿微信电脑版）
(() => {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- 状态 ----------
  const state = {
    essays: [],          // 列表（当前批次，按文件名排序）
    batches: [],         // 全部批阅记录（批次）
    currentBatchId: 0,   // 当前批次
    templates: [],       // 标准模板
    settings: null,
    nav: "grade",        // 当前导航：grade/templates/records/engine/settings
    currentId: null,     // 当前选中作文
    detail: null,        // 当前作文详情 {essay, sentences, grading}
    selectedCorrectTemplate: null,
    editing: null        // 编辑中的模板
  };

  const VERDICT = { 0: "Ok", 2: "Calculus", 1: "Polish", 3: "Verify" };
  const STATUS_TEXT = { Pending: "待识别", Recognizing: "识别中…", Recognized: "已识别", Correcting: "校对中…", Corrected: "已校对", Grading: "批阅中…", Graded: "已批阅" };
  const COLOR = ["#07c160", "#576b95", "#f0a05a", "#5a87f0", "#9b6bef", "#5fc9a6", "#e07a7a", "#4fa3c7"];

  // ---------- 工具 ----------
  async function api(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); if (j.message) msg = j.message; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }
  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), ms);
  }
  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function colorFor(name, i) { return COLOR[(i ?? 0) % COLOR.length]; }

  // ---------- 启动 ----------
  async function init() {
    bindNav();
    bindImports();
    bindBatches();
    bindMainEmpty();
    try { await loadTemplates(); } catch (e) {}
    try { const s = await api("/api/settings"); state.settings = s; } catch (e) {}
    try {
      await loadBatches();
      // 恢复上次批次；无批次则自动建一个（批阅记录）
      const saved = +(localStorage.getItem("eg_current_batch") || 0);
      const hit = state.batches.find((b) => b.id === saved);
      if (hit) await setCurrentBatch(hit.id);
      else if (state.batches.length) await setCurrentBatch(state.batches[0].id);
      else await newBatch();
    } catch (e) { state.essays = []; renderList(); if (state.nav === "grade") renderGradeEmpty(); }
    checkConn();
  }

  // ---------- 批次（批阅记录） ----------
  function fmtTime(s) {
    try { const d = new Date(s); return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; }
  }

  async function loadBatches() {
    state.batches = await api("/api/batches");
    renderBatchTag();
    if (state.nav === "records") renderRecords();
  }

  function batchName(id) {
    const b = state.batches.find((x) => x.id === id);
    return b ? b.name : "";
  }

  async function setCurrentBatch(id) {
    state.currentBatchId = id;
    localStorage.setItem("eg_current_batch", String(id));
    renderBatchTag();
    await refreshEssays();
  }

  function renderBatchTag() {
    const tag = $("#batchTag");
    if (!tag) return;
    const b = state.batches.find((x) => x.id === state.currentBatchId);
    tag.textContent = b ? `📁 ${b.name}（${b.essayCount} 篇）` : "📁 选择批阅记录";
    tag.title = "点击切换批阅记录";
  }

  async function newBatch() {
    const name = prompt("新建批阅记录：\n（例如：高二3班 月考作文 2026-09-08）", defaultBatchName());
    if (!name || !name.trim()) return;
    try {
      const b = await api("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      await loadBatches();
      await setCurrentBatch(b.id);
      toast("已创建批阅记录「" + b.name + "」，现在导入的图片会归入该记录");
    } catch (e) { toast("新建失败：" + e.message); }
  }

  function defaultBatchName() {
    const d = new Date();
    return `作文批阅 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function renameBatch(id) {
    const b = state.batches.find((x) => x.id === id); if (!b) return;
    const name = prompt("重命名批阅记录：", b.name);
    if (!name || !name.trim()) return;
    api("/api/batches/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), note: b.note || "" }) })
      .then(() => { loadBatches(); if (state.currentBatchId === id) { renderBatchTag(); refreshEssays(); } })
      .catch((e) => toast("重命名失败：" + e.message));
  }

  async function removeBatch(id) {
    const b = state.batches.find((x) => x.id === id); if (!b) return;
    if (!confirm("删除批阅记录「" + b.name + "」？其下作文将从记录中移除（图片文件仍保留在数据目录）。")) return;
    try {
      await api("/api/batches/" + id, { method: "DELETE" });
      await loadBatches();
      if (state.currentBatchId === id) {
        if (state.batches.length) await setCurrentBatch(state.batches[0].id);
        else { state.currentBatchId = 0; localStorage.removeItem("eg_current_batch"); renderBatchTag(); await refreshEssays(); }
      }
      toast("已删除记录");
    } catch (e) { toast("删除失败：" + e.message); }
  }

  function bindBatches() {
    $("#batchTag").addEventListener("click", openBatchPicker);
    $("#btnNewBatch").addEventListener("click", newBatch);
    $("#btnAddBatch").addEventListener("click", newBatch);
    document.addEventListener("click", (e) => { if (!e.target.closest(".batch-picker") && !e.target.closest("#batchTag")) $(".batch-picker")?.remove(); });
  }

  function openBatchPicker() {
    $(".batch-picker")?.remove();
    const tag = $("#batchTag");
    const p = el(`<div class="batch-picker">
      ${state.batches.length ? state.batches.map((b) => `<div class="bp-item ${b.id === state.currentBatchId ? "on" : ""}" data-id="${b.id}">📁 ${escapeHtml(b.name)}<span class="bp-num">${b.essayCount} 篇 / ${b.gradedCount} 已批</span></div>`).join("") : '<div class="bp-item" style="color:#999">暂无批阅记录</div>'}
      <div class="bp-item" data-new="1" style="color:var(--green);font-weight:600">＋ 新建批阅记录</div>
    </div>`);
    const r = tag.getBoundingClientRect();
    p.style.left = r.left + "px";
    p.style.top = (r.bottom + 4) + "px";
    document.body.appendChild(p);
    p.querySelectorAll(".bp-item[data-id]").forEach((it) => it.addEventListener("click", () => { p.remove(); setCurrentBatch(+it.dataset.id); }));
    const nw = p.querySelector(".bp-item[data-new]");
    if (nw) nw.addEventListener("click", () => { p.remove(); newBatch(); });
  }

  // 右侧空态：大引导按钮（比左侧列表底部的小按钮更醒目）
  function bindMainEmpty() {
    const bigImport = $("#bigImport");
    const bigBatch = $("#bigBatch");
    if (bigImport) bigImport.addEventListener("click", () => $("#importInput").click());
    if (bigBatch) bigBatch.addEventListener("click", runBatch);
  }

  async function checkConn() {
    const tag = $("#connTag");
    try {
      const r = await api("/api/test", { method: "POST" });
      tag.className = "conn ok"; tag.innerHTML = '<span class="dot"></span>StepFun 已连接';
      toast("StepFun Plan 已连通");
    } catch (e) {
      tag.className = "conn err"; tag.innerHTML = '<span class="dot"></span>' + (e.message || "未连接");
    }
  }

  // ---------- 导航 ----------
  function bindNav() {
    $$(".nav-item").forEach((it) => {
      it.addEventListener("click", () => setNav(it.dataset.nav));
    });
    $("#btnSettings").addEventListener("click", () => setNav("settings"));
    // 关闭弹窗
    $$("[data-close]").forEach((b) => b.addEventListener("click", (e) => {
      const id = e.target.dataset.close; $("#" + id).style.display = "none";
    }));
  }
  function setNav(nav) {
    state.nav = nav;
    $$(".nav-item").forEach((i) => i.classList.toggle("active", i.dataset.nav === nav));
    $$(".view-area").forEach((v) => v.style.display = "none");
    $("#view-" + nav).style.display = "flex";
    const titles = { grade: "作文批阅", templates: "批阅标准", records: "批阅记录", engine: "引擎状态", settings: "设置" };
    $("#midTitle").textContent = titles[nav];
    if (nav === "grade") {
      $("#midFoot").style.display = "";
      renderList();
      renderGradeEmpty();
    }
    if (nav === "templates") { renderTemplates(); $("#midFoot").style.display = "none"; }
    if (nav === "records") { renderRecords(); $("#midFoot").style.display = "none"; }
    if (nav === "engine") { renderEngine(); $("#midFoot").style.display = "none"; }
    if (nav === "settings") { openSettings(); $("#midFoot").style.display = "none"; }
  }

  // 右侧空态：没有 currentId 或无作文时的大引导区
  function renderGradeEmpty() {
    const grade = $("#view-grade");
    if (state.currentId) return; // 选中作文时 renderGradeView 会接管
    const count = state.essays.length;
    grade.innerHTML = `
      <div class="main-empty">
        <div class="me-icon">📄</div>
        <div class="me-title">${count ? "选一篇作文开始批阅" : "开始批改你的第一篇作文"}</div>
        <div class="me-sub">支持一次选择多张 JPG / PNG 扫描图片（Ctrl/Shift 多选），<br>按文件名自然排序导入后即自动逐张批阅（识别 → 校对比对 → 评分），<br>完成后点「导出报告」即可按文件名顺序导出全部结果。</div>
        <button class="btn-big" id="bigImport">＋ 导入作文图片（可多选）</button>
        ${count ? `<button class="btn-big ghost" id="bigBatch">⏩ 一键批阅全部（${count} 篇）</button>` : ""}
        <div class="me-hint">提示：也可点击左侧列表底部的小按钮</div>
      </div>`;
    bindMainEmpty();
  }

  // ---------- 导入与列表 ----------
  function bindImports() {
    $("#btnImport").addEventListener("click", () => $("#importInput").click());
    $("#importInput").addEventListener("change", async (e) => {
      const files = e.target.files; if (!files.length) return;
      if (!state.currentBatchId) { toast("请先选择或新建一个批阅记录"); return; }
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      toast(`正在导入 ${files.length} 张图片到「${batchName(state.currentBatchId)}」…`);
      try {
        await api("/api/import?batchId=" + state.currentBatchId, { method: "POST", body: fd });
        await refreshEssays();
        // 一键到底：导入后自动按文件名顺序逐张批阅（识别→校对→评分）
        await runBatch(true);
      } catch (err) { toast("导入失败：" + err.message); }
      e.target.value = "";
    });
    $("#btnBatch").addEventListener("click", runBatch);
    $("#searchInput").addEventListener("input", renderList);
  }

  async function refreshEssays() {
    state.essays = await api("/api/essays?batchId=" + (state.currentBatchId || 0));
    if (state.currentId && !state.essays.some((x) => x.id === state.currentId)) state.currentId = null;
    renderList();
    if (state.nav === "grade") renderGradeEmpty();
    if (state.nav === "records") renderRecords();
  }

  function renderList() {
    const kw = ($("#searchInput").value || "").trim();
    const list = state.essays.filter((e) => !kw || (e.fileName + e.title + e.author).includes(kw));
    const root = $("#listRoot");
    $("#midCount").textContent = state.essays.length ? `${state.essays.length} 篇` : "";
    root.innerHTML = "";
    if (!list.length) { root.innerHTML = '<div class="empty">暂无作文，点击下方「导入图片」</div>'; return; }
    list.forEach((e, i) => {
      const item = el(`
        <div class="essay-item ${e.id === state.currentId ? "active" : ""}" data-id="${e.id}">
          <div class="avatar" style="background:${colorFor(e.author || e.fileName, i)}">${(e.author || e.fileName[0] || "文").slice(0, 1)}</div>
          <div class="ei-info">
            <div class="ei-top"><span class="ei-name" title="${e.fileName}">${escapeHtml(e.title || e.fileName)}</span><span class="ei-num">#${e.sortOrder}</span></div>
            <div class="ei-msg">${escapeHtml((e.author ? "作者:" + e.author + " · " : "") + (STATUS_TEXT[e.status] || e.status))}</div>
          </div>
          <span class="badge ${e.status}">${STATUS_TEXT[e.status] || e.status}</span>
        </div>`);
      item.addEventListener("click", () => selectEssay(e.id));
      root.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- 选中作文 ----------
  async function selectEssay(id) {
    state.currentId = id;
    renderList();
    toast("加载中…");
    try { state.detail = await api("/api/essays/" + id); }
    catch (e) { toast("加载失败：" + e.message); return; }
    renderGradeView();
  }
  function essayRow() { return state.detail ? state.detail.essay : null; }
  function sentences() { return (state.detail && state.detail.sentences) || []; }

  function renderFooter() {
    const cur = state.essays.findIndex((e) => e.id === state.currentId);
    const foot = $("#view-grade").querySelector(".m-actions");
    if (foot) {
      const left = $("#view-grade").querySelector(".m-actions");
      left.innerHTML = `
        <span class="step">进度：<b>${cur + 1}</b> / ${state.essays.length} 篇</span>
        <div class="right-btns">
          <button class="btn2 ghost" data-prev>◂ 上一篇</button>
          <button class="btn2 ghost" data-next>下一篇 ▸</button>
        </div>`;
      left.querySelector("[data-prev]").onclick = () => stepEssay(-1);
      left.querySelector("[data-next]").onclick = () => stepEssay(1);
    }
  }
  function stepEssay(d) {
    const cur = state.essays.findIndex((e) => e.id === state.currentId);
    const next = state.essays[cur + d];
    if (next) selectEssay(next.id);
  }

  // ---------- 工作台视图 ----------
  function renderGradeView() {
    const e = essayRow();
    if (!e) { renderGradeEmpty(); return; }
    state.selectedCorrectTemplate = state.selectedCorrectTemplate || defaultTemplateId();
    const canWork = state.settings && state.settings.stepFun && state.settings.stepFun.hasKey;
    const grading = state.detail.grading;

    $("#view-grade").innerHTML = `
      <div class="m-head">
        <h2>${escapeHtml(e.fileName)}</h2>
        <span class="sub">${escapeHtml(e.title ? `《${e.title}》 · ${e.author || "佚名"}` : "尚未识别标题/作者")}</span>
        <div class="rh">
          <select class="btn2" id="tplSelect">${state.templates.map((t) => `<option value="${t.id}" ${t.id === state.selectedCorrectTemplate ? "selected" : ""}>标准：${escapeHtml(t.name)}（${t.totalScore}分）</option>`).join("")}</select>
          <span class="tag">${STATUS_TEXT[e.status] || e.status}</span>
          ${grading ? `<span class="tag on">${grading.total} 分 · ${grading.level}</span>` : ""}
        </div>
      </div>
      <div class="m-body">
        <div class="view-tabs" id="viewTabs" style="display:none"></div>
        ${!e.hasImage || e.status === "Pending" ? `<div class="orig-empty" style="margin:auto;padding:30px">${!canWork ? "请先在「设置」中配置或启用 StepFun 连接" : e.hasImage ? "点击下方「识别」开始处理" : "该作文暂无原图"}</div>` : ""}
        <div id="bodyPane"></div>
      </div>
      <div class="m-actions"></div>
      <div class="toolbar" style="display:none"></div>`;

    const body = $("#bodyPane");
    body.style.display = "none";

    // 底部操作条
    renderFooter();
    buildWorkButtons(e, canWork);

    // 若已有内容，切换到识别校对视图（内嵌三个 tab 条）
    if (e.hasImage) { renderTabs(e); toggleTab("correct"); }
    if (canWork) $("#tplSelect").addEventListener("change", (ev) => { state.selectedCorrectTemplate = +ev.target.value; });
  }

  function buildWorkButtons(e, canWork) {
    const o = $$(".m-actions")[0];
    const btns = document.createElement("div");
    btns.className = "right-btns";
    const DEF = [
      ["识别", "recognize", e.status === "Pending" || e.status === "Recognized"],
      ["纠错&校对比对", "correct", e.status !== "Pending" && (e.status === "Recognized" || e.status === "Corrected")],
      ["按标准批阅", "grade", (e.status === "Corrected" || e.status === "Graded")]
    ];
    for (const [txt, act, en] of DEF) {
      const b = el(`<button class="btn2 ${act === "grade" ? "green" : ""}" ${en && canWork ? "" : "disabled"}>${txt}</button>`);
      b.onclick = () => runAction(act, b);
      btns.appendChild(b);
    }
    const exp = el(`<button class="btn2 ghost">导出报告</button>`);
    exp.onclick = exportReport;
    btns.appendChild(exp);
    o.appendChild(btns);
  }

  // ---------- 识别/校对/批阅 ----------
  async function runAction(act, btn) {
    const id = state.currentId;
    btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="spin"></span> 处理中…';
    try {
      toast(act === "recognize" ? "识别中（调用 step-3.7-flash 多模态）…" : act === "correct" ? "纠错+校对比对中…" : "AI 批阅中…");
      if (act === "recognize") state.detail = await api(`/api/essays/${id}/recognize`, { method: "POST" });
      if (act === "correct") state.detail = await api(`/api/essays/${id}/correct`, { method: "POST" });
      if (act === "grade") state.detail.grading = await api(`/api/essays/${id}/grade?templateId=${state.selectedCorrectTemplate ?? ""}`, { method: "POST" });
      await refreshEssays(); renderGradeView(); toggleTab(act === "grade" ? "result" : "correct");
      toast(act === "recognize" ? "识别完成" : act === "correct" ? "校对比对完成" : "批阅完成");
    } catch (err) {
      toast("处理失败：" + err.message);
    } finally {
      btn.disabled = false; btn.innerHTML = old;
    }
  }

  async function runBatch(auto) {
    if (!state.essays.length) return toast("请先导入图片");
    const tpl = state.selectedCorrectTemplate || defaultTemplateId();
    if (!tpl) return toast("请先在「批阅标准」中创建或选择评分标准");
    const total = state.essays.length;
    toast(`${auto ? "已导入，开始自动" : "开始"}批量批阅：${total} 篇，按文件名顺序逐张处理…`);
    let ok = 0, fail = 0;
    for (let i = 0; i < total; i++) {
      const e = state.essays[i];
      try {
        toast(`[${i + 1}/${total}] ${e.fileName}：识别中…`);
        await api(`/api/essays/${e.id}/recognize`, { method: "POST" });
        toast(`[${i + 1}/${total}] ${e.fileName}：校对中…`);
        await api(`/api/essays/${e.id}/correct`, { method: "POST" });
        toast(`[${i + 1}/${total}] ${e.fileName}：批阅中…`);
        await api(`/api/essays/${e.id}/grade?templateId=${tpl}`, { method: "POST" });
        ok++;
      } catch (err) {
        fail++;
        toast(`[${i + 1}/${total}] ${e.fileName} 处理失败：${err.message}，跳过继续`);
      }
    }
    await refreshEssays();
    if (state.currentId) await selectEssay(state.currentId);
    toast(`批量完成：成功 ${ok}，失败 ${fail}。点「导出报告」按文件名顺序导出`);
  }

  async function exportReport() {
    try {
      const r = await api("/api/export?batchId=" + (state.currentBatchId || 0), { method: "POST" });
      const a = document.createElement("a");
      a.href = "data:text/markdown;charset=utf-8," + encodeURIComponent(r.text);
      a.download = `批阅报告${batchName(state.currentBatchId) ? "-" + batchName(state.currentBatchId) : ""}.md`.replace(/[\\/:*?"<>|]/g, "");
      a.click();
      toast("已导出：" + r.path);
    } catch (e) { toast("导出失败：" + e.message); }
  }

  // ---------- 三个 tab：原图 / 识别校对 / 批阅结果 ----------
  function renderTabs(e) {
    const tabs = $("#viewTabs");
    tabs.style.display = "flex";
    tabs.innerHTML = ["原图", "识别与校对", "批阅结果"].map((t, i) => `<span class="tag" data-tab="${["orig", "correct", "result"][i]}">${t}</span>`).join("");
    $$("#viewTabs .tag").forEach((t) => t.addEventListener("click", () => toggleTab(t.dataset.tab)));
  }

  function toggleTab(tab) {
    const pane = $("#bodyPane");
    pane.innerHTML = "";
    if (tab === "orig") { renderOrig(pane); return; }
    if (tab === "correct") { renderCorrect(pane); return; }
    renderResult(pane);
    $$("#viewTabs .tag").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  }

  function renderOrig(pane) {
    pane.style.display = "flex";
    const e = essayRow();
    pane.innerHTML = e.hasImage ? `<div class="orig-wrap"><img src="/api/essays/${e.id}/image" alt="原图"></div>` : `<div class="orig-empty" style="margin:auto">无原图</div>`;
  }

  function renderCorrect(pane) {
    pane.style.display = "";
    const s = sentences();
    if (!s.length) { pane.innerHTML = '<div class="empty">尚未识别。点击「识别」提取标题/正文/姓名。</div>'; return; }
    pane.className = "fade";
    pane.innerHTML = `<div class="correct-wrap"><div class="correct-date">— AI 已识别正文，逐句校对，可编辑 —</div></div>`;
    const wrap = pane.querySelector(".correct-wrap");
    s.forEach((sentence, idx) => {
      const needs = sentence.needsVerify !== false && sentence.needVerify;
      const bubble = el(`
        <div class="msg ai" data-idx="${idx}">
          <div class="av">AI</div>
          <div class="bubble ${needs ? "flag" : ""}">
            <div class="meta">第${sentence.index}句 · 置信度 ${Math.round((sentence.confidence || 1) * 100)}%${sentence.verdict === "Verify" ? " · ⚠ 存疑待复核" : ""}</div>
            <div class="text-body">${escapeHtml(sentence.text || "")}</div>
            ${sentence.notes && sentence.verdict !== "Verify" ? `<div class="notes">✏ ${escapeHtml(sentence.notes)}</div>` : ""}
            <div class="sent-opts">
              <span class="sopt" data-bo="edit">✎ 修改</span>
              <span class="sopt" data-bo="detach">恢复原文字</span>
            </div>
            <textarea data-field>${sentence.text || ""}</textarea>
          </div>
        </div>`);
      bubble.querySelector('[data-bo="edit"]').onclick = () => { const b = bubble.querySelector(".bubble"); b.classList.add("editing"); };
      bubble.querySelector('[data-bo="detach"]').onclick = () => { const b = bubble.querySelector(".bubble"); b.querySelector("textarea").value = sentence.originalText || b.querySelector(".text-body").textContent; b.classList.add("editing"); };
      bubble.querySelector("textarea").onblur = () => { saveSentences(); };
      wrap.appendChild(bubble);
    });
  }

  async function saveSentences() {
    const s = sentences();
    const updated = s.map((x, i) => {
      const area = $("#bodyPane").querySelectorAll(".msg.ai")[i];
      const ta = area && area.querySelector("textarea");
      if (ta && x.indexOf !== undefined) { x = Object.assign({}, x); x.text = ta.value; x.modified = ta.value !== (x.originalText || x.text); }
      return x;
    });
    try { await api(`/api/essays/${state.currentId}/sentences`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated.map((x) => ({ ...x, verdict: x.verdict || "Ok" }))) }); }
    catch (e) { toast("保存句子失败：" + e.message); }
  }

  function renderResult(pane) {
    pane.style.display = "";
    const g = state.detail.grading;
    if (!g) { pane.innerHTML = '<div class="empty">尚未批阅。点击「按标准批阅」。</div>'; return; }
    const pros = g.items.filter((i) => i.kind === "Pro");
    const againsts = g.items.filter((i) => i.kind === "Against");
    const suggests = g.items.filter((i) => i.kind === "Suggestion");
    const dimsHtml = g.dimensionScores.map((d) => {
      const pct = Math.min(100, (d.score / (d.maxScore || 1)) * 100);
      return `<div class="dim"><div class="dn">${escapeHtml(d.dimName)}</div><div class="ds">${d.score}<span style="font-size:12px;color:#999"> / ${d.maxScore}</span></div><div class="dbar"><div class="dfill" style="width:${pct}%"></div></div></div>`;
    }).join("");
    pane.innerHTML = `
      <div class="result-wrap">
        <div class="score-hero">
          <div class="score-num">${g.total}</div>
          <div class="score-meta">
            <div class="lv">${escapeHtml(g.level)}</div>
            <div class="sum">${escapeHtml(g.summary)}</div>
          </div>
        </div>
        <div class="dims">${dimsHtml}</div>
        <div class="gblock pro"><h4>✅ 优点</h4>${blockList(pros)}</div>
        <div class="gblock against"><h4>⚠️ 缺点</h4>${blockList(againsts)}</div>
        <div class="gblock sugg"><h4>✏️ 修改建议</h4>${blockList(suggests)}</div>
      </div>`;
  }
  function blockList(items) {
    if (!items.length) return "<div style='color:#bbb;font-size:13px'>暂无</div>";
    return "<ul>" + items.map((i) => `<li>${escapeHtml(i.text)}${i.sourceSentence ? `<div class="src">原文：${escapeHtml(i.sourceSentence)}</div>` : ""}</li>`).join("") + "</ul>";
  }

  // ---------- 标准模板管理 ----------
  function defaultTemplateId() {
    const d = (state.templates || []).find((t) => t.isDefault);
    return d ? d.id : (state.templates[0] && state.templates[0].id) || null;
  }
  async function loadTemplates() { state.templates = await api("/api/templates"); }

  function renderTemplates() {
    const list = $("#tplList");
    list.innerHTML = "";
    if (!state.templates.length) { list.innerHTML = '<div class="empty">暂无标准，点击右上角新建</div>'; return; }
    state.templates.forEach((t) => {
      const card = el(`
        <div class="tpl-card">
          <div class="tc-top">
            <span class="tc-name">${escapeHtml(t.name)} ${t.isDefault ? "（默认）" : ""}</span>
            <span class="tc-total">满分 ${t.totalScore}</span>
            <div class="tc-ops">
              <button class="btn2" ${t.isDefault ? "disabled" : ""}>设为默认</button>
              <button class="btn2">编辑</button>
              <button class="btn2" >删除</button>
            </div>
          </div>
          <div class="dims-tag">维度：${t.dimensions.map((d) => escapeHtml(d.name) + "(" + d.maxScore + ")").join("、")}</div>
        </div>`);
      const [def, edit, del] = card.querySelectorAll("button");
      def.onclick = async () => { try { await api(`/api/templates/${t.id}/set-default`, { method: "POST" }); await loadTemplates(); renderTemplates(); toast("已设为默认"); } catch (e) { toast(e.message); } };
      edit.onclick = () => openTplEditor(t);
      del.onclick = async () => { if (!confirm("删除标准「" + t.name + "」？")) return; try { await api("/api/templates/" + t.id, { method: "DELETE" }); await loadTemplates(); renderTemplates(); } catch (e) { toast(e.message); } };
      list.appendChild(card);
    });
  }

  function openTplEditor(t) {
    state.editing = t ? JSON.parse(JSON.stringify(t)) : { name: "", totalScore: 60, isDefault: false, dimensions: [{ name: "内容立意", maxScore: 25, rule: "" }, { name: "语言表达", maxScore: 20, rule: "" }] };
    $("#tplModalTitle").textContent = t ? "编辑标准：" + t.name : "新建标准";
    renderModalBody();
    $("#tplModal").style.display = "flex";
  }

  function renderModalBody() {
    const t = state.editing;
    const body = $("#tplModalBody");
    body.innerHTML = `
      <div class="g-title">基本信息</div>
      <div class="field"><label>标准名称</label><input id="tplName" value="${escapeHtml(t.name)}"></div>
      <div class="field"><label>总分</label><input id="tplTotal" type="number" value="${t.totalScore}"></div>
      <div class="g-title">评分维度（名称 / 满分 / 评分规则）</div>
      <div id="dimList"></div>
      <button class="btn2" id="btnAddDim">＋ 添加维度</button>`;
    renderDimRows();
    $("#btnAddDim").onclick = () => { state.editing.dimensions.push({ name: "", maxScore: 10, rule: "" }); renderDimRows(); };
    $("#btnSaveTpl").onclick = saveTemplate;
  }

  function renderDimRows() {
    const list = $("#dimList");
    list.innerHTML = "";
    state.editing.dimensions.forEach((d, i) => {
      const row = el(`
        <div class="inputs-row">
          <input class="dn" placeholder="维度名称" value="${escapeHtml(d.name)}">
          <input class="ds" type="number" placeholder="满分" value="${d.maxScore}" style="width:80px">
          <input class="req" placeholder="评分规则（给 AI 的提示）" value="${escapeHtml(d.rule)}">
          <button class="btn2">✕</button>
        </div>`);
      const [nameI, scoreI, ruleI] = row.querySelectorAll("input");
      nameI.oninput = () => { d.name = nameI.value; };
      scoreI.oninput = () => { d.maxScore = +scoreI.value || 0; };
      ruleI.oninput = () => { d.rule = ruleI.value; };
      row.querySelector("button").onclick = () => { state.editing.dimensions.splice(i, 1); renderDimRows(); };
      list.appendChild(row);
    });
  }

  async function saveTemplate() {
    const t = state.editing;
    t.name = $("#tplName").value.trim(); t.totalScore = +$("#tplTotal").value || 0;
    if (!t.name) return toast("请填写标准名称");
    try {
      if (t.id) await api(`/api/templates/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t) });
      else await api("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(t) });
      $("#tplModal").style.display = "none";
      await loadTemplates(); renderTemplates(); toast("已保存标准");
    } catch (e) { toast("保存失败：" + e.message); }
  }

  // ---------- 批阅记录（按批次） ----------
  function renderRecords() {
    const list = $("#recordsList");
    list.innerHTML = "";
    if (!state.batches.length) { list.innerHTML = '<div class="empty">还没有批阅记录，点击右上角「＋ 新建批阅记录」</div>'; return; }
    state.batches.forEach((b) => {
      const card = el(`
        <div class="tpl-card ${b.id === state.currentBatchId ? "tpl-card-on" : ""}">
          <div class="tc-top">
            <span class="tc-name">${escapeHtml(b.name)}${b.id === state.currentBatchId ? "（当前）" : ""}</span>
            <span class="tc-total">${b.essayCount} 篇 · ${b.gradedCount} 已批</span>
            <div class="tc-ops">
              <button class="btn2 green">打开</button>
              <button class="btn2">重命名</button>
              <button class="btn2">删除</button>
            </div>
          </div>
          <div class="dims-tag">创建于 ${fmtTime(b.createdAt)}</div>
        </div>`);
      const [open, rename, del] = card.querySelectorAll("button");
      open.onclick = async () => { await setCurrentBatch(b.id); setNav("grade"); };
      rename.onclick = () => renameBatch(b.id);
      del.onclick = () => removeBatch(b.id);
      list.appendChild(card);
    });
  }

  // ---------- 引擎 + 设置 ----------
  function renderEngine() {
    $("#view-engine").innerHTML = `
      <div class="tpl-manage">
        <div class="tpl-head"><h3>StepFun 引擎（Step Plan · step-3.7-flash）</h3></div>
        <div class="tpl-card"><div style="font-size:13px;line-height:1.9;color:#333">
          Base URL：<code>${esc(state.settings && state.settings.stepFun.baseUrl)}</code><br>
          模型：<b>${esc(state.settings && state.settings.stepFun.model)}</b> · 推理强度：${esc(state.settings && state.settings.stepFun.reasoningEffort)} · max_tokens：${esc(state.settings && state.settings.stepFun.maxTokens)}<br>
          通道方式：<b>原生 base64 图片理解</b>（图片转 base64 随请求发送，不落地）<br>
          工作流：<b>识别 → 纠错&校对比对（对照原图）→ 按标准批阅</b><br>
          输出：按<b>文件名自然排序</b>，可整体导 Markdown 报告
        </div></div>
      </div>`;
  }

  function openSettings() {
    const s = state.settings; if (!s) { $("#view-settings").innerHTML = '<div class="empty">加载中…</div>'; return; }
    $("#view-settings").innerHTML = `
      <div class="tpl-manage">
        <div class="tpl-head"><h3>加载设置</h3></div>
        <div class="g-title">保存位置（批阅结果 / 导出文档）</div>
        <div class="field"><label>批阅结果目录</label><input id="setResults" value="${esc(s.save.resultsDir)}"><span class="hint">当前：${esc(s.save.resolvedResults)}</span></div>
        <div class="field"><label>导出文档目录</label><input id="setExport" value="${esc(s.save.exportDir)}"><span class="hint">当前：${esc(s.save.resolvedExport)}</span></div>
        <div class="field"><label>保存模式</label><select id="setMode"><option value="AskEachTime" ${s.save.mode === "AskEachTime" ? "selected" : ""}>每次询问</option><option value="AlwaysDefaultDir" ${s.save.mode === "AlwaysDefaultDir" ? "selected" : ""}>始终保存到默认目录</option></select></div>
        <div class="g-title">StepFun / 引擎</div>
        <div class="field"><label>API Key</label><input id="setKey" type="password" placeholder="已内置，可覆盖"><span class="hint">默认已内置 Step Plan Key</span></div>
        <div class="field"><label>推理强度</label><select id="setReason"><option value="low">low（快速）</option><option value="medium">medium</option><option value="high" ${s.stepFun.reasoningEffort === "high" ? "selected" : ""}>high（校对最稳）</option></select></div>
        <div class="field"><label>并发批阅</label><input id="setConc" type="number" value="${s.grading.concurrency}"></div>
      </div>`;
    $("#btnSaveSettings").onclick = saveSettings;
    $("#btnTestConn").onclick = checkConn;
  }

  function saveSettings() {
    const payload = {
      resultsDir: $("#setResults").value.trim(),
      exportDir: $("#setExport").value.trim(),
      mode: $("#setMode").value,
      reasoningEffort: $("#setReason").value,
      concurrency: +($("#setConc").value || 2)
    };
    const k = $("#setKey").value.trim(); if (k) payload.apiKey = k;
    toast("保存中…");
    api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(() => { $("#settingsModal").style.display = "none"; toast("设置已保存"); })
      .catch((e) => toast("保存失败：" + e.message));
  }

  function esc(v) { return escapeHtml(v); }

  window.addEventListener("DOMContentLoaded", () => init());
  // 双重保险：若 DOMContentLoaded 已触发（脚本在 load 后才执行），立即执行
  if (document.readyState !== "loading") init();
})();