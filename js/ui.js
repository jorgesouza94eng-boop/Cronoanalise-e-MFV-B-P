/**
 * ============================================================================
 * LEAN CHRONO & MFV — INTERFACE (DOM) E NAVEGAÇÃO POR TECLADO
 * ----------------------------------------------------------------------------
 * Só manipula a tela. Toda regra de negócio fica em calc.js e todo o
 * salvamento em storage.js; a orquestração fica em app.js, que entrega os
 * "handlers" para esta camada.
 * Depende de: LeanCalc (calc.js).
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const fmt = Calc.formatNumber;

  let els = {};
  let h = {}; // handlers fornecidos pelo app.js

  /** Ordem do fluxo rápido com Enter. Frequência e Kaizen ficam fora (acesso por Tab). */
  const ENTER_FLOW = {
    description: "videoTime",
    frequency: "videoTime",
    videoTime: "pace",
    pace: "__next_row__",
    kaizen: "__next_row__",
  };

  /* ==========================================================================
     INICIALIZAÇÃO E EVENTOS
     ========================================================================== */

  function init(handlers) {
    h = handlers;
    const $ = (id) => document.getElementById(id);
    els = {
      client: $("client-name"),
      process: $("process-name"),
      status: $("sync-status"),
      btnStudies: $("btn-studies"),
      btnConnect: $("btn-connect-folder"),
      conflictBanner: $("conflict-banner"),
      conflictDetail: $("conflict-detail"),
      btnConflictDisk: $("btn-conflict-disk"),
      btnConflictLocal: $("btn-conflict-local"),
      params: Array.from(document.querySelectorAll("[data-param]")),
      kpiNet: $("kpi-net-time"),
      kpiTakt: $("kpi-takt-time"),
      kpiTaktSec: $("kpi-takt-sec"),
      kpiCycle: $("kpi-cycle-time"),
      kpiNormal: $("kpi-normal-time"),
      kpiCapacity: $("kpi-capacity"),
      kpiCard: $("kpi-bottleneck-card"),
      kpiStatus: $("kpi-bottleneck"),
      kpiDetail: $("kpi-bottleneck-detail"),
      videoStart: $("video-start"),
      btnAddRow: $("btn-add-row"),
      btnExportJson: $("btn-export-json"),
      btnExportCsv: $("btn-export-csv"),
      tbody: $("chrono-tbody"),
      rowTemplate: $("row-template"),
      totalTsub: $("total-tsub"),
      totalTnorm: $("total-tnorm"),
      totalErrors: $("total-errors"),
      dialog: $("study-dialog"),
      btnCloseDialog: $("btn-close-dialog"),
      newStudyForm: $("new-study-form"),
      newClient: $("new-client"),
      newProcess: $("new-process"),
      studyList: $("study-list"),
      studySource: $("study-source"),
      storageHint: $("storage-hint"),
      importInput: $("input-import-json"),
      toasts: $("toast-region"),
    };

    // Cabeçalho
    els.client.addEventListener("input", () => h.onMetaChange("clientName", els.client.value));
    els.process.addEventListener("input", () => h.onMetaChange("processName", els.process.value));
    els.btnStudies.addEventListener("click", () => h.onOpenStudies());
    els.btnConnect.addEventListener("click", () => h.onConnectFolder());
    els.btnConflictDisk.addEventListener("click", () => h.onConflictUseDisk());
    els.btnConflictLocal.addEventListener("click", () => h.onConflictKeepLocal());

    // Parâmetros da jornada
    els.params.forEach((input) => {
      input.addEventListener("input", () => {
        const ok = h.onParamChange(input.dataset.param, input.value);
        input.classList.toggle("input-invalid", !ok);
      });
    });

    // Leitura inicial do vídeo
    els.videoStart.addEventListener("change", commitVideoStart);
    els.videoStart.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (commitVideoStart()) focusCell(0, "videoTime");
      }
    });

    // Barra de ferramentas
    els.btnAddRow.addEventListener("click", () => addRowAndFocus());
    els.btnExportJson.addEventListener("click", () => h.onExportJSON());
    els.btnExportCsv.addEventListener("click", () => h.onExportCSV());

    // Grade (delegação de eventos: funciona para linhas criadas dinamicamente)
    els.tbody.addEventListener("input", onGridInput);
    els.tbody.addEventListener("focusout", onGridFocusOut);
    els.tbody.addEventListener("keydown", onGridKeyDown);
    els.tbody.addEventListener("click", onGridClick);

    // Atalhos globais
    document.addEventListener("keydown", onGlobalKeyDown);

    // Diálogo de estudos
    els.btnCloseDialog.addEventListener("click", () => closeDialog());
    els.dialog.addEventListener("cancel", (e) => {
      if (!h.hasOpenStudy()) e.preventDefault(); // sem estudo aberto não há para onde voltar
    });
    els.newStudyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const client = els.newClient.value.trim();
      const process = els.newProcess.value.trim();
      if (!client || !process) {
        toast("Informe a empresa e o posto para criar o estudo.", "warn");
        return;
      }
      h.onCreateStudy(client, process);
    });
    els.studyList.addEventListener("click", onStudyListClick);
    els.importInput.addEventListener("change", () => {
      const file = els.importInput.files && els.importInput.files[0];
      els.importInput.value = "";
      if (file) h.onImportFile(file);
    });
  }

  function commitVideoStart() {
    const res = h.onVideoStartCommit(els.videoStart.value);
    els.videoStart.classList.toggle("input-invalid", !res.ok);
    if (res.ok) els.videoStart.value = res.formatted;
    else toast(`Leitura inicial: ${res.error}`, "error");
    return res.ok;
  }

  /* ==========================================================================
     EVENTOS DA GRADE
     ========================================================================== */

  function rowInfo(target) {
    const tr = target.closest("tr");
    if (!tr || !tr.dataset.id) return null;
    const rows = Array.from(els.tbody.rows);
    return { tr, id: tr.dataset.id, index: rows.indexOf(tr), field: target.dataset.field };
  }

  function onGridInput(e) {
    const info = rowInfo(e.target);
    if (!info || !info.field) return;
    // O tempo final só é interpretado ao confirmar (Enter/saída do campo).
    if (info.field === "videoTime") return;
    h.onElementInput(info.id, info.field, e.target.value);
  }

  function onGridFocusOut(e) {
    const info = rowInfo(e.target);
    if (!info) return;
    if (info.field === "videoTime") {
      const res = commitTime(info, e.target);
      if (!res.ok) toast(`Linha ${info.index + 1}: ${res.error}`, "error");
    }
    if (info.field === "pace") commitPace(info, e.target, true);
  }

  /** Confirma o tempo final. Retorna true se válido. */
  function commitTime(info, input) {
    const res = h.onTimeCommit(info.id, input.value);
    if (res.ok) input.value = res.formatted;
    input.classList.toggle("input-invalid", !res.ok || !!res.rowError);
    return res;
  }

  function commitPace(info, input, announce) {
    const res = h.onPaceCommit(info.id, input.value);
    input.classList.toggle("input-invalid", !res.ok);
    if (!res.ok && announce) toast(res.error, "error");
    return res;
  }

  function onGridKeyDown(e) {
    const info = rowInfo(e.target);
    if (!info || !info.field) return;

    // Ctrl+Del: exclui a linha atual
    if (e.key === "Delete" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      deleteRow(info);
      return;
    }

    // Ctrl+Enter é tratado no atalho global
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (info.field === "videoTime") {
        const res = commitTime(info, e.target);
        if (!res.ok || res.rowError) {
          toast(`Linha ${info.index + 1}: ${res.error || res.rowError}`, "error");
          e.target.select();
          return;
        }
      }
      if (info.field === "pace") {
        const res = commitPace(info, e.target, true);
        if (!res.ok) {
          e.target.select();
          return;
        }
      }
      const next = ENTER_FLOW[info.field];
      if (next === "__next_row__") goToNextRow(info.index);
      else focusCell(info.index, next);
      return;
    }

    // Setas ↑ ↓: mesma coluna, linha anterior/seguinte
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      const target = info.index + (e.key === "ArrowUp" ? -1 : 1);
      if (target >= 0 && target < els.tbody.rows.length) {
        e.preventDefault();
        focusCell(target, info.field);
      }
    }
  }

  function onGridClick(e) {
    const btn = e.target.closest(".btn-icon-del");
    if (!btn) return;
    const info = rowInfo(btn);
    if (info) deleteRow(info);
  }

  function deleteRow(info) {
    const el = h.getElement(info.id);
    const hasContent = el && (el.description || el.videoTime || el.kaizen);
    if (hasContent && !root.confirm(`Excluir a linha ${info.index + 1}${el.description ? ` ("${el.description}")` : ""}?`)) {
      return;
    }
    h.onDeleteRow(info.id);
    const total = els.tbody.rows.length;
    focusCell(Math.min(info.index, total - 1), info.field || "description");
  }

  function goToNextRow(index) {
    if (index < els.tbody.rows.length - 1) focusCell(index + 1, "description");
    else addRowAndFocus();
  }

  function addRowAndFocus() {
    const index = h.onAddRow();
    focusCell(index, "description");
  }

  function onGlobalKeyDown(e) {
    // Ctrl+Enter: nova linha (de qualquer lugar fora do diálogo)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !els.dialog.open) {
      e.preventDefault();
      addRowAndFocus();
      return;
    }
    // Ctrl+S: força a gravação imediata
    if ((e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      h.onFlush();
    }
  }

  function focusCell(index, field) {
    const tr = els.tbody.rows[index];
    if (!tr) return;
    const input = tr.querySelector(`[data-field="${field}"]`);
    if (input) {
      input.focus();
      if (typeof input.select === "function") input.select();
    }
  }

  /* ==========================================================================
     RENDERIZAÇÃO
     ========================================================================== */

  /** Preenche toda a tela com o estudo aberto. */
  function renderStudy(study, computed) {
    els.client.value = study.clientName;
    els.process.value = study.processName;
    els.params.forEach((input) => {
      const v = study.shiftParams[input.dataset.param];
      input.value = v == null ? "" : String(v).replace(".", ",");
      input.classList.remove("input-invalid");
    });
    els.videoStart.value = study.videoStart || "";
    els.videoStart.classList.remove("input-invalid");
    renderRows(study, computed);
    document.title = `${study.processName || "Estudo"} — ${study.clientName || "Lean Chrono"} | Cronoanálise & MFV`;
  }

  /** Recria as linhas da grade (usado ao abrir estudo, incluir ou excluir linha). */
  function renderRows(study, computed) {
    const frag = document.createDocumentFragment();
    study.elements.forEach((el) => {
      const tr = els.rowTemplate.content.firstElementChild.cloneNode(true);
      tr.dataset.id = el.id;
      tr.querySelectorAll("[data-field]").forEach((input) => {
        input.value = el[input.dataset.field] == null ? "" : el[input.dataset.field];
      });
      frag.appendChild(tr);
    });
    els.tbody.replaceChildren(frag);
    updateComputed(computed);
  }

  /** Atualiza apenas os valores calculados (não recria campos → não perde o foco). */
  function updateComputed(computed) {
    const rows = els.tbody.rows;
    computed.rows.forEach((row, i) => {
      const tr = rows[i];
      if (!tr) return;
      tr.querySelector(".cell-num").textContent = String(row.seq).padStart(2, "0");
      const tag = tr.querySelector(".tag-type");
      tag.textContent = row.type;
      tag.classList.toggle("is-acyclic", row.type === "A");
      tag.title = row.type === "A" ? "Acíclico (frequência < 1)" : "Cíclico";
      tr.querySelector('[data-out="tsub"]').textContent = fmt(row.subtractedTime, 3);
      tr.querySelector('[data-out="tnorm"]').textContent = fmt(row.normalTime, 3);
      tr.classList.toggle("row-error", !row.valid);
      tr.title = row.errors.join(" • ");

      const freqInput = tr.querySelector('[data-field="frequency"]');
      freqInput.classList.toggle("input-invalid", row.errors.some((m) => /Frequência/i.test(m)));
    });

    els.totalTsub.textContent = fmt(computed.totals.sumSubtracted, 3);
    els.totalTnorm.textContent = fmt(computed.totals.sumNormal, 3);
    els.totalErrors.textContent = computed.errorCount
      ? `⚠ ${computed.errorCount} linha(s) com erro fora dos totais`
      : "";

    renderKpis(computed);
  }

  function renderKpis(computed) {
    const k = computed.kpis;
    els.kpiNet.textContent = fmt(k.netTime, 1);
    els.kpiTakt.textContent = fmt(k.taktTime, 2);
    els.kpiTaktSec.textContent = k.taktTime != null ? `Equivale a ${fmt(k.taktTime * 60, 1)} s/pç` : "Informe jornada e demanda";
    els.kpiCycle.textContent = k.standardTime != null && k.standardTime > 0 ? fmt(k.standardTime, 2) : "--";
    els.kpiNormal.textContent = `ΣTempo normal: ${fmt(k.sumNormal, 3)} min`;
    els.kpiCapacity.textContent = k.capacity != null ? fmt(k.capacity, 0) : "--";

    els.kpiCard.classList.remove("is-bottleneck", "is-balanced", "is-invalid");
    const errNote = computed.errorCount ? ` • ⚠ ${computed.errorCount} linha(s) com erro` : "";
    switch (k.status) {
      case "parametros-invalidos":
        els.kpiCard.classList.add("is-invalid");
        els.kpiStatus.textContent = "Verificar";
        els.kpiDetail.textContent = k.issues[0] || "Parâmetros inválidos";
        break;
      case "aguardando":
        els.kpiStatus.textContent = "Aguardando";
        els.kpiDetail.textContent = "Insira os tempos na grade" + errNote;
        break;
      case "gargalo":
        els.kpiCard.classList.add("is-bottleneck");
        els.kpiStatus.textContent = "GARGALO";
        els.kpiDetail.textContent = `Acima do takt em +${fmt(k.diffMin * 60, 1)} s/pç` + errNote;
        break;
      default:
        els.kpiCard.classList.add("is-balanced");
        els.kpiStatus.textContent = "BALANCEADO";
        els.kpiDetail.textContent = `Folga de ${fmt(k.slackPct, 1)}% em relação ao takt` + errNote;
    }
  }

  /* ==========================================================================
     STATUS, CONFLITO, BOTÕES E NOTIFICAÇÕES
     ========================================================================== */

  /** kind: offline | local | saving | online | reconnect | error */
  function setStatus(kind, text, tooltip) {
    els.status.className = `status-pill status-${kind}`;
    els.status.querySelector(".status-text").textContent = text;
    els.status.title = tooltip || text;
  }

  /** state: hidden | connect | reconnect | connected */
  function setFolderButton(state, folderName) {
    const label = els.btnConnect.querySelector(".btn-label");
    els.btnConnect.hidden = state === "hidden";
    if (state === "connect") label.textContent = "Conectar pasta (OneDrive)";
    if (state === "reconnect") label.textContent = "Reautorizar pasta";
    if (state === "connected") label.textContent = "Trocar pasta";
    els.btnConnect.title =
      state === "connected"
        ? `Pasta atual: ${folderName}. Clique para escolher outra pasta.`
        : "Selecione a pasta sincronizada pelo OneDrive onde os arquivos .json serão salvos";
  }

  function showConflict(detail) {
    els.conflictDetail.textContent = detail;
    els.conflictBanner.hidden = false;
  }

  function hideConflict() {
    els.conflictBanner.hidden = true;
  }

  function toast(message, kind, timeoutMs) {
    const div = document.createElement("div");
    div.className = `toast toast-${kind || "info"}`;
    div.textContent = message;
    els.toasts.appendChild(div);
    setTimeout(() => div.remove(), timeoutMs || (kind === "error" ? 6000 : 3500));
  }

  /* ==========================================================================
     DIÁLOGO DE ESTUDOS
     ========================================================================== */

  /**
   * items: [{ id, clientName, processName, fileName, updatedAt, inFolder, inLocal, pending, current }]
   */
  function openDialog(items, info) {
    renderStudyList(items, info);
    els.btnCloseDialog.hidden = !h.hasOpenStudy();
    if (!els.dialog.open) {
      if (typeof els.dialog.showModal === "function") els.dialog.showModal();
      else els.dialog.setAttribute("open", "");
    }
    const focusNew = info && info.focusNew;
    (focusNew || !items.length ? els.newClient : els.studyList.querySelector(".study-item") || els.newClient).focus();
  }

  function closeDialog() {
    if (!els.dialog.open) return;
    if (typeof els.dialog.close === "function") els.dialog.close();
    else els.dialog.removeAttribute("open");
    els.newStudyForm.reset();
  }

  function renderStudyList(items, info) {
    els.studySource.textContent = (info && info.source) || "";
    els.storageHint.textContent = (info && info.hint) || "";
    els.studyList.replaceChildren();

    if (!items.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Nenhum estudo salvo ainda. Crie o primeiro acima ou importe um arquivo .json.";
      els.studyList.appendChild(li);
      return;
    }

    items.forEach((it) => {
      const li = document.createElement("li");
      li.className = "study-row" + (it.current ? " is-current" : "");
      li.dataset.id = it.id;
      li.dataset.fileName = it.fileName || "";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "study-item";
      btn.dataset.action = "open";

      const title = document.createElement("span");
      title.className = "study-title";
      title.textContent = `${it.clientName || "Sem cliente"} — ${it.processName || "Sem posto"}`;

      const meta = document.createElement("span");
      meta.className = "study-meta";
      meta.textContent = `Atualizado em ${formatDateTime(it.updatedAt)} • ${it.fileName}`;

      const badges = document.createElement("span");
      badges.className = "study-badges";
      const addBadge = (cls, text) => {
        const b = document.createElement("span");
        b.className = `badge ${cls}`;
        b.textContent = text;
        badges.appendChild(b);
      };
      if (it.current) addBadge("badge-local", "Aberto");
      if (it.inFolder) addBadge("badge-folder", "Na pasta");
      else addBadge("badge-local", "Só no navegador");
      if (it.pending) addBadge("badge-pending", "Alterações não gravadas na pasta");

      btn.append(title, meta, badges);

      const actions = document.createElement("div");
      actions.className = "study-actions";
      const exp = document.createElement("button");
      exp.type = "button";
      exp.className = "btn-outline";
      exp.dataset.action = "export";
      exp.textContent = "Exportar";
      exp.title = "Baixar este estudo em .json";
      actions.appendChild(exp);
      if (it.inLocal && !it.current) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn-outline";
        del.dataset.action = "remove";
        del.textContent = "Remover";
        del.title = it.inFolder
          ? "Remove a cópia do navegador (o arquivo na pasta é mantido)"
          : "Exclui o estudo deste navegador";
        actions.appendChild(del);
      }

      li.append(btn, actions);
      els.studyList.appendChild(li);
    });
  }

  function onStudyListClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const li = btn.closest(".study-row");
    const id = li.dataset.id;
    const fileName = li.dataset.fileName;
    if (btn.dataset.action === "open") h.onOpenStudy(id, fileName);
    if (btn.dataset.action === "export") h.onExportStudy(id, fileName);
    if (btn.dataset.action === "remove") h.onRemoveStudy(id);
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  root.LeanUI = {
    init,
    renderStudy,
    renderRows,
    updateComputed,
    setStatus,
    setFolderButton,
    showConflict,
    hideConflict,
    toast,
    openDialog,
    closeDialog,
    focusCell,
    formatDateTime,
  };
})(typeof self !== "undefined" ? self : this);
