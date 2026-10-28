/**
 * ============================================================================
 * LEAN CHRONO & MFV — PÁGINA DO PLANO DE AÇÃO (5W2H) — REV 1.19
 * ----------------------------------------------------------------------------
 * Tela + orquestração do plano (um por cliente). Mesmo armazenamento dos outros
 * módulos (navegador + pasta do OneDrive, com controle de revisão contra conflito).
 * Lê os estudos de cronoanálise (somente leitura) para trazer as ações Kaizen.
 * Depende de: LeanCalc, LeanPlano, LeanStorage, LeanXlsx, LeanXlsxTemplate.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const P = root.LeanPlano;
  const Store = root.LeanStorage;
  const Tpl = root.LeanXlsxTemplate;
  const STORE = Store.STORE_PLANS;
  const DISK_SAVE_DELAY_MS = 3000;
  const TEMPLATE_KEY = "template:plano";
  const TEMPLATE_DIR = "_Modelos";
  const $ = (id) => document.getElementById(id);
  const fmt = Calc.formatNumber;
  const IO = { normalize: P.normalizePlan, serialize: (d) => P.serializePlan(d) };

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
    studies: new Map(), // id → estudo (o mais recente entre navegador e pasta)
    candidatesByStudy: new Map(), // id do estudo → ações Kaizen do estudo
    plansCache: [],
    template: null,
    filter: "",
  };
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

  const money = (v) => (v == null || !Number.isFinite(v) ? "--" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }));

  function setStatus(kind, text, tip) {
    const pill = $("sync-status");
    pill.className = `status-pill status-${kind}`;
    pill.querySelector(".status-text").textContent = text;
    pill.title = tip || text;
  }

  /* ==========================================================================
     ALTERAÇÕES E SALVAMENTO (mesmo fluxo do MFV e do Yamazumi)
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
    if (!state.doc) return setStatus("offline", "Nenhum plano aberto");
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
    await syncTemplate();
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
        const d = await Store.readStudyFile(fileName, P.normalizePlan);
        if (d && d.invalid) diskInvalid = true;
        else disk = d;
      } catch (err) {
        toast(`Não foi possível ler ${fileName}: ${err.message || err}`, "error");
      }
    }
    if (!local && !disk) {
      toast("Plano não encontrado.", "error");
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
    await Store.setKV("lastPlanId", id);
    return true;
  }

  /* ==========================================================================
     ESTUDOS (SOMENTE LEITURA) E PLANOS SALVOS
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
    state.studies = map;
    state.candidatesByStudy = new Map();
    map.forEach((study) => {
      try {
        state.candidatesByStudy.set(study.id, P.studyCandidates(study));
      } catch (err) {
        console.warn("Estudo ignorado:", study.fileName, err);
      }
    });
  }

  /** Ações Kaizen dos estudos do cliente do plano, da maior para a menor parcela do ciclo. */
  function clientCandidates() {
    const key = state.doc ? Calc.elementKey(state.doc.clientName) : "";
    const out = [];
    state.studies.forEach((study) => {
      if (Calc.elementKey(study.clientName) !== key) return;
      (state.candidatesByStudy.get(study.id) || []).forEach((c) => out.push(c));
    });
    return out.sort((a, b) => (b.sharePct || 0) - (a.sharePct || 0));
  }

  async function listPlans() {
    const items = new Map();
    (await Store.listLocal(STORE)).forEach((r) => r && r.study && items.set(r.id, { doc: r.study, inFolder: false }));
    let source = "Navegador deste dispositivo";
    if (await Store.folderReady()) {
      source = `Pasta: ${Store.getDirHandle().name}`;
      try {
        const { studies } = await Store.listFolderStudies({ pattern: P.FILE_PATTERN, normalize: P.normalizePlan });
        studies.forEach((d) => {
          const it = items.get(d.id);
          if (!it || String(d.updatedAt) > String(it.doc.updatedAt)) items.set(d.id, { doc: d, inFolder: true });
          else it.inFolder = true;
        });
      } catch (err) {
        toast(`Erro ao ler a pasta: ${err.message || err}`, "error");
      }
    }
    if (state.doc) items.set(state.doc.id, { doc: state.doc, inFolder: (items.get(state.doc.id) || {}).inFolder || false });
    const list = Array.from(items.values()).sort((a, b) => String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)));
    state.plansCache = list;
    return { list, source };
  }

  /** Empresas já usadas nos estudos e planos (mesma grafia). */
  function knownClients() {
    const map = new Map();
    state.studies.forEach((s) => s.clientName && !map.has(Calc.elementKey(s.clientName)) && map.set(Calc.elementKey(s.clientName), s.clientName.trim()));
    state.plansCache.forEach(({ doc }) => doc.clientName && !map.has(Calc.elementKey(doc.clientName)) && map.set(Calc.elementKey(doc.clientName), doc.clientName.trim()));
    return map;
  }

  /* ==========================================================================
     RENDERIZAÇÃO
     ========================================================================== */

  function renderAll() {
    const d = state.doc;
    if (!d) return;
    document.querySelectorAll("[data-doc]").forEach((input) => {
      if (document.activeElement !== input) input.value = d[input.dataset.doc] == null ? "" : d[input.dataset.doc];
    });
    $("actions-tbody").replaceChildren(...d.actions.map((a, i) => actionRow(a, i)));
    if (!d.actions.length) {
      const td = el("td", { className: "cell-text text-muted", textContent: 'Nenhuma ação ainda. Use "+ Ações da cronoanálise" (ações Kaizen ECRS dos estudos deste cliente) ou "+ Ação manual".' });
      td.colSpan = 17;
      $("actions-tbody").append(el("tr", {}, [td]));
    }
    const who = Array.from(new Set(d.actions.map((a) => String(a.who || "").trim()).filter(Boolean)));
    $("who-list").replaceChildren(...who.map((v) => el("option", { value: v })));
    update();
  }

  function select(field, value, options, title) {
    const s = el("select", { className: "input-cell", title: title || "" });
    s.dataset.field = field;
    s.append(el("option", { value: "", textContent: "—" }));
    Object.entries(options).forEach(([k, label]) => s.append(el("option", { value: k, textContent: label, selected: k === value })));
    return s;
  }

  function actionRow(a, i) {
    const tr = el("tr");
    tr.dataset.id = a.id;
    const input = (field, value, cls, type) => {
      const inp = el("input", { type: type || "text", className: `input-cell ${cls || ""}`, value: value == null ? "" : value, autocomplete: "off" });
      inp.dataset.field = field;
      return inp;
    };
    const area = (field, value) => {
      const t = el("textarea", { className: "input-cell pl-text", value: value || "", rows: 2 });
      t.dataset.field = field;
      return t;
    };
    const who = input("who", a.who);
    who.setAttribute("list", "who-list");
    const origin = el("td", { className: "cell-text pl-origin" });
    if (a.origin) {
      origin.append(el("span", { textContent: [a.origin.processName, a.origin.product, a.origin.etapa].filter(Boolean).join(" • ") }), el("small", { textContent: a.origin.element }));
    } else origin.append(el("span", { className: "text-muted", textContent: "Manual" }));
    const actions = el("td", { className: "cell-actions step-actions" }, [
      el("button", { type: "button", className: "btn-icon", textContent: "↑", title: "Subir ação" }),
      el("button", { type: "button", className: "btn-icon", textContent: "↓", title: "Descer ação" }),
      el("button", { type: "button", className: "btn-icon-del", textContent: "×", title: "Remover ação" }),
    ]);
    ["up", "down", "remove"].forEach((k, j) => (actions.children[j].dataset.action = k));
    tr.append(
      el("td", { className: "cell-num", textContent: String(i + 1).padStart(2, "0") }),
      el("td", {}, [input("priority", a.priority == null ? "" : a.priority, "mono", "text")]),
      el("td", {}, [area("what", a.what)]),
      el("td", {}, [area("how", a.how)]),
      el("td", {}, [who]),
      el("td", {}, [input("start", a.start, "", "date")]),
      el("td", {}, [input("end", a.end, "", "date")]),
      el("td", {}, [area("where", a.where)]),
      el("td", {}, [area("why", a.why)]),
      el("td", {}, [input("cost", a.cost, "mono")]),
      el("td", {}, [input("pct", a.pct, "mono")]),
      el("td", { className: "cell-readonly pl-status" }),
      el("td", {}, [select("ecrs", a.ecrs, P.ECRS)]),
      el("td", {}, [select("waste", a.waste, Calc.WASTES)]),
      el("td", {}, [select("tool", a.tool, P.TOOLS)]),
      origin,
      actions
    );
    tr.querySelector('[data-field="cost"]').inputMode = "decimal";
    tr.querySelector('[data-field="cost"]').placeholder = "0,00";
    tr.querySelector('[data-field="pct"]').inputMode = "decimal";
    tr.querySelector('[data-field="priority"]').inputMode = "numeric";
    return tr;
  }

  /** Atualiza só os valores calculados (mantém o foco do teclado). */
  function update() {
    const d = state.doc;
    if (!d) return;
    const r = P.computePlan(d);
    state.computed = r;
    const rows = $("actions-tbody").querySelectorAll("tr[data-id]");
    const warnings = [];
    r.actions.forEach((x, i) => {
      const tr = rows[i];
      if (!tr) return;
      const a = d.actions[i];
      const cell = tr.querySelector(".pl-status");
      cell.textContent = P.STATUS[x.status];
      cell.className = `cell-readonly pl-status pl-${x.status}`;
      tr.classList.toggle("row-error", x.issues.length > 0);
      const os = P.originStatus(a, state.candidatesByStudy);
      const o = tr.querySelector(".pl-origin");
      o.classList.toggle("is-changed", os === "alterada" || os === "sem-estudo");
      o.title = os === "alterada" ? "A ação ou o elemento mudou (ou saiu) na cronoanálise: confira" : os === "sem-estudo" ? "Estudo não encontrado (arquivado ou em outro aparelho)" : "";
      tr.title = x.issues.join(" • ");
      tr.hidden = !!state.filter && x.status !== state.filter;
      if (os === "alterada") warnings.push(`${i + 1}. ${a.what || "(sem O que)"}: a ação ou o elemento mudou na cronoanálise ("${a.origin.element}" — "${a.origin.kaizen}"). Confira o texto do plano.`);
      if (os === "sem-estudo") warnings.push(`${i + 1}. ${a.what || "(sem O que)"}: estudo de origem não encontrado (${a.origin.studyFileName || a.origin.processName}).`);
      x.issues.forEach((t) => warnings.push(`${i + 1}. ${a.what || "(sem O que)"}: ${t}`));
    });
    const box = $("pl-warnings");
    box.replaceChildren(...warnings.map((t) => el("div", { className: "link-check link-estudo", textContent: `⚠ ${t}` })));
    box.hidden = !warnings.length;
    $("kpi-total").textContent = String(r.total);
    $("kpi-total-cap").textContent = `Não iniciadas ${r.count["nao-iniciada"]} • em andamento ${r.count.andamento}`;
    $("kpi-late").textContent = String(r.count.atrasada);
    $("kpi-late-card").classList.toggle("is-bottleneck", r.count.atrasada > 0);
    $("kpi-late-card").classList.toggle("is-balanced", r.total > 0 && r.count.atrasada === 0);
    $("kpi-done").textContent = String(r.count.concluida);
    $("kpi-pct").textContent = r.pctMean == null ? "--" : fmt(r.pctMean, 1);
    $("kpi-next").textContent = r.next ? `Próximo prazo: ${r.next.seq}. ${r.next.what || "ação"} (${P.formatDate(r.next.end)})` : "Sem prazos em aberto";
    $("kpi-cost").textContent = r.costInformed ? money(r.costTotal) : "--";
  }

  /* ==========================================================================
     AÇÕES DA CRONOANÁLISE
     ========================================================================== */

  function showCronoDialog() {
    const list = clientCandidates();
    const inPlan = new Set(state.doc.actions.filter((a) => a.origin).map((a) => P.originKey(a.origin)));
    const ul = $("crono-list");
    ul.replaceChildren(
      ...(list.length
        ? list.map((c) => {
            const already = inPlan.has(c.key);
            const p = P.parseEcrs(c.origin.kaizen);
            const u = Calc.TIME_UNITS[c.unit] ? c.unit : "s";
            const cb = el("input", { type: "checkbox", value: c.key, disabled: already });
            const info = [
              c.cycleTime != null ? `${Calc.formatTime(c.cycleTime, u)} ${Calc.TIME_UNITS[u].label}/pç` : "",
              c.sharePct != null ? `${fmt(c.sharePct, 1)}% do ciclo` : "",
              Calc.VALUES[c.value] ? Calc.VALUES[c.value].label : "",
              Calc.WASTES[c.waste] || "",
            ].filter(Boolean).join(" • ");
            return el("li", {}, [
              el("label", { className: already ? "is-disabled" : "" }, [
                cb,
                el("span", { className: "pl-cand-main" }, [
                  el("strong", { textContent: `${p.ecrs ? P.ECRS[p.ecrs] + " — " : ""}${c.origin.element}` }),
                  el("span", { textContent: p.text }),
                  el("small", { textContent: `${[c.origin.processName, c.origin.product, c.origin.etapa].filter(Boolean).join(" • ")}${info ? " • " + info : ""}${already ? " • já no plano" : ""}` }),
                ]),
              ]),
            ]);
          })
        : [el("li", { className: "empty", textContent: 'Nenhuma ação Kaizen nos estudos deste cliente. Digite as ações na coluna "Ação sugerida / Kaizen (ECRS)" da cronoanálise (ou use "Sugerir ações Kaizen (ECRS)" da IA) e volte aqui.' })])
    );
    $("btn-crono-add").disabled = !list.some((c) => !inPlan.has(c.key));
    $("crono-dialog").showModal();
  }

  function addFromCrono() {
    const keys = new Set(Array.from($("crono-list").querySelectorAll("input:checked")).map((i) => i.value));
    const chosen = clientCandidates().filter((c) => keys.has(c.key));
    if (!chosen.length) return toast("Marque ao menos uma ação.", "warn");
    let prio = state.doc.actions.reduce((m, a) => Math.max(m, a.priority || 0), 0);
    chosen.forEach((c) => state.doc.actions.push(P.actionFromCandidate(c, ++prio)));
    $("crono-dialog").close();
    markChanged({ render: true });
    toast(`${chosen.length} ação(ões) incluída(s). Preencha Quem, Quando, Quanto e % completo.`, "ok", 6000);
  }

  /* ==========================================================================
     MODELO EXCEL (navegador + pasta _Modelos)
     ========================================================================== */

  async function getTemplate() {
    try {
      const rec = await Store.getKV(TEMPLATE_KEY);
      return rec && rec.bytes ? rec : null;
    } catch (err) {
      return null;
    }
  }

  function setTemplateInfo(rec) {
    $("template-info-plano").textContent = rec
      ? `✅ ${rec.name} (${Math.round(rec.size / 1024)} KB) — carregado em ${new Date(rec.savedAt).toLocaleString("pt-BR")}. "Exportar Excel" preenche a aba 5W2H (17 ações por arquivo) e acrescenta a aba "Plano (app)".`
      : 'Nenhum modelo carregado. Sem modelo, "Exportar Excel" gera um Excel simples com todas as colunas.';
    $("btn-remove-template-plano").hidden = !rec;
  }

  async function saveTemplate(name, bytes) {
    const rec = { name, size: bytes.length, savedAt: new Date().toISOString(), bytes };
    if (Store.canStoreBinary()) await Store.setKV(TEMPLATE_KEY, rec);
    state.template = rec;
    setTemplateInfo(rec);
    return rec;
  }

  async function loadTemplateFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await Tpl.loadTemplate(bytes, { expect: "plano" });
    } catch (err) {
      return toast(`Modelo recusado: ${err.message || err}`, "error", 9000);
    }
    await saveTemplate(file.name, bytes);
    if (state.folder === "granted") {
      try {
        await Store.writeBinaryFile(TEMPLATE_DIR, file.name, bytes);
      } catch (err) {
        toast(`Modelo guardado no navegador, mas não na pasta ${TEMPLATE_DIR}.`, "warn");
      }
    }
    toast(`Modelo 5W2H reconhecido ✅ ${file.name}`, "ok");
  }

  async function syncTemplate() {
    if (!(await Store.folderReady())) return null;
    try {
      const local = (await getTemplate()) || state.template;
      const files = await Store.readBinaryFiles(TEMPLATE_DIR, /\.xls[xm]$/i);
      if (local) {
        if (!files.some((f) => f.name === local.name)) await Store.writeBinaryFile(TEMPLATE_DIR, local.name, local.bytes);
        return local;
      }
      for (const f of files) {
        try {
          await Tpl.loadTemplate(f.bytes, { expect: "plano" });
          toast(`Modelo 5W2H encontrado na pasta ${TEMPLATE_DIR}: ${f.name}`, "ok");
          return saveTemplate(f.name, f.bytes);
        } catch (err) {
          /* não é o modelo do plano */
        }
      }
    } catch (err) {
      console.warn("Não foi possível sincronizar o modelo do plano:", err);
    }
    return null;
  }

  async function exportXlsx() {
    if (!state.doc) return;
    await flushSave();
    const rec = (await getTemplate()) || state.template || (await syncTemplate());
    const xlsxType = (name) => (/\.xlsm$/i.test(name) ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (!rec) {
      const name = state.doc.fileName.replace(/\.json$/i, ".xlsx");
      Store.downloadText(name, root.LeanXlsx.buildWorkbook(P.buildPlanSheets(state.doc)), xlsxType(name));
      return toast(`Excel simples exportado: ${name}. Para o padrão B+P, carregue o modelo 5W2H em Planos → Modelo Excel.`, "ok", 8000);
    }
    try {
      const first = await Tpl.fillFromBytes(rec.bytes, state.doc, { expect: "plano", part: 0 });
      const outs = [first];
      for (let part = 1; part < first.parts; part++) outs.push(await Tpl.fillFromBytes(rec.bytes, state.doc, { expect: "plano", part }));
      outs.forEach((o, part) => {
        const name = Tpl.exportPlanoFileName(state.doc, rec.name, part, first.parts);
        Store.downloadText(name, o.bytes, xlsxType(name));
      });
      toast(`Excel (modelo 5W2H) exportado: ${first.parts} arquivo(s), ${state.doc.actions.length} ação(ões).`, "ok", 6000);
      outs.forEach((o) => o.warnings.forEach((w) => toast(w, "warn", 9000)));
    } catch (err) {
      console.error("Falha ao preencher o modelo 5W2H:", err);
      toast(`Não foi possível exportar: ${err.message || err}`, "error", 9000);
    }
  }

  /* ==========================================================================
     EVENTOS
     ========================================================================== */

  function bindEvents() {
    document.querySelectorAll("[data-doc]").forEach((input) => {
      input.addEventListener(input.tagName === "SELECT" || input.type === "date" ? "change" : "input", () => {
        if (!state.doc) return;
        state.doc[input.dataset.doc] = input.value;
        markChanged();
      });
    });

    const tbody = $("actions-tbody");
    const onEdit = (e) => {
      const tr = e.target.closest("tr[data-id]");
      const f = e.target.dataset.field;
      if (!tr || !f) return;
      const a = state.doc.actions.find((x) => x.id === tr.dataset.id);
      if (!a) return;
      if (f === "priority") {
        const n = Number(String(e.target.value).trim());
        a.priority = Number.isInteger(n) && n > 0 ? n : null;
      } else a[f] = e.target.value;
      markChanged();
    };
    tbody.addEventListener("input", (e) => {
      if (e.target.tagName === "SELECT" || e.target.type === "date") return;
      onEdit(e);
    });
    tbody.addEventListener("change", (e) => {
      if (e.target.tagName === "SELECT" || e.target.type === "date") onEdit(e);
    });
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const list = state.doc.actions;
      const i = list.findIndex((x) => x.id === btn.closest("tr").dataset.id);
      const a = btn.dataset.action;
      if (a === "up" && i > 0) list.splice(i - 1, 0, list.splice(i, 1)[0]);
      else if (a === "down" && i < list.length - 1) list.splice(i + 1, 0, list.splice(i, 1)[0]);
      else if (a === "remove") {
        if (!root.confirm(`Remover a ação "${list[i].what || i + 1}"?`)) return;
        list.splice(i, 1);
      } else return;
      markChanged({ render: true });
    });
    $("btn-add-action").addEventListener("click", () => {
      state.doc.actions.push(P.createAction());
      markChanged({ render: true });
      const fields = $("actions-tbody").querySelectorAll('[data-field="what"]');
      if (fields.length) fields[fields.length - 1].focus();
    });
    $("btn-from-crono").addEventListener("click", async () => {
      await loadStudies();
      showCronoDialog();
    });
    $("btn-crono-all").addEventListener("click", () => $("crono-list").querySelectorAll("input:not(:disabled)").forEach((c) => (c.checked = true)));
    $("btn-crono-add").addEventListener("click", addFromCrono);
    $("btn-close-crono").addEventListener("click", () => $("crono-dialog").close());
    $("flt-status").addEventListener("change", (e) => {
      state.filter = e.target.value;
      update();
    });

    $("btn-connect-folder").addEventListener("click", connectFolder);
    $("btn-docs").addEventListener("click", () => showDocs());
    $("btn-export-xlsx").addEventListener("click", exportXlsx);
    $("btn-print").addEventListener("click", () => root.print());
    $("btn-export-json").addEventListener("click", () => {
      Store.downloadText(state.doc.fileName, IO.serialize(state.doc), "application/json");
      toast(`Arquivo exportado: ${state.doc.fileName}`, "ok");
    });
    $("input-template-plano").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) loadTemplateFile(file);
    });
    $("btn-remove-template-plano").addEventListener("click", async () => {
      if (!root.confirm("Remover o modelo 5W2H deste navegador? (a cópia na pasta _Modelos é mantida)")) return;
      await Store.setKV(TEMPLATE_KEY, null);
      state.template = null;
      setTemplateInfo(null);
    });
    $("btn-conflict-disk").addEventListener("click", async () => {
      if (!(await ensurePermission())) return;
      const disk = await Store.readStudyFile(state.doc.fileName, P.normalizePlan);
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

    // Diálogo dos planos
    const dlg = $("doc-dialog");
    $("btn-close-dialog").addEventListener("click", () => dlg.close());
    $("btn-empty-open").addEventListener("click", () => showDocs());
    $("new-doc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const typed = $("new-client").value.trim();
      if (!typed) return toast("Informe a empresa.", "warn");
      const client = knownClients().get(Calc.elementKey(typed)) || typed;
      const existing = state.plansCache.find(({ doc }) => Calc.elementKey(doc.clientName) === Calc.elementKey(client));
      if (existing && !root.confirm(`Já existe um plano de ação para "${client}". Criar outro mesmo assim?\n\nCancelar = abrir o existente.`)) {
        await flushSave();
        if (await openDoc(existing.doc.id, existing.doc.fileName)) dlg.close();
        return;
      }
      await flushSave();
      const doc = P.createPlan({ clientName: client });
      setCurrent({ study: doc, diskRevision: null, dirty: true });
      await persistLocal();
      await Store.setKV("lastPlanId", doc.id);
      $("new-doc-form").reset();
      dlg.close();
      if (state.folder === "granted") queueWrite();
      toast(`Plano criado: ${doc.fileName}. Use "+ Ações da cronoanálise" para trazer as ações Kaizen.`, "ok", 7000);
    });
    $("doc-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const li = btn.closest("li");
      if (btn.dataset.action === "open") {
        await flushSave();
        if (await openDoc(li.dataset.id, li.dataset.fileName)) dlg.close();
      }
      if (btn.dataset.action === "archive") await archiveDoc(li.dataset.id);
    });
    $("input-import").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const res = await Store.readImportFile(file, P.normalizePlan);
      if (!res.ok) return toast(`Importação recusada: ${res.error}`, "error");
      await flushSave();
      await Store.putLocal({ id: res.doc.id, study: res.doc, diskRevision: res.doc.revision, dirty: true }, STORE);
      if (await openDoc(res.doc.id, res.doc.fileName)) {
        dlg.close();
        toast(`Plano importado: ${res.doc.clientName}`, "ok");
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        flushSave().then(() => toast("Plano salvo.", "ok"));
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushSave();
    });
    root.addEventListener("pagehide", () => flushSave());
  }

  /** Arquivar um plano da lista: vai para _Arquivo (ou baixa o .json) e sai da lista. */
  async function archiveDoc(id) {
    const item = (state.plansCache || []).find((x) => x.doc.id === id);
    if (!item || (state.doc && state.doc.id === id)) return;
    const d = item.doc;
    if (!root.confirm(Store.archivePrompt(`${d.clientName || "Sem cliente"} (${d.actions.length} ações)`, "o plano", await Store.folderReady()))) return;
    try {
      const res = await Store.archiveRecord(d.id, d.fileName, IO.serialize(d), STORE);
      if (res.status !== "ok") return toast(res.status === "no-permission" ? "Autorize a pasta antes de arquivar." : "Não foi possível arquivar.", "error");
      toast(res.mode === "pasta" ? `Plano arquivado em ${res.archived}.` : `Plano tirado do navegador; cópia baixada: ${res.archived}.`, "ok", 6000);
    } catch (err) {
      toast(`Erro ao arquivar: ${err.message || err}`, "error");
    }
    showDocs();
  }

  async function showDocs() {
    const { list, source } = await listPlans();
    $("doc-source").textContent = source;
    $("client-list").replaceChildren(...Array.from(knownClients().values()).map((n) => el("option", { value: n })));
    setTemplateInfo((await getTemplate()) || state.template);
    $("doc-list").replaceChildren(
      ...(list.length
        ? list.map(({ doc, inFolder }) => {
            const li = el("li", { className: "study-row" + (state.doc && state.doc.id === doc.id ? " is-current" : "") });
            li.dataset.id = doc.id;
            li.dataset.fileName = doc.fileName;
            const r = P.computePlan(doc);
            const btn = el("button", { type: "button", className: "study-item" }, [
              el("span", { className: "study-title", textContent: `${doc.clientName || "Sem cliente"} — Plano de ação` }),
              el("span", { className: "study-meta", textContent: `${r.total} ação(ões) • ${r.count.concluida} concluída(s) • ${r.count.atrasada} atrasada(s) • ${doc.fileName}` }),
              el("span", { className: "study-badges" }, [el("span", { className: `badge ${inFolder ? "badge-folder" : "badge-local"}`, textContent: inFolder ? "Na pasta" : "Só no navegador" })]),
            ]);
            btn.dataset.action = "open";
            li.append(btn);
            if (!(state.doc && state.doc.id === doc.id)) {
              const arc = el("button", { type: "button", className: "btn-outline", textContent: "Arquivar", title: "Tira da lista sem apagar: o arquivo vai para a subpasta _Arquivo (sem pasta: baixa o .json)" });
              arc.dataset.action = "archive";
              li.append(el("div", { className: "study-actions" }, [arc]));
            }
            return li;
          })
        : [el("li", { className: "empty", textContent: "Nenhum plano salvo ainda. Crie o primeiro acima." })])
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
    state.template = await getTemplate();
    await loadStudies();
    await syncTemplate();
    // ?cliente=… (vindo de outro módulo): abre o plano desse cliente, ou a janela para criar
    const wanted = new root.URLSearchParams(root.location.search).get("cliente");
    let opened = false;
    if (wanted) {
      const { list } = await listPlans();
      const hit = list.find(({ doc }) => Calc.elementKey(doc.clientName) === Calc.elementKey(wanted));
      if (hit) opened = await openDoc(hit.doc.id, hit.doc.fileName);
      else $("new-client").value = wanted;
    } else {
      const lastId = await Store.getKV("lastPlanId");
      if (lastId) opened = await openDoc(lastId);
    }
    if (!opened) await showDocs();
    refreshStatus();
  }

  root.LeanPlanoApp = { state, flushSave, openDoc, loadStudies };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof self !== "undefined" ? self : this);
