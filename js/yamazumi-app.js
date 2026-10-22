/**
 * ============================================================================
 * LEAN CHRONO & MFV — PÁGINA DO YAMAZUMI (GRUPOS DE ESTUDOS)
 * ----------------------------------------------------------------------------
 * Tela + orquestração dos grupos. Mesmo armazenamento da cronoanálise e do MFV
 * (navegador + pasta do OneDrive, com controle de revisão contra conflito).
 * Lê os estudos de cronoanálise (somente leitura) para montar o gráfico.
 * Depende de: LeanCalc, LeanYamazumi, LeanStorage, LeanXlsx.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const Y = root.LeanYamazumi;
  const Store = root.LeanStorage;
  const STORE = Store.STORE_GROUPS;
  const DISK_SAVE_DELAY_MS = 3000;
  const $ = (id) => document.getElementById(id);
  const fmt = Calc.formatNumber;

  const state = {
    doc: null,
    computed: null,
    diskRevision: null,
    dirty: false,
    conflict: null,
    folder: "unsupported",
    saving: false,
    lastError: null,
    lastDiskSaveAt: null,
    changeSeq: 0,
    studyDocs: new Map(), // id → estudo (o mais recente entre navegador e pasta)
    options: [], // estudos para incluir: { key, id, product, productName, processName, clientName, fileName, tpMin }
    groupsCache: [], // grupos salvos: { doc, inFolder }
  };
  const IO = { normalize: Y.normalizeGroup, serialize: (g) => Y.serializeGroup(g, Y.computeGroup(g, state.studyDocs)) };
  let localTimer = null;
  let diskTimer = null;
  let writing = null;
  let pendingWrite = false;

  /* ==========================================================================
     UTILITÁRIOS DE TELA
     ========================================================================== */

  function toast(message, kind, ms) {
    const div = document.createElement("div");
    div.className = `toast toast-${kind || "info"}`;
    div.textContent = message;
    $("toast-region").appendChild(div);
    setTimeout(() => div.remove(), ms || (kind === "error" ? 6000 : 3500));
  }

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    (children || []).forEach((c) => n.append(c));
    return n;
  }

  const unitOf = () => (state.doc && Calc.TIME_UNITS[state.doc.timeUnit] ? state.doc.timeUnit : "s");
  const ul = () => Calc.TIME_UNITS[unitOf()].label;
  const ft = (min, d) => (min == null || !Number.isFinite(min) ? "--" : Calc.formatTime(min, unitOf(), d));

  function setStatus(kind, text, tip) {
    const pill = $("sync-status");
    pill.className = `status-pill status-${kind}`;
    pill.querySelector(".status-text").textContent = text;
    pill.title = tip || text;
  }

  /* ==========================================================================
     ALTERAÇÕES E SALVAMENTO (mesmo fluxo do MFV)
     ========================================================================== */

  function markChanged(opts) {
    const o = opts || {};
    state.doc.updatedAt = new Date().toISOString();
    state.dirty = true;
    state.changeSeq += 1;
    if (o.render) renderAll();
    else update();
    clearTimeout(localTimer);
    localTimer = setTimeout(persistLocal, 250);
    scheduleDiskSave(DISK_SAVE_DELAY_MS);
    refreshStatus();
  }

  async function persistLocal() {
    localTimer = null;
    if (!state.doc) return;
    try {
      await Store.putLocal({ id: state.doc.id, study: state.doc, diskRevision: state.diskRevision, dirty: state.dirty }, STORE);
    } catch (err) {
      setStatus("error", "Falha ao salvar no navegador", String(err.message || err));
    }
  }

  function scheduleDiskSave(delay) {
    if (!Store.getDirHandle()) return;
    clearTimeout(diskTimer);
    diskTimer = setTimeout(() => {
      diskTimer = null;
      queueWrite();
    }, delay);
  }

  function queueWrite() {
    if (writing) {
      pendingWrite = true;
      return writing;
    }
    writing = writeToFolder().finally(() => {
      writing = null;
      if (pendingWrite) {
        pendingWrite = false;
        return queueWrite();
      }
    });
    return writing;
  }

  async function writeToFolder() {
    if (!state.doc || !state.dirty || state.conflict) return;
    if (!(await Store.folderReady())) {
      if (Store.getDirHandle()) state.folder = "prompt";
      updateFolderButton();
      refreshStatus();
      return;
    }
    const doc = state.doc;
    const seq = state.changeSeq;
    state.saving = true;
    refreshStatus();
    try {
      const res = await Store.writeStudy(doc, state.diskRevision, IO);
      if (doc !== state.doc) return;
      if (res.status === "ok") {
        state.diskRevision = res.revision;
        doc.revision = res.revision;
        state.dirty = state.changeSeq !== seq;
        state.lastDiskSaveAt = new Date();
        state.lastError = null;
        if (state.dirty) scheduleDiskSave(DISK_SAVE_DELAY_MS);
      } else if (res.status === "conflict") {
        state.conflict = res;
        $("conflict-detail").textContent =
          `O arquivo "${doc.fileName}" foi alterado em outro dispositivo.` +
          (res.conflictFile ? ` Sua versão foi salva como cópia: ${res.conflictFile}.` : "") +
          " Nada será gravado na pasta até você escolher uma versão.";
        $("conflict-banner").hidden = false;
      } else if (res.status === "no-permission") {
        state.folder = "prompt";
        updateFolderButton();
      }
      await persistLocal();
    } catch (err) {
      if (!state.lastError) toast(`Falha ao gravar na pasta (${err.name || "erro"}). Nova tentativa automática.`, "error");
      state.lastError = err;
      scheduleDiskSave(10000);
    } finally {
      state.saving = false;
      refreshStatus();
    }
  }

  async function flushSave() {
    clearTimeout(localTimer);
    clearTimeout(diskTimer);
    diskTimer = null;
    await persistLocal();
    if (state.folder === "granted" && state.dirty) await queueWrite();
    else if (writing) await writing;
  }

  function refreshStatus() {
    if (!state.doc) return setStatus("offline", "Nenhum grupo aberto");
    if (state.conflict) return setStatus("error", "Conflito com a pasta: escolha uma versão");
    if (state.folder === "granted") {
      if (state.lastError) return setStatus("error", "Falha ao gravar na pasta (nova tentativa automática)");
      if (state.saving) return setStatus("saving", "Gravando na pasta...");
      if (state.dirty) return setStatus("saving", "Alterações pendentes (gravação em 3 s)");
      const when = state.lastDiskSaveAt ? ` às ${state.lastDiskSaveAt.toLocaleTimeString("pt-BR")}` : "";
      return setStatus("online", `Salvo na pasta${when}`, `Arquivo: ${state.doc.fileName}`);
    }
    if (state.folder === "prompt") return setStatus("reconnect", "Salvo no navegador: reautorize a pasta");
    if (state.folder === "none") return setStatus("local", "Salvo só no navegador: conecte a pasta");
    return setStatus("local", "Salvo no navegador (exporte o JSON)");
  }

  /* ==========================================================================
     PASTA DO ONEDRIVE
     ========================================================================== */

  function updateFolderButton() {
    const btn = $("btn-connect-folder");
    btn.hidden = state.folder === "unsupported";
    const label = { none: "Conectar pasta (OneDrive)", prompt: "Reautorizar pasta", granted: "Trocar pasta" }[state.folder];
    if (label) btn.querySelector(".btn-label").textContent = label;
  }

  async function connectFolder() {
    try {
      if (Store.getDirHandle() && state.folder === "prompt") {
        if ((await Store.requestPermission()) === "granted") return onFolderReady();
      }
      await Store.pickDirectory();
      await onFolderReady();
    } catch (err) {
      if (err && err.name !== "AbortError") toast(`Não foi possível conectar a pasta: ${err.message || err}`, "error");
    }
  }

  async function onFolderReady() {
    state.folder = "granted";
    state.lastError = null;
    updateFolderButton();
    await loadStudies();
    if (state.doc) await openDoc(state.doc.id, state.doc.fileName);
    else showDocs();
    toast(`Pasta conectada: ${Store.getDirHandle().name}`, "ok");
  }

  async function ensurePermission() {
    if (await Store.folderReady()) return true;
    if (!Store.getDirHandle()) return false;
    if ((await Store.requestPermission()) === "granted") {
      state.folder = "granted";
      updateFolderButton();
      return true;
    }
    return false;
  }

  /* ==========================================================================
     DOCUMENTO ABERTO
     ========================================================================== */

  function setCurrent(record) {
    state.doc = record.study;
    document.body.classList.remove("no-doc");
    state.diskRevision = record.diskRevision == null ? null : record.diskRevision;
    state.dirty = !!record.dirty;
    state.conflict = null;
    state.lastError = null;
    state.changeSeq += 1;
    $("conflict-banner").hidden = true;
    renderAll();
    refreshStatus();
  }

  async function openDoc(id, fileNameHint) {
    const local = await Store.getLocal(id, STORE);
    const fileName = fileNameHint || (local && local.study.fileName);
    let disk = null;
    let diskInvalid = false;
    if (fileName && (await Store.folderReady())) {
      try {
        const d = await Store.readStudyFile(fileName, Y.normalizeGroup);
        if (d && d.invalid) diskInvalid = true;
        else disk = d;
      } catch (err) {
        toast(`Não foi possível ler ${fileName}: ${err.message || err}`, "error");
      }
    }
    if (!local && !disk) {
      toast("Grupo não encontrado.", "error");
      return false;
    }
    const decision = diskInvalid && local ? "conflict" : Calc.reconcile(local, disk);
    if (decision === "use-disk") {
      setCurrent({ study: disk, diskRevision: disk.revision, dirty: false });
      await persistLocal();
    } else {
      setCurrent(local);
      if (state.folder === "granted" && (!disk || local.dirty || decision === "conflict")) {
        state.dirty = true;
        queueWrite();
      }
    }
    await Store.setKV("lastGroupId", id);
    await listGroups(); // comparação T1 × T3 usa os demais grupos
    renderAll();
    return true;
  }

  /* ==========================================================================
     ESTUDOS DE CRONOANÁLISE (SOMENTE LEITURA) E GRUPOS SALVOS
     ========================================================================== */

  async function loadStudies() {
    const map = new Map();
    const add = (study) => {
      const prev = map.get(study.id);
      if (!prev || String(prev.updatedAt) < String(study.updatedAt)) map.set(study.id, study);
    };
    (await Store.listLocal()).forEach((r) => r && r.study && add(r.study));
    if (await Store.folderReady()) {
      try {
        const { studies } = await Store.listFolderStudies();
        studies.forEach(add);
      } catch (err) {
        console.warn("Erro ao ler estudos da pasta:", err);
      }
    }
    state.studyDocs = map;
    // Uma opção por produto (o Yamazumi usa a composição dos elementos: o mix ponderado não entra)
    state.options = [];
    map.forEach((study) => {
      const r = Calc.computeStudy(study);
      const tp = (p) => {
        const m = Y.memberMetrics(study, p.key);
        return m.found && m.tp > 0 ? m.tp : null;
      };
      const base = { id: study.id, processName: study.processName, clientName: study.clientName, fileName: study.fileName };
      if (!r.multiProduct) state.options.push(Object.assign({ key: study.id, product: "", productName: "", tpMin: tp(r.product) }, base));
      else r.products.forEach((p) => state.options.push(Object.assign({ key: `${study.id}::${p.key}`, product: p.key, productName: p.name, tpMin: tp(p) }, base)));
    });
    renderStudyPicker();
  }

  async function listGroups() {
    const items = new Map();
    (await Store.listLocal(STORE)).forEach((r) => r && r.study && items.set(r.id, { doc: r.study, inFolder: false }));
    let source = "Navegador deste dispositivo";
    if (await Store.folderReady()) {
      source = `Pasta: ${Store.getDirHandle().name}`;
      try {
        const { studies } = await Store.listFolderStudies({ pattern: Y.FILE_PATTERN, normalize: Y.normalizeGroup });
        studies.forEach((d) => {
          const it = items.get(d.id);
          if (!it || String(d.updatedAt) > String(it.doc.updatedAt)) items.set(d.id, { doc: d, inFolder: true });
          else it.inFolder = true;
        });
      } catch (err) {
        toast(`Erro ao ler a pasta: ${err.message || err}`, "error");
      }
    }
    // O grupo aberto vale como está na tela
    if (state.doc) items.set(state.doc.id, { doc: state.doc, inFolder: (items.get(state.doc.id) || {}).inFolder || false });
    const list = Array.from(items.values()).sort((a, b) => String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)));
    state.groupsCache = list;
    return { list, source };
  }

  function optionLabel(o) {
    return `${o.processName || "Sem posto"}${o.productName ? ` • ${o.productName}` : ""}`;
  }

  function renderStudyPicker() {
    const sel = $("study-picker");
    const client = state.doc ? Calc.elementKey(state.doc.clientName) : "";
    const list = state.options.slice().sort((a, b) => {
      const ma = Calc.elementKey(a.clientName) === client ? 0 : 1;
      const mb = Calc.elementKey(b.clientName) === client ? 0 : 1;
      return ma - mb || String(a.processName).localeCompare(String(b.processName), "pt-BR");
    });
    sel.replaceChildren(
      el("option", { value: "", textContent: list.length ? "Selecione um estudo..." : "Nenhum estudo encontrado" }),
      ...list.map((o) => el("option", { value: o.key, textContent: `${optionLabel(o)} — ${o.clientName || "Sem cliente"} (${o.tpMin ? `TP ${ft(o.tpMin)} ${ul()}` : "sem tempo"})` }))
    );
  }

  /** Clientes já usados nos estudos e grupos, com a grafia original. */
  function knownClients() {
    const map = new Map();
    const add = (n) => n && !map.has(Calc.elementKey(n)) && map.set(Calc.elementKey(n), n.trim());
    state.options.forEach((o) => add(o.clientName));
    state.groupsCache.forEach(({ doc }) => add(doc.clientName));
    return map;
  }

  /** Takt e tempo líquido do 1º estudo (pré-preenchimento do grupo). */
  function prefillFromFirst(doc) {
    const first = doc.members[0];
    const study = first && state.studyDocs.get(first.studyId);
    if (!study) return;
    const m = Y.memberMetrics(study, first.product || "");
    if (!m.found) return;
    if (!Number.isFinite(doc.taktMin) && m.takt > 0) doc.taktMin = m.takt;
    if (!Number.isFinite(doc.netTimeMin) && m.netTime > 0) doc.netTimeMin = m.netTime;
  }

  /* ==========================================================================
     RENDERIZAÇÃO
     ========================================================================== */

  function renderAll() {
    const d = state.doc;
    if (!d) return;
    document.querySelectorAll("[data-doc]").forEach((input) => {
      input.value = d[input.dataset.doc] == null ? "" : d[input.dataset.doc];
    });
    document.title = `Yamazumi — ${d.name || "Grupo"} | Lean Chrono & MFV`;
    renderCompareOptions();
    $("compare-hint").textContent = "Variação = (T3 − T1) ÷ T1";
    $("members-tbody").replaceChildren(...d.members.map((m, i) => memberRow(m, i)));
    if (!d.members.length) {
      const td = el("td", { className: "cell-text text-muted", textContent: "Inclua os estudos: escolha um estudo de cronoanálise e clique em '+ Estudo'. Cada estudo = 1 operador." });
      td.colSpan = 9;
      $("members-tbody").append(el("tr", {}, [td]));
    }
    renderStudyPicker();
    update();
  }

  function renderCompareOptions() {
    const d = state.doc;
    const key = Calc.elementKey(d.clientName);
    const others = state.groupsCache.filter(({ doc }) => doc.id !== d.id && Calc.elementKey(doc.clientName) === key);
    const sel = $("grp-compare");
    sel.replaceChildren(
      el("option", { value: "", textContent: others.length ? "Sem comparação" : "Nenhum outro grupo" }),
      ...others.map(({ doc }) => el("option", { value: doc.id, textContent: `${doc.name || "Grupo"} (${doc.situation})` }))
    );
    if (d.compareWithId && !others.find(({ doc }) => doc.id === d.compareWithId)) {
      sel.append(el("option", { value: d.compareWithId, textContent: "Grupo não encontrado" }));
    }
    sel.value = d.compareWithId || "";
  }

  function memberRow(m, i) {
    const tr = el("tr");
    tr.dataset.id = m.id;
    const label = el("input", { type: "text", className: "input-cell", value: m.label, placeholder: state.doc.kind === "linha" ? `Etapa ${i + 1}` : `Op. ${i + 1}`, autocomplete: "off" });
    label.dataset.field = "label";
    const o = state.options.find((x) => x.id === m.studyId && x.product === (m.product || "")) || state.options.find((x) => x.id === m.studyId);
    const actions = el("td", { className: "cell-actions step-actions" }, [
      el("button", { type: "button", className: "btn-icon", textContent: "↑", title: "Subir" }),
      el("button", { type: "button", className: "btn-icon", textContent: "↓", title: "Descer" }),
      el("button", { type: "button", className: "btn-icon-del", textContent: "×", title: "Tirar do grupo" }),
    ]);
    ["up", "down", "remove"].forEach((a, j) => (actions.children[j].dataset.action = a));
    tr.append(
      el("td", { className: "cell-num", textContent: String(i + 1).padStart(2, "0") }),
      el("td", {}, [label]),
      el("td", { className: "cell-text", textContent: o ? optionLabel(o) : "estudo não encontrado", title: o ? o.fileName : m.studyId }),
      ...["tn", "tp", "wait", "content", "takt"].map((k) => {
        const td = el("td", { className: "cell-readonly mono" });
        td.dataset.out = k;
        return td;
      }),
      actions
    );
    return tr;
  }

  function update() {
    const d = state.doc;
    const r = Y.computeGroup(d, state.studyDocs);
    state.computed = r;
    const u = ul();
    document.querySelectorAll(".unit-label").forEach((n) => (n.textContent = u));
    const linha = d.kind === "linha";
    $("th-member-label").textContent = linha ? "Etapa" : "Operador";
    $("members-hint").textContent = linha
      ? "Cada estudo = 1 etapa da linha • gargalo = maior TP • no MFV cada estudo vira uma etapa"
      : "Cada estudo = 1 operador • ciclo do posto = maior TP • conteúdo = TP − espera • no MFV vira 1 etapa";

    // Takt e tempo líquido (vazios = os do 1º estudo)
    const taktInput = $("grp-takt");
    if (document.activeElement !== taktInput) taktInput.value = Number.isFinite(d.taktMin) ? ft(d.taktMin) : "";
    taktInput.placeholder = !r.taktTyped && r.takt ? `${ft(r.takt)} (1º estudo)` : "informe";
    const netInput = $("grp-net");
    if (document.activeElement !== netInput) netInput.value = Number.isFinite(d.netTimeMin) ? fmt(d.netTimeMin, 1) : "";
    netInput.placeholder = !r.netTyped && r.netTime ? `${fmt(r.netTime, 1)} (1º estudo)` : "informe";
    $("grp-takt-hint").textContent = "O takt do grupo vale só para o Yamazumi; no MFV vale o takt do MFV. Pré-preenchido com os parâmetros do 1º estudo.";

    // Estudos
    $("members-tbody").querySelectorAll("tr[data-id]").forEach((tr, i) => {
      const m = r.members[i];
      if (!m) return;
      const set = (k, v) => (tr.querySelector(`[data-out="${k}"]`).textContent = v);
      const ok = m.found && m.tp > 0;
      set("tn", ok ? ft(m.tn) : "--");
      set("tp", ok ? ft(m.tp) : "--");
      set("wait", ok ? ft(m.wait) : "--");
      set("content", ok ? ft(m.content) : "--");
      set("takt", ok && r.takt ? `${fmt((m.tp / r.takt) * 100, 1)}%` : "--");
      tr.classList.toggle("row-error", !ok);
      tr.classList.toggle("row-over-takt", !!(ok && r.takt && m.tp > r.takt + 1e-9));
      tr.title = !m.found ? "Estudo não encontrado neste navegador nem na pasta" : !ok ? "Estudo sem tempo padrão" : "";
    });
    $("ft-cycle").textContent = ft(r.cycle);
    $("ft-wait").textContent = r.n ? ft(r.members.filter((m) => m.found && m.tp > 0).reduce((a, m) => a + m.wait, 0)) : "--";
    $("ft-content").textContent = r.n ? ft(r.content) : "--";

    // Indicadores
    $("kpi-cycle-title").textContent = linha ? "Gargalo (maior TP)" : "Ciclo do posto";
    $("kpi-cycle").textContent = ft(r.cycle);
    $("kpi-cycle-unit").textContent = r.cycle != null ? `${u}/pç` : "";
    $("kpi-cycle-cap").textContent = r.cycle == null ? "Inclua estudos com tempo padrão" : `${r.cycleLabel}${r.taktPct != null ? ` • ${fmt(r.taktPct, 1)}% do takt (${ft(r.takt)} ${u})` : " • informe o takt"}`;
    const card = $("kpi-cycle-card");
    card.classList.remove("is-bottleneck", "is-balanced");
    if (r.status === "acima") card.classList.add("is-bottleneck");
    else if (r.status === "atende") card.classList.add("is-balanced");
    $("kpi-content").textContent = r.n ? ft(r.content) : "--";
    $("kpi-content-unit").textContent = r.n ? `${u}/pç` : "";
    $("kpi-balance").textContent = fmt(r.balancePct, 1);
    $("kpi-ops").textContent = r.n ? String(r.n) : "--";
    $("kpi-ops-ideal").textContent = `Ideal (conteúdo ÷ takt): ${fmt(r.opsIdeal, 2)}`;
    $("kpi-cap").textContent = fmt(r.capacityDay, 1);
    $("kpi-hh").textContent = r.hhPerPiece != null ? `${fmt(r.hhPerPiece, 4)} HH/pç • ${fmt(r.pcPerHH, 2)} pç/HH (teórico)` : "--";

    const warn = $("yz-warnings");
    warn.replaceChildren(...r.warnings.map((w) => el("div", { textContent: `⚠ ${w}` })));
    warn.hidden = !r.warnings.length;

    renderChart(r);
    renderCompare(r);
  }

  /** Barras empilhadas por estudo (classe de valor ou elemento) e linha do takt. */
  function renderChart(r) {
    const box = $("yz-chart");
    const mode = state.doc.chartMode === "elemento" ? "elemento" : "classe";
    $("yz-chart-sub").textContent =
      mode === "elemento"
        ? "TP de cada estudo empilhado por elemento (cor = classe de valor) × takt (linha tracejada)."
        : "TP de cada estudo empilhado por classe de valor × takt (linha tracejada).";
    const members = r.members.filter((m) => m.found && m.tp > 0);
    if (!members.length) {
      box.replaceChildren(el("p", { className: "chart-empty", textContent: "As barras aparecem quando o grupo tiver estudos com tempo padrão." }));
      $("yz-legend").replaceChildren();
      return;
    }
    const u = ul();
    const max = Math.max(...members.map((m) => m.tp), r.takt || 0) * 1.12;
    const plot = el("div", { className: "gbo-plot yz-plot" });
    if (r.takt) {
      const line = el("div", { className: "gbo-takt", title: `Takt: ${ft(r.takt)} ${u}` }, [el("span", { textContent: `Takt ${ft(r.takt)} ${u}` })]);
      line.style.bottom = `${(r.takt / max) * 100}%`;
      plot.append(line);
    }
    const used = new Set();
    members.forEach((m) => {
      const col = el("div", { className: "gbo-col", title: `${m.label}: TP ${ft(m.tp)} ${u}` });
      const stack = el("div", { className: "yz-stack" + (r.takt && m.tp > r.takt + 1e-9 ? " is-over" : "") });
      stack.style.height = `${(m.tp / max) * 100}%`;
      Y.segments(m, mode).forEach((s) => {
        used.add(s.cls);
        const seg = el("div", { className: `yz-seg yz-${Y.CLASSES[s.cls].color}`, title: `${s.label} (${Y.CLASSES[s.cls].label}): ${ft(s.value)} ${u}` });
        seg.style.height = `${(s.value / m.tp) * 100}%`;
        stack.append(seg);
      });
      col.append(el("span", { className: "gbo-value", textContent: ft(m.tp) }), stack);
      plot.append(col);
    });
    const labels = el("div", { className: "gbo-labels" }, members.map((m) => el("span", { textContent: m.label, title: `${m.label} — ${m.processName}` })));
    box.replaceChildren(plot, labels);
    $("yz-legend").replaceChildren(
      ...Y.CLASS_ORDER.filter((k) => used.has(k)).map((k) =>
        el("span", { className: "yz-legend-item" }, [el("span", { className: `yz-swatch yz-${Y.CLASSES[k].color}` }), el("span", { textContent: Y.CLASSES[k].label })])
      )
    );
  }

  function compareTarget() {
    const d = state.doc;
    if (!d.compareWithId) return null;
    const it = state.groupsCache.find(({ doc }) => doc.id === d.compareWithId);
    return it ? it.doc : null;
  }

  function compareRows(r) {
    const other = compareTarget();
    if (!other) return null;
    const ro = Y.computeGroup(other, state.studyDocs);
    const currentIsT3 = state.doc.situation === "T3" && other.situation !== "T3";
    const [t1, t3, g1, g3] = currentIsT3 ? [ro, r, other, state.doc] : [r, ro, state.doc, other];
    return { rows: Y.compareGroups(t1, t3), g1, g3 };
  }

  function formatCompare(row, v) {
    if (v == null) return "--";
    if (row.unit === "tempo") return `${ft(v)} ${ul()}`;
    if (row.unit === "pct") return `${fmt(v, 1)}%`;
    if (row.unit === "hh") return fmt(v, 4);
    if (row.unit === "n") return fmt(v, 0);
    return fmt(v, 2);
  }

  function renderCompare(r) {
    const sec = $("compare-section");
    const c = compareRows(r);
    sec.hidden = !c;
    if (!c) return;
    if (c.g1.situation === c.g3.situation) {
      $("compare-hint").textContent = `⚠ Os dois grupos estão marcados como ${c.g1.situation}: a coluna T1 é "${c.g1.name}" e a T3 é "${c.g3.name}". Variação = (T3 − T1) ÷ T1`;
    } else {
      $("compare-hint").textContent = `T1: ${c.g1.name} • T3: ${c.g3.name} • Variação = (T3 − T1) ÷ T1`;
    }
    const verdicts = { melhora: "✔ melhora", piora: "✖ piora", igual: "= igual" };
    $("compare-tbody").replaceChildren(
      ...c.rows.map((row) =>
        el("tr", { className: row.verdict ? `cmp-${row.verdict}` : "" }, [
          el("td", { className: "cell-text", textContent: row.label }),
          el("td", { className: "mono", textContent: formatCompare(row, row.t1) }),
          el("td", { className: "mono", textContent: formatCompare(row, row.t3) }),
          el("td", { className: "mono", textContent: row.deltaPct != null ? `${row.deltaPct > 0 ? "+" : ""}${fmt(row.deltaPct, 1)}%` : "--" }),
          el("td", { className: "cell-text", textContent: row.verdict ? verdicts[row.verdict] : "--" }),
        ])
      )
    );
  }

  /* ==========================================================================
     EXPORTAÇÃO
     ========================================================================== */

  function exportXlsx() {
    const d = state.doc;
    const r = state.computed;
    const c = compareRows(r);
    const sheets = Y.buildGroupSheets(d, r, c ? c.rows : null);
    const name = d.fileName.replace(/\.json$/i, ".xlsx");
    Store.downloadText(name, root.LeanXlsx.buildWorkbook(sheets), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    toast(`Excel exportado: ${name}`, "ok");
  }

  /* ==========================================================================
     EVENTOS
     ========================================================================== */

  function bindEvents() {
    document.querySelectorAll("[data-doc]").forEach((input) => {
      const evt = input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(evt, () => {
        if (!state.doc) return;
        state.doc[input.dataset.doc] = input.value;
        const structural = ["timeUnit", "kind", "clientName"].includes(input.dataset.doc);
        markChanged({ render: structural });
      });
    });
    $("grp-takt").addEventListener("input", (e) => {
      const v = Calc.parseNumber(e.target.value);
      state.doc.taktMin = v != null && v > 0 ? v / Calc.TIME_UNITS[unitOf()].factor : null;
      markChanged();
    });
    $("grp-net").addEventListener("input", (e) => {
      const v = Calc.parseNumber(e.target.value);
      state.doc.netTimeMin = v != null && v > 0 ? v : null;
      markChanged();
    });

    const tbody = $("members-tbody");
    tbody.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || e.target.dataset.field !== "label") return;
      state.doc.members.find((x) => x.id === tr.dataset.id).label = e.target.value;
      markChanged();
    });
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const list = state.doc.members;
      const i = list.findIndex((m) => m.id === btn.closest("tr").dataset.id);
      const a = btn.dataset.action;
      if (a === "up" && i > 0) list.splice(i - 1, 0, list.splice(i, 1)[0]);
      else if (a === "down" && i < list.length - 1) list.splice(i + 1, 0, list.splice(i, 1)[0]);
      else if (a === "remove") list.splice(i, 1);
      else return;
      markChanged({ render: true });
    });
    $("btn-add-member").addEventListener("click", () => {
      const o = state.options.find((x) => x.key === $("study-picker").value);
      if (!o) return toast("Escolha um estudo na lista.", "warn");
      if (state.doc.members.some((m) => m.studyId === o.id && (m.product || "") === o.product)) return toast("Este estudo já está no grupo.", "warn");
      state.doc.members.push(Y.createMember({ studyId: o.id, product: o.product }));
      if (!state.doc.clientName && o.clientName) state.doc.clientName = o.clientName;
      prefillFromFirst(state.doc);
      markChanged({ render: true });
    });
    $("btn-refresh-studies").addEventListener("click", async () => {
      await loadStudies();
      renderAll();
      toast("Estudos atualizados.", "ok");
    });

    $("btn-connect-folder").addEventListener("click", connectFolder);
    $("btn-docs").addEventListener("click", () => showDocs());
    $("new-client").addEventListener("input", renderNewDocStudies);
    $("btn-export-xlsx").addEventListener("click", exportXlsx);
    $("btn-print").addEventListener("click", () => root.print());
    $("btn-export-json").addEventListener("click", () => {
      Store.downloadText(state.doc.fileName, IO.serialize(state.doc), "application/json");
      toast(`Arquivo exportado: ${state.doc.fileName}`, "ok");
    });
    $("btn-to-mfv").addEventListener("click", async () => {
      if (!state.computed || !state.computed.n) return toast("Inclua estudos com tempo padrão antes de enviar ao MFV.", "warn");
      await flushSave();
      root.location.href = `mfv.html?grupo=${encodeURIComponent(state.doc.id)}`;
    });
    $("btn-delete-group").addEventListener("click", async () => {
      if (!root.confirm(`Excluir o grupo "${state.doc.name || state.doc.fileName}" deste navegador? O arquivo da pasta, se houver, é mantido.`)) return;
      await Store.deleteLocal(state.doc.id, STORE);
      state.doc = null;
      document.body.classList.add("no-doc");
      await Store.setKV("lastGroupId", null);
      refreshStatus();
      showDocs();
    });
    $("btn-conflict-disk").addEventListener("click", async () => {
      if (!(await ensurePermission())) return;
      const disk = await Store.readStudyFile(state.doc.fileName, Y.normalizeGroup);
      if (!disk || disk.invalid) return toast("Não foi possível ler a versão da pasta.", "error");
      setCurrent({ study: disk, diskRevision: disk.revision, dirty: false });
      await persistLocal();
      toast("Versão da pasta carregada.", "ok");
    });
    $("btn-conflict-local").addEventListener("click", async () => {
      if (!root.confirm("Sobrescrever o arquivo da pasta com a versão desta tela?") || !(await ensurePermission())) return;
      const res = await Store.writeStudy(state.doc, null, Object.assign({ force: true }, IO));
      if (res.status === "ok") {
        state.conflict = null;
        state.diskRevision = res.revision;
        state.doc.revision = res.revision;
        state.dirty = false;
        $("conflict-banner").hidden = true;
        await persistLocal();
        refreshStatus();
        toast("Arquivo da pasta sobrescrito com a sua versão.", "ok");
      }
    });

    // Diálogo
    const dlg = $("doc-dialog");
    $("btn-close-dialog").addEventListener("click", () => dlg.close());
    // Sem grupo aberto a janela também fecha: fica a tela vazia, com o menu dos módulos
    $("btn-empty-open").addEventListener("click", () => showDocs());
    $("new-doc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const typed = $("new-client").value.trim();
      const name = $("new-name").value.trim();
      if (!typed || !name) return toast("Informe a empresa e o nome do grupo.", "warn");
      const client = knownClients().get(Calc.elementKey(typed)) || typed;
      const chosen = Array.from($("new-doc-study-list").querySelectorAll("input:checked"))
        .map((i) => state.options.find((x) => x.key === i.value))
        .filter(Boolean);
      await flushSave();
      const doc = Y.createGroup({
        clientName: client,
        name,
        kind: $("new-kind").value,
        situation: $("new-situation").value,
        members: chosen.map((o) => ({ studyId: o.id, product: o.product })),
      });
      // Unidade de tempo do 1º estudo (a planilha REV2 usa segundos)
      const firstStudy = chosen[0] && state.studyDocs.get(chosen[0].id);
      if (firstStudy) doc.timeUnit = Calc.timeUnit(firstStudy);
      prefillFromFirst(doc);
      setCurrent({ study: doc, diskRevision: null, dirty: true });
      await persistLocal();
      await Store.setKV("lastGroupId", doc.id);
      await listGroups();
      renderAll();
      // Próximo "Novo grupo" começa sem as marcações deste
      $("new-doc-form").reset();
      $("new-doc-study-list").replaceChildren();
      dlg.close();
      if (state.folder === "granted") queueWrite();
      toast(`Grupo criado: ${doc.fileName}${chosen.length ? ` com ${chosen.length} estudo(s).` : ""}`, "ok", 6000);
    });
    $("doc-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const li = btn.closest("li");
      if (btn.dataset.action === "open") {
        await flushSave();
        if (await openDoc(li.dataset.id, li.dataset.fileName)) dlg.close();
      }
    });
    $("input-import").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const res = await Store.readImportFile(file, Y.normalizeGroup);
      if (!res.ok) return toast(`Importação recusada: ${res.error}`, "error");
      await flushSave();
      await Store.putLocal({ id: res.doc.id, study: res.doc, diskRevision: res.doc.revision, dirty: true }, STORE);
      if (await openDoc(res.doc.id, res.doc.fileName)) {
        dlg.close();
        toast(`Grupo importado: ${res.doc.name}`, "ok");
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        flushSave().then(() => toast("Grupo salvo.", "ok"));
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushSave();
    });
    root.addEventListener("pagehide", () => flushSave());
  }

  /** Estudos da empresa digitada no "Novo grupo". */
  function renderNewDocStudies() {
    const key = Calc.elementKey($("new-client").value);
    const list = key
      ? state.options.filter((o) => Calc.elementKey(o.clientName) === key).sort((a, b) => String(a.processName).localeCompare(String(b.processName), "pt-BR"))
      : [];
    const box = $("new-doc-study-list");
    const prev = new Set(Array.from(box.querySelectorAll("input:checked")).map((i) => i.value));
    box.replaceChildren(
      ...list.map((o) =>
        el("li", {}, [
          el("label", {}, [
            el("input", { type: "checkbox", value: o.key, checked: prev.has(o.key) }),
            el("span", { textContent: optionLabel(o) }),
            el("span", { className: "study-check-tc", textContent: o.tpMin ? `TP ${Calc.formatTime(o.tpMin, "s", 1)} s` : "sem tempo padrão" }),
          ]),
        ])
      )
    );
    $("new-doc-studies").hidden = !list.length;
    $("new-doc-hint").textContent = !key
      ? "Escolha a empresa: os estudos de cronoanálise dela aparecem aqui."
      : list.length
        ? `${list.length} estudo(s) desta empresa. No posto, use estudos do mesmo produto (cada estudo = 1 operador).`
        : "Nenhum estudo de cronoanálise com esta empresa. Os estudos podem ser incluídos depois.";
  }

  async function showDocs() {
    const { list, source } = await listGroups();
    $("doc-source").textContent = source;
    $("client-list").replaceChildren(...Array.from(knownClients().values()).map((n) => el("option", { value: n })));
    if (!$("new-client").value && state.doc) $("new-client").value = state.doc.clientName;
    renderNewDocStudies();
    $("doc-list").replaceChildren(
      ...(list.length
        ? list.map(({ doc, inFolder }) => {
            const li = el("li", { className: "study-row" + (state.doc && state.doc.id === doc.id ? " is-current" : "") });
            li.dataset.id = doc.id;
            li.dataset.fileName = doc.fileName;
            const btn = el("button", { type: "button", className: "study-item" }, [
              el("span", { className: "study-title", textContent: `${doc.clientName || "Sem cliente"} — ${doc.name || "Sem nome"} (${doc.situation})` }),
              el("span", { className: "study-meta", textContent: `${doc.kind === "linha" ? "Linha" : "Posto"} • ${doc.members.length} estudo(s) • ${doc.fileName}` }),
              el("span", { className: "study-badges" }, [el("span", { className: `badge ${inFolder ? "badge-folder" : "badge-local"}`, textContent: inFolder ? "Na pasta" : "Só no navegador" })]),
            ]);
            btn.dataset.action = "open";
            li.append(btn);
            return li;
          })
        : [el("li", { className: "empty", textContent: "Nenhum grupo salvo ainda. Crie o primeiro acima." })])
    );
    const dlg = $("doc-dialog");
    if (!dlg.open) dlg.showModal();
    (list.length ? $("doc-list").querySelector(".study-item") : $("new-client")).focus();
  }

  async function start() {
    bindEvents();
    setStatus("offline", "Iniciando...");
    await Store.init();
    if (Store.fsSupported) {
      const r = await Store.restoreDirHandle();
      state.folder = r.handle ? (r.permission === "granted" ? "granted" : "prompt") : "none";
    }
    updateFolderButton();
    await loadStudies();
    let opened = false;
    const lastId = await Store.getKV("lastGroupId");
    if (lastId) opened = await openDoc(lastId);
    if (!opened) await showDocs();
    refreshStatus();
  }

  root.LeanYamazumiApp = { state, flushSave, openDoc, loadStudies };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof self !== "undefined" ? self : this);
