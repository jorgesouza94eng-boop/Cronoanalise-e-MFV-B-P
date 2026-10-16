/**
 * ============================================================================
 * LEAN CHRONO & MFV — PÁGINA DO MAPA DE FLUXO DE VALOR (ESTADO PRESENTE)
 * ----------------------------------------------------------------------------
 * Tela + orquestração do MFV. Usa o mesmo armazenamento da cronoanálise
 * (navegador + pasta do OneDrive, com controle de revisão contra conflito)
 * e lê os estudos para preencher o TC de cada etapa (editável).
 * Depende de: LeanCalc, LeanMfv, LeanStorage.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const M = root.LeanMfv;
  const Store = root.LeanStorage;
  const STORE = Store.STORE_MFV;
  const IO = { normalize: M.normalizeMfv, serialize: M.serializeMfv };
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
    studies: [], // estudos disponíveis para vincular: { id, fileName, clientName, processName, tcMin }
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

  const unitOf = () => (state.doc && Calc.TIME_UNITS[state.doc.timeUnit] ? state.doc.timeUnit : "min");
  const ft = (min, d) => Calc.formatTime(min, unitOf(), d);
  const pu = () => (state.doc && state.doc.productUnit) || "pç";

  function setStatus(kind, text, tip) {
    const pill = $("sync-status");
    pill.className = `status-pill status-${kind}`;
    pill.querySelector(".status-text").textContent = text;
    pill.title = tip || text;
  }

  /* ==========================================================================
     ALTERAÇÕES E SALVAMENTO (mesmo fluxo da cronoanálise)
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
    if (!state.doc) return setStatus("offline", "Nenhum MFV aberto");
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
    state.diskRevision = record.diskRevision == null ? null : record.diskRevision;
    state.dirty = !!record.dirty;
    state.conflict = null;
    state.lastError = null;
    state.changeSeq += 1;
    $("conflict-banner").hidden = true;
    refreshLinkedSteps(false);
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
        const d = await Store.readStudyFile(fileName, M.normalizeMfv);
        if (d && d.invalid) diskInvalid = true;
        else disk = d;
      } catch (err) {
        toast(`Não foi possível ler ${fileName}: ${err.message || err}`, "error");
      }
    }
    if (!local && !disk) {
      toast("MFV não encontrado.", "error");
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
    await Store.setKV("lastMfvId", id);
    return true;
  }

  /* ==========================================================================
     ESTUDOS DE CRONOANÁLISE (ORIGEM DO TC)
     ========================================================================== */

  /** Lê os estudos do navegador e da pasta e calcula o tempo padrão de cada um. */
  async function loadStudies() {
    const map = new Map();
    const add = (study, fileName) => {
      const prev = map.get(study.id);
      if (prev && String(prev.updatedAt) >= String(study.updatedAt)) return;
      const k = Calc.computeStudy(study).kpis;
      map.set(study.id, {
        id: study.id,
        fileName: fileName || study.fileName,
        clientName: study.clientName,
        processName: study.processName,
        updatedAt: study.updatedAt,
        tcMin: k.standardTime > 0 ? k.standardTime : k.sumNormal > 0 ? k.sumNormal : null,
      });
    };
    (await Store.listLocal()).forEach((r) => r && r.study && add(r.study));
    if (await Store.folderReady()) {
      try {
        const { studies } = await Store.listFolderStudies();
        studies.forEach((s) => add(s, s.fileName));
      } catch (err) {
        console.warn("Erro ao ler estudos da pasta:", err);
      }
    }
    state.studies = Array.from(map.values());
    renderStudyPicker();
  }

  function renderStudyPicker() {
    const sel = $("study-picker");
    const client = state.doc ? Calc.elementKey(state.doc.clientName) : "";
    const list = state.studies.slice().sort((a, b) => {
      const ma = Calc.elementKey(a.clientName) === client ? 0 : 1;
      const mb = Calc.elementKey(b.clientName) === client ? 0 : 1;
      return ma - mb || String(a.processName).localeCompare(String(b.processName), "pt-BR");
    });
    sel.replaceChildren(
      el("option", { value: "", textContent: list.length ? "Selecione um estudo..." : "Nenhum estudo encontrado" }),
      ...list.map((s) =>
        el("option", {
          value: s.id,
          textContent: `${s.processName || "Sem posto"} — ${s.clientName || "Sem cliente"} (${s.tcMin ? ft(s.tcMin) + " " + Calc.TIME_UNITS[unitOf()].label : "sem tempo"})`,
        })
      )
    );
  }

  /** Atualiza o TC das etapas vinculadas com o tempo padrão atual dos estudos. */
  function refreshLinkedSteps(announce) {
    if (!state.doc) return 0;
    let changed = 0;
    state.doc.steps.forEach((s) => {
      if (!s.studyId) return;
      const st = state.studies.find((x) => x.id === s.studyId);
      if (!st) return;
      if (st.tcMin !== s.tcStudyMin || st.fileName !== s.studyFileName) {
        s.tcStudyMin = st.tcMin;
        s.studyFileName = st.fileName;
        changed += 1;
      }
    });
    if (changed) {
      state.doc.updatedAt = new Date().toISOString();
      state.dirty = true;
      state.changeSeq += 1;
      persistLocal();
      scheduleDiskSave(DISK_SAVE_DELAY_MS);
    }
    if (announce) toast(changed ? `${changed} TC(s) atualizado(s) a partir dos estudos.` : "TCs já estão atualizados.", "ok");
    return changed;
  }

  /* ==========================================================================
     RENDERIZAÇÃO
     ========================================================================== */

  function renderAll() {
    const d = state.doc;
    document.querySelectorAll("[data-doc]").forEach((input) => {
      input.value = d[input.dataset.doc] == null ? "" : d[input.dataset.doc];
    });
    document.title = `MFV — ${d.clientName || "Cliente"} | Lean Chrono & MFV`;

    // Horário
    $("schedule-tbody").replaceChildren(
      ...d.schedule.map((day) =>
        el("tr", { className: "schedule-row" }, [
          el("td", { className: "cell-day", textContent: day.day }),
          ...["start", "end", "breaks", "meal"].map((f) =>
            el("td", {}, [
              el("input", {
                type: "text",
                className: "input-cell mono",
                value: day[f],
                inputMode: "numeric",
                placeholder: f === "start" || f === "end" ? "--:--" : "00:00",
                autocomplete: "off",
                title: `${day.day}: ${{ start: "entrada", end: "saída", breaks: "pausas", meal: "refeição" }[f]}`,
              }),
            ])
          ),
          el("td", { className: "cell-readonly mono" }),
        ])
      )
    );
    $("schedule-tbody")
      .querySelectorAll("tr")
      .forEach((tr, i) => {
        tr.dataset.day = i;
        ["start", "end", "breaks", "meal"].forEach((f, j) => (tr.querySelectorAll("input")[j].dataset.field = f));
        tr.lastChild.dataset.out = "net";
      });

    // Etapas do GBO
    $("steps-tbody").replaceChildren(...d.steps.map((s, i) => stepRow(s, i)));
    if (!d.steps.length) {
      const td = el("td", { className: "cell-text text-muted", textContent: "Adicione as etapas: escolha um estudo de cronoanálise e clique em '+ Etapa do estudo', ou use '+ Etapa manual'." });
      td.colSpan = 10;
      $("steps-tbody").append(el("tr", {}, [td]));
    }

    // Estoques
    $("inventory-tbody").replaceChildren(
      ...d.inventories.map((inv) => {
        const tr = el("tr", {}, [
          el("td", {}, [el("input", { type: "text", className: "input-cell", value: inv.name, placeholder: "Ex.: Cura no pátio", autocomplete: "off" })]),
          el("td", {}, [el("input", { type: "text", className: "input-cell mono", value: inv.quantity, inputMode: "decimal", autocomplete: "off" })]),
          el("td", { className: "cell-readonly mono" }),
          el("td", { className: "cell-actions" }, [el("button", { type: "button", className: "btn-icon-del", textContent: "×", title: "Remover estoque" })]),
        ]);
        tr.dataset.id = inv.id;
        tr.querySelectorAll("input")[0].dataset.field = "name";
        tr.querySelectorAll("input")[1].dataset.field = "quantity";
        tr.children[2].dataset.out = "days";
        return tr;
      })
    );
    renderStudyPicker();
    update();
  }

  function stepRow(s, i) {
    const tr = el("tr");
    tr.dataset.id = s.id;
    const radio = el("input", { type: "radio", name: "kaizen", checked: !!s.kaizen, title: "Processo Kaizen" });
    radio.dataset.field = "kaizen";
    const origin = el("td", { className: "cell-text origin-cell" });
    if (s.studyId) {
      const edited = s.source === "manual";
      origin.append(el("span", { className: "origin-study", textContent: `${edited ? "✎ editado • " : "Estudo: "}${studyLabel(s)}`, title: s.studyFileName }));
      if (edited) {
        const back = el("button", { type: "button", className: "btn-link", textContent: "↺ usar estudo", title: "Voltar a usar o tempo padrão do estudo" });
        back.dataset.action = "use-study";
        origin.append(back);
      }
    } else {
      origin.append(el("span", { className: "text-muted", textContent: "Manual" }));
    }
    const tcInput = el("input", { type: "text", className: "input-cell mono input-tc", inputMode: "decimal", autocomplete: "off", title: "TC editável: ao alterar, a etapa passa a usar o valor digitado" });
    tcInput.dataset.field = "tc";
    const mk = (field, value, cls) => {
      const inp = el("input", { type: "text", className: `input-cell ${cls || ""}`, value: value == null ? "" : value, autocomplete: "off" });
      inp.dataset.field = field;
      return inp;
    };
    const actions = el("td", { className: "cell-actions step-actions" }, [
      el("button", { type: "button", className: "btn-icon", textContent: "↑", title: "Subir etapa" }),
      el("button", { type: "button", className: "btn-icon", textContent: "↓", title: "Descer etapa" }),
      el("button", { type: "button", className: "btn-icon-del", textContent: "×", title: "Remover etapa" }),
    ]);
    actions.children[0].dataset.action = "up";
    actions.children[1].dataset.action = "down";
    actions.children[2].dataset.action = "remove";
    tr.append(
      el("td", { className: "cell-center" }, [radio]),
      el("td", { className: "cell-num", textContent: String(i + 1).padStart(2, "0") }),
      el("td", {}, [mk("name", s.name, "")]),
      origin,
      el("td", {}, [tcInput]),
      el("td", {}, [mk("operators", s.operators, "mono")]),
      el("td", {}, [mk("uptimePct", s.uptimePct, "mono")]),
      el("td", { className: "cell-readonly mono" }),
      el("td", { className: "cell-readonly mono" }),
      actions
    );
    tr.children[7].dataset.out = "opsEff";
    tr.children[8].dataset.out = "takt";
    return tr;
  }

  function studyLabel(s) {
    const st = state.studies.find((x) => x.id === s.studyId);
    return st ? st.processName || st.fileName : s.studyFileName || "estudo não encontrado";
  }

  /** Atualiza só os valores calculados (mantém o foco do teclado). */
  function update() {
    const d = state.doc;
    const r = M.computeMfv(d);
    state.computed = r;
    const unit = unitOf();
    const u = Calc.TIME_UNITS[unit].label;
    document.querySelectorAll(".unit-label").forEach((n) => (n.textContent = u));
    document.querySelectorAll(".product-unit-label").forEach((n) => (n.textContent = pu()));

    // Horário
    $("schedule-tbody").querySelectorAll("tr").forEach((tr, i) => {
      const day = r.days[i];
      tr.querySelector('[data-out="net"]').textContent = day.worked ? M.formatClock(day.net) : day.errors.length ? "⚠" : "—";
      tr.classList.toggle("row-error", day.errors.length > 0);
      tr.title = day.errors.join(" • ");
    });
    $("avg-day").textContent = r.workedDays ? `${M.formatClock(r.avgDayMin)} (${r.workedDays} dias)` : "--";

    // Demanda e takt
    $("kpi-avail").textContent = fmt(r.availDayMin || null, 1);
    $("kpi-avail-cap").textContent = r.workedDays ? `${fmt(r.availDayMin / 60, 2)} h/dia × ${r.workedDays} dias/semana` : "Preencha o horário";
    $("kpi-demand").textContent = fmt(r.demandDaily, 2);
    $("kpi-demand-unit").textContent = `${pu()}/dia`;
    $("kpi-takt").textContent = r.takt != null ? ft(r.takt) : "--";
    $("kpi-takt-unit").textContent = `${u}/${pu()}`;
    $("kpi-takt-cap").textContent = r.issues.length ? `⚠ ${r.issues[0]}` : "Tempo disponível ÷ demanda diária";

    // Etapas
    const rows = $("steps-tbody").querySelectorAll("tr[data-id]");
    r.steps.forEach((s, i) => {
      const tr = rows[i];
      if (!tr) return;
      const src = d.steps[i];
      const tcInput = tr.querySelector('[data-field="tc"]');
      if (document.activeElement !== tcInput) {
        const tcMin = src.source === "study" ? src.tcStudyMin : src.tcManualMin;
        tcInput.value = Number.isFinite(tcMin) ? ft(tcMin) : "";
      }
      tr.querySelector('[data-out="opsEff"]').textContent = fmt(s.opsEff, 2);
      tr.querySelector('[data-out="takt"]').textContent = s.taktPct != null ? `${fmt(s.taktPct, 1)}%` : "--";
      tr.classList.toggle("row-error", s.errors.length > 0);
      tr.classList.toggle("row-over-takt", s.overTakt);
      tr.title = s.errors.join(" • ") || (s.overTakt ? "TC acima do takt (gargalo)" : "");
    });
    $("tc-total").textContent = r.tcTotal ? ft(r.tcTotal) : "--";
    $("ops-total").textContent = fmt(r.opsTotal, 2);
    renderGbo(r);

    // Resultados
    $("kpi-bottleneck-tc").textContent = r.bottleneck ? ft(r.bottleneck.tc) : "--";
    $("kpi-bottleneck-unit").textContent = r.bottleneck ? `${u}/${pu()}` : "";
    $("kpi-bottleneck-name").textContent = r.bottleneck ? `${r.bottleneck.seq}. ${r.bottleneck.name}` : "Sem etapas";
    $("kpi-ops").textContent = fmt(r.opsTotal, 2);
    $("kpi-ops-ideal").textContent = `Ideal (ΣTC ÷ takt): ${r.opsIdeal != null ? fmt(r.opsIdeal, 2) : "--"}`;
    $("kpi-cap").textContent = fmt(r.line.capacityDay, 1);
    $("kpi-cap-unit").textContent = `${pu()}/dia`;
    $("kpi-cap-hour").textContent = r.line.capacityHour != null ? `${fmt(r.line.capacityHour, 2)} ${pu()}/hora (limitada pelo gargalo)` : "--";
    $("kpi-prod").textContent = fmt(r.line.productivityHour, 2);
    $("kpi-prod-unit").textContent = `${pu()}/h/op`;
    $("kpi-prod-day").textContent = r.line.productivityDay != null ? `${fmt(r.line.productivityDay, 1)} ${pu()}/dia/operador` : "--";
    const card = $("kpi-status-card");
    card.classList.remove("is-bottleneck", "is-balanced");
    if (r.kaizen) {
      $("kpi-kaizen").textContent = r.kaizen.capacityDay != null ? `${fmt(r.kaizen.capacityDay, 1)} ${pu()}/dia` : "--";
      $("kpi-kaizen-detail").textContent = `${r.kaizen.name} • ${fmt(r.kaizen.productivityHour, 2)} ${pu()}/h/op`;
      if (r.kaizen.tc != null && r.takt) card.classList.add(r.kaizen.tc > r.takt ? "is-bottleneck" : "is-balanced");
    } else {
      $("kpi-kaizen").textContent = "--";
      $("kpi-kaizen-detail").textContent = "Marque uma etapa como Kaizen";
    }

    // Estoques
    $("inventory-tbody").querySelectorAll("tr").forEach((tr, i) => {
      const inv = r.inventories[i];
      if (inv) tr.querySelector('[data-out="days"]').textContent = inv.days != null ? fmt(inv.days, 2) : "--";
    });
    $("lead-time").textContent = r.demandDaily ? `${fmt(r.leadTimeDays, 2)} dias` : "--";
    $("lead-hint").textContent = r.tcTotal && r.leadTimeDays
      ? `Dias = estoque ÷ demanda diária. Tempo de processamento (ΣTC): ${ft(r.tcTotal)} ${u}.`
      : "Dias = quantidade em estoque ÷ demanda diária.";
  }

  /** Gráfico de balanceamento: barras verticais por etapa e linha do takt. */
  function renderGbo(r) {
    const box = $("gbo-chart");
    const steps = r.steps.filter((s) => s.tc != null);
    if (!steps.length) {
      box.replaceChildren(el("p", { className: "chart-empty", textContent: "As barras aparecem quando as etapas tiverem TC." }));
      return;
    }
    const u = Calc.TIME_UNITS[unitOf()].label;
    const max = Math.max(...steps.map((s) => s.tc), r.takt || 0) * 1.12;
    const plot = el("div", { className: "gbo-plot" });
    if (r.takt) {
      const line = el("div", { className: "gbo-takt", title: `Takt: ${ft(r.takt)} ${u}` }, [el("span", { textContent: `Takt ${ft(r.takt)} ${u}` })]);
      line.style.bottom = `${(r.takt / max) * 100}%`;
      plot.append(line);
    }
    steps.forEach((s) => {
      const col = el("div", { className: "gbo-col", title: `${s.seq}. ${s.name}: ${ft(s.tc)} ${u}${s.taktPct != null ? ` (${fmt(s.taktPct, 1)}% do takt)` : ""}` });
      const bar = el("div", { className: "gbo-bar" + (s.overTakt ? " is-over" : "") + (s.kaizen ? " is-kaizen" : "") });
      bar.style.height = `${(s.tc / max) * 100}%`;
      col.append(el("span", { className: "gbo-value", textContent: ft(s.tc) }), bar);
      plot.append(col);
    });
    const labels = el(
      "div",
      { className: "gbo-labels" },
      steps.map((s) => el("span", { textContent: `${s.seq}. ${s.name}`, title: s.name }))
    );
    box.replaceChildren(plot, labels);
  }

  /* ==========================================================================
     EVENTOS
     ========================================================================== */

  function bindEvents() {
    // Campos do documento (cliente, família, demanda, notas, unidade...)
    document.querySelectorAll("[data-doc]").forEach((input) => {
      const evt = input.tagName === "SELECT" ? "change" : "input";
      input.addEventListener(evt, () => {
        if (!state.doc) return;
        state.doc[input.dataset.doc] = input.value;
        const structural = input.dataset.doc === "timeUnit";
        markChanged({ render: structural });
      });
    });

    // Horário
    $("schedule-tbody").addEventListener("input", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || !e.target.dataset.field) return;
      state.doc.schedule[Number(tr.dataset.day)][e.target.dataset.field] = e.target.value;
      markChanged();
    });
    $("schedule-tbody").addEventListener("focusout", (e) => {
      const p = M.parseClock(e.target.value);
      if (!p.error && p.minutes != null && e.target.dataset.field) {
        const tr = e.target.closest("tr");
        const v = M.formatClock(p.minutes);
        if (v !== e.target.value) {
          e.target.value = v;
          state.doc.schedule[Number(tr.dataset.day)][e.target.dataset.field] = v;
          markChanged();
        }
      }
    });

    // Etapas
    const steps = $("steps-tbody");
    steps.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-id]");
      const f = e.target.dataset.field;
      if (!tr || !f || f === "kaizen") return;
      const s = state.doc.steps.find((x) => x.id === tr.dataset.id);
      if (f === "tc") {
        const v = Calc.parseNumber(e.target.value);
        s.tcManualMin = v != null && v > 0 ? v / Calc.TIME_UNITS[unitOf()].factor : null;
        if (s.source !== "manual") {
          s.source = "manual"; // TC editado: passa a usar o valor digitado
          markChanged();
          const origin = tr.querySelector(".origin-cell");
          const fresh = stepRow(s, Array.from(steps.children).indexOf(tr));
          origin.replaceWith(fresh.querySelector(".origin-cell"));
          return;
        }
      } else {
        s[f] = e.target.value;
      }
      markChanged();
    });
    steps.addEventListener("change", (e) => {
      if (e.target.dataset.field !== "kaizen") return;
      const id = e.target.closest("tr").dataset.id;
      state.doc.steps.forEach((s) => (s.kaizen = s.id === id));
      markChanged();
    });
    steps.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = btn.closest("tr").dataset.id;
      const list = state.doc.steps;
      const i = list.findIndex((s) => s.id === id);
      const a = btn.dataset.action;
      if (a === "use-study") {
        list[i].source = "study";
        list[i].tcManualMin = null;
      } else if (a === "up" && i > 0) list.splice(i - 1, 0, list.splice(i, 1)[0]);
      else if (a === "down" && i < list.length - 1) list.splice(i + 1, 0, list.splice(i, 1)[0]);
      else if (a === "remove") {
        if (!root.confirm(`Remover a etapa "${list[i].name || i + 1}"?`)) return;
        list.splice(i, 1);
      } else return;
      markChanged({ render: true });
    });

    $("btn-add-study-step").addEventListener("click", () => {
      const st = state.studies.find((x) => x.id === $("study-picker").value);
      if (!st) return toast("Escolha um estudo na lista.", "warn");
      state.doc.steps.push(
        M.createStep({ name: st.processName || "Etapa", source: "study", studyId: st.id, studyFileName: st.fileName, tcStudyMin: st.tcMin })
      );
      if (!state.doc.clientName && st.clientName) state.doc.clientName = st.clientName;
      markChanged({ render: true });
      toast(`Etapa adicionada: ${st.processName} (TC ${st.tcMin ? ft(st.tcMin) + " " + Calc.TIME_UNITS[unitOf()].label : "sem tempo padrão"}).`, "ok");
    });
    $("btn-add-manual-step").addEventListener("click", () => {
      state.doc.steps.push(M.createStep({ name: "" }));
      markChanged({ render: true });
      const rows = $("steps-tbody").querySelectorAll('[data-field="name"]');
      rows[rows.length - 1].focus();
    });
    $("btn-refresh-studies").addEventListener("click", async () => {
      await loadStudies();
      refreshLinkedSteps(true);
      renderAll();
    });

    // Estoques
    const inv = $("inventory-tbody");
    inv.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || !e.target.dataset.field) return;
      state.doc.inventories.find((x) => x.id === tr.dataset.id)[e.target.dataset.field] = e.target.value;
      markChanged();
    });
    inv.addEventListener("click", (e) => {
      if (!e.target.closest(".btn-icon-del")) return;
      const id = e.target.closest("tr").dataset.id;
      state.doc.inventories = state.doc.inventories.filter((x) => x.id !== id);
      markChanged({ render: true });
    });
    $("btn-add-inventory").addEventListener("click", () => {
      state.doc.inventories.push(M.createInventory());
      markChanged({ render: true });
      const names = inv.querySelectorAll('[data-field="name"]');
      names[names.length - 1].focus();
    });

    // Cabeçalho, conflito, exportação
    $("btn-connect-folder").addEventListener("click", connectFolder);
    $("btn-docs").addEventListener("click", () => showDocs());
    $("btn-export-mfv").addEventListener("click", () => {
      Store.downloadText(state.doc.fileName, M.serializeMfv(state.doc), "application/json");
      toast(`Arquivo exportado: ${state.doc.fileName}`, "ok");
    });
    $("btn-conflict-disk").addEventListener("click", async () => {
      if (!(await ensurePermission())) return;
      const disk = await Store.readStudyFile(state.doc.fileName, M.normalizeMfv);
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
    dlg.addEventListener("cancel", (e) => {
      if (!state.doc) e.preventDefault();
    });
    $("new-doc-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const client = $("new-client").value.trim();
      const family = $("new-family").value.trim();
      if (!client || !family) return toast("Informe a empresa e a família.", "warn");
      await flushSave();
      const doc = M.createMfv({ clientName: client, family });
      setCurrent({ study: doc, diskRevision: null, dirty: true });
      await persistLocal();
      await Store.setKV("lastMfvId", doc.id);
      dlg.close();
      if (state.folder === "granted") queueWrite();
      toast(`MFV criado: ${doc.fileName}`, "ok");
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
    $("input-import-mfv").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const res = await Store.readImportFile(file, M.normalizeMfv);
      if (!res.ok) return toast(`Importação recusada: ${res.error}`, "error");
      await flushSave();
      await Store.putLocal({ id: res.doc.id, study: res.doc, diskRevision: res.doc.revision, dirty: true }, STORE);
      if (await openDoc(res.doc.id, res.doc.fileName)) {
        dlg.close();
        toast(`MFV importado: ${res.doc.clientName}`, "ok");
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        flushSave().then(() => toast("MFV salvo.", "ok"));
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushSave();
    });
    root.addEventListener("pagehide", () => flushSave());
  }

  async function showDocs() {
    const items = new Map();
    (await Store.listLocal(STORE)).forEach((r) => r && r.study && items.set(r.id, { doc: r.study, inFolder: false }));
    let source = "Navegador deste dispositivo";
    if (await Store.folderReady()) {
      source = `Pasta: ${Store.getDirHandle().name}`;
      try {
        const { studies } = await Store.listFolderStudies({ pattern: M.FILE_PATTERN, normalize: M.normalizeMfv });
        studies.forEach((d) => {
          const it = items.get(d.id);
          if (!it || String(d.updatedAt) > String(it.doc.updatedAt)) items.set(d.id, { doc: d, inFolder: true });
          else it.inFolder = true;
        });
      } catch (err) {
        toast(`Erro ao ler a pasta: ${err.message || err}`, "error");
      }
    }
    $("doc-source").textContent = source;
    const list = Array.from(items.values()).sort((a, b) => String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)));
    $("doc-list").replaceChildren(
      ...(list.length
        ? list.map(({ doc, inFolder }) => {
            const li = el("li", { className: "study-row" + (state.doc && state.doc.id === doc.id ? " is-current" : "") });
            li.dataset.id = doc.id;
            li.dataset.fileName = doc.fileName;
            const btn = el("button", { type: "button", className: "study-item" }, [
              el("span", { className: "study-title", textContent: `${doc.clientName || "Sem cliente"} — ${doc.family || "Sem família"}` }),
              el("span", { className: "study-meta", textContent: `${doc.steps.length} etapa(s) • ${doc.fileName}` }),
              el("span", { className: "study-badges" }, [el("span", { className: `badge ${inFolder ? "badge-folder" : "badge-local"}`, textContent: inFolder ? "Na pasta" : "Só no navegador" })]),
            ]);
            btn.dataset.action = "open";
            li.append(btn);
            return li;
          })
        : [el("li", { className: "empty", textContent: "Nenhum MFV salvo ainda. Crie o primeiro acima." })])
    );
    $("btn-close-dialog").hidden = !state.doc;
    const dlg = $("doc-dialog");
    if (!dlg.open) dlg.showModal();
    (list.length ? $("doc-list").querySelector(".study-item") : $("new-client")).focus();
  }

  /* ==========================================================================
     INICIALIZAÇÃO
     ========================================================================== */

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
    const lastId = await Store.getKV("lastMfvId");
    if (lastId) opened = await openDoc(lastId);
    if (!opened) await showDocs();
    refreshStatus();
  }

  root.LeanMfvApp = { state, flushSave, openDoc, loadStudies };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof self !== "undefined" ? self : this);
