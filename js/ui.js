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
    type: "__qty__",
    quantity: "videoTime",
    frequency: "videoTime",
    videoTime: "pace",
    pace: "__next_row__",
    value: "waste",
    waste: "kaizen",
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
      totalFilms: $("total-films"),
      settings: Array.from(document.querySelectorAll("[data-setting]")),
      thQty: $("th-qty"),
      thNormal: $("th-normal"),
      thSumQty: $("th-sum-qty"),
      summaryTbody: $("summary-tbody"),
      summaryTotal: $("summary-total"),
      summaryNote: $("summary-note"),
      summaryHint: $("summary-hint"),
      filmsPanel: $("films-panel"),
      filmsList: $("films-list"),
      filmsHint: $("films-hint"),
      names: $("element-names"),
      chartValueCount: $("chart-value-count"),
      chartValueTime: $("chart-value-time"),
      chartWaste: $("chart-waste"),
      notes: $("study-notes"),
      btnExportXlsx: $("btn-export-xlsx"),
      templateInfo: $("template-info"),
      templateInput: $("input-template"),
      btnRemoveTemplate: $("btn-remove-template"),
      btnExportSimple: $("btn-export-simple"),
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

    // Peças produzidas por filmagem
    els.filmsList.addEventListener("input", (e) => {
      const key = e.target.dataset && e.target.dataset.filmKey;
      if (key) h.onFilmPiecesChange(key, e.target.value);
    });

    // Parâmetros da jornada
    els.params.forEach((input) => {
      input.addEventListener("input", () => {
        const ok = h.onParamChange(input.dataset.param, input.value);
        input.classList.toggle("input-invalid", !ok);
      });
    });

    // Modo de lançamento e unidade de tempo
    els.settings.forEach((sel) => sel.addEventListener("change", () => h.onSettingChange(sel.dataset.setting, sel.value)));

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
    els.btnExportXlsx.addEventListener("click", () => h.onExportXlsx());
    els.btnExportSimple.addEventListener("click", () => h.onExportXlsxSimple());
    els.btnRemoveTemplate.addEventListener("click", () => h.onRemoveTemplate());
    els.templateInput.addEventListener("change", () => {
      const file = els.templateInput.files && els.templateInput.files[0];
      els.templateInput.value = "";
      if (file) h.onLoadTemplate(file);
    });
    els.notes.addEventListener("input", () => h.onMetaChange("notes", els.notes.value));

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
      else if (res.rowError) {
        toast(`Linha ${info.index + 1}: ${res.rowError}. Se for um novo vídeo, use Alt+N (ou toque no nº da linha).`, "error", 8000);
      }
    }
    if (info.field === "pace") commitPace(info, e.target, true);
    if (info.field === "description") commitDescription(info);
  }

  /** Elemento já classificado em outra linha: copia tipo, valor e desperdício. */
  function commitDescription(info) {
    const copied = h.onDescriptionCommit(info.id);
    if (!copied) return;
    ["type", "value", "waste"].forEach((f) => {
      const sel = info.tr.querySelector(`[data-field="${f}"]`);
      if (sel) sel.value = copied[f];
    });
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

    // Alt+N: marca/desmarca o início de uma nova filmagem nesta linha
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
      e.preventDefault();
      toggleNewVideo(info);
      return;
    }

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
        if (!res.ok) {
          toast(`Linha ${info.index + 1}: ${res.error}`, "error");
          e.target.select();
          return;
        }
        if (res.rowError) {
          if (!askNewVideo(info, res)) {
            e.target.select();
            return;
          }
          e.target.classList.remove("input-invalid");
        }
      }
      if (info.field === "description") commitDescription(info);
      if (info.field === "pace") {
        const res = commitPace(info, e.target, true);
        if (!res.ok) {
          e.target.select();
          return;
        }
      }
      const next = ENTER_FLOW[info.field];
      if (next === "__next_row__") goToNextRow(info.index);
      else if (next === "__qty__") focusQty(info.index);
      else focusCell(info.index, next);
      return;
    }

    // Setas ↑ ↓: mesma coluna, linha anterior/seguinte
    // (em listas de seleção as setas trocam a opção, então não mudam de linha)
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.ctrlKey && !e.shiftKey && e.target.tagName !== "SELECT") {
      const target = info.index + (e.key === "ArrowUp" ? -1 : 1);
      if (target >= 0 && target < els.tbody.rows.length) {
        e.preventDefault();
        focusCell(target, info.field);
      }
    }
  }

  function onGridClick(e) {
    const seq = e.target.closest(".btn-seq");
    if (seq) {
      const info = rowInfo(seq);
      if (info) toggleNewVideo(info);
      return;
    }
    const btn = e.target.closest(".btn-icon-del");
    if (!btn) return;
    const info = rowInfo(btn);
    if (info) deleteRow(info);
  }

  /**
   * Tempo menor que a leitura anterior: pergunta se a linha inicia uma nova filmagem.
   * Enter confirma (OK) e Esc cancela, sem precisar do mouse. Retorna true se resolvido.
   */
  function askNewVideo(info, res) {
    if (info.index === 0) {
      toast(`Linha 1: ${res.rowError}. Ajuste a leitura inicial ou o tempo final.`, "error");
      return false;
    }
    const ok = root.confirm(
      `Linha ${info.index + 1}: o tempo ${res.formatted} é menor que a leitura anterior.\n\n` +
        "Esta linha é o INÍCIO DE UMA NOVA FILMAGEM (vídeo começando em 00:00)?\n\n" +
        "OK (Enter) = sim, nova filmagem\nCancelar (Esc) = não, corrigir o tempo"
    );
    if (!ok) {
      toast(`Linha ${info.index + 1}: ${res.rowError}`, "error");
      return false;
    }
    const r = h.onSetNewVideo(info.id, true);
    if (!r.ok) {
      toast(r.error, "error");
      return false;
    }
    toast(`Linha ${info.index + 1}: início da filmagem ${r.film} (leitura reiniciada em 00:00).`, "ok");
    return true;
  }

  function toggleNewVideo(info) {
    const r = h.onSetNewVideo(info.id);
    if (!r.ok) {
      toast(r.error, "warn");
      return;
    }
    toast(
      r.newVideo
        ? `Linha ${info.index + 1}: início da filmagem ${r.film} (leitura reiniciada em 00:00).`
        : `Linha ${info.index + 1}: marcação de nova filmagem removida.`,
      "ok"
    );
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

  function focusQty(index) {
    const tr = els.tbody.rows[index];
    const input = tr && tr.querySelector(".input-qty");
    if (input) {
      input.focus();
      input.select();
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
    els.settings.forEach((sel) => (sel.value = Calc[sel.dataset.setting](study)));
    els.notes.value = study.notes || "";
    renderRows(study, computed);
    document.title = `${study.processName || "Estudo"} — ${study.clientName || "Lean Chrono"} | Cronoanálise & MFV`;
  }

  /** Recria as linhas da grade (usado ao abrir estudo, incluir ou excluir linha). */
  function renderRows(study, computed) {
    const frag = document.createDocumentFragment();
    const qtyMode = Calc.entryMode(study) === "quantidade";
    // A mesma coluna recebe Quantidade (padrão planilha) ou Frequência (1/50), conforme o modo.
    els.thQty.textContent = qtyMode ? "Qtd." : "Freq.";
    els.thQty.title = qtyMode
      ? "Quantidade de unidades produzidas no trecho (tempo/un = tempo ÷ qtd)"
      : "1 = uma vez por peça | 1/50 = uma vez a cada 50 peças";
    els.thNormal.title = qtyMode ? "Tempo subtraído × (Ritmo/100)" : "Tempo subtraído × (Ritmo/100) × Frequência";
    els.thSumQty.textContent = qtyMode ? "Qtd. total" : "—";
    els.summaryHint.textContent = qtyMode
      ? "Padrão planilha B+P: Tipo C = Σtempo ÷ Σquantidade (média por unidade) • Tipo A = Σtempo, ou Σtempo ÷ Σpeças com as peças das filmagens"
      : "Modo frequência: média das ocorrências (a frequência já rateia o acíclico)";
    study.elements.forEach((el) => {
      const tr = els.rowTemplate.content.firstElementChild.cloneNode(true);
      tr.dataset.id = el.id;
      const qtyInput = tr.querySelector(".input-qty");
      qtyInput.dataset.field = qtyMode ? "quantity" : "frequency";
      qtyInput.setAttribute("aria-label", qtyMode ? "Quantidade" : "Frequência");
      qtyInput.inputMode = qtyMode ? "decimal" : "text";
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
    const unit = computed.unit;
    const ft = (minutes) => Calc.formatTime(minutes, unit);
    document.querySelectorAll(".unit-label").forEach((n) => (n.textContent = Calc.TIME_UNITS[unit].label));

    const rows = els.tbody.rows;
    computed.rows.forEach((row, i) => {
      const tr = rows[i];
      if (!tr) return;
      tr.querySelector(".seq-num").textContent = String(row.seq).padStart(2, "0");
      const filmTag = tr.querySelector(".film-tag");
      const showFilm = row.newVideo || (i === 0 && computed.filmCount > 1);
      filmTag.hidden = !showFilm;
      filmTag.textContent = showFilm ? `F${row.film}` : "";
      tr.classList.toggle("row-new-video", row.newVideo);
      tr.querySelector(".btn-seq").title = row.newVideo
        ? `Início da filmagem ${row.film}. Clique (ou Alt+N) para desmarcar.`
        : "Marcar o início de uma nova filmagem (Alt+N)";
      tr.querySelector(".input-type").classList.toggle("is-acyclic", row.type === "A");
      tr.querySelector('[data-out="tsub"]').textContent = ft(row.subtractedTime);
      const tnorm = tr.querySelector('[data-out="tnorm"]');
      tnorm.textContent = ft(row.normalTime);
      tnorm.title = computed.mode === "quantidade" && row.hasReading ? `Tempo por unidade: ${ft(row.unitTime)} ${Calc.TIME_UNITS[unit].label}` : "";
      tr.classList.toggle("row-error", !row.valid);
      tr.title = row.errors.join(" • ");

      const timeInput = tr.querySelector('[data-field="videoTime"]');
      if (document.activeElement !== timeInput) {
        timeInput.classList.toggle("input-invalid", row.errors.some((m) => !/Frequência|Quantidade|ritmo/i.test(m)));
      }
      tr.querySelector(".input-qty").classList.toggle("input-invalid", row.errors.some((m) => /Frequência|Quantidade/.test(m)));
    });

    els.totalTsub.textContent = ft(computed.totals.sumSubtracted);
    els.totalTnorm.textContent = ft(computed.totals.sumNormal);
    els.totalFilms.textContent = computed.filmCount > 1 ? ` · ${computed.filmCount} filmagens` : "";
    els.totalErrors.textContent = computed.errorCount
      ? `⚠ ${computed.errorCount} linha(s) com erro fora dos totais`
      : "";

    renderFilms(computed);
    renderSummary(computed);
    renderCompilation(computed);
    renderKpis(computed);
  }

  /* Cores semânticas do valor agregado (sempre acompanhadas do rótulo) e tom único para desperdícios. */
  const VALUE_COLORS = { AG: "#16a34a", NA: "#dc2626", IN: "#d97706", "": "#94a3b8" };
  const WASTE_COLOR = "#2563eb";

  /** Barras horizontais com rótulo e valor (substituem as pizzas da planilha). */
  function renderBars(container, items, opts) {
    if (!items.length) {
      const p = document.createElement("p");
      p.className = "chart-empty";
      p.textContent = opts.empty;
      container.replaceChildren(p);
      return;
    }
    const max = Math.max(...items.map(opts.value));
    container.replaceChildren(
      ...items.map((it) => {
        const row = document.createElement("div");
        row.className = "bar-row";
        row.title = opts.tooltip(it);
        const label = document.createElement("span");
        label.className = "bar-label";
        label.textContent = it.label;
        const track = document.createElement("span");
        track.className = "bar-track";
        const fill = document.createElement("span");
        fill.className = "bar-fill";
        fill.style.width = `${max > 0 ? Math.max(1.5, (opts.value(it) / max) * 100) : 0}%`;
        fill.style.background = opts.color(it);
        track.appendChild(fill);
        const value = document.createElement("span");
        value.className = "bar-value";
        value.textContent = opts.text(it);
        row.append(label, track, value);
        return row;
      })
    );
  }

  /** Compilação: por atividade, por tempo e por desperdício. */
  function renderCompilation(computed) {
    const c = computed.compilation;
    const unit = computed.unit;
    const u = Calc.TIME_UNITS[unit].label;
    const ft = (m) => Calc.formatTime(m, unit);
    const empty = "Lance os tempos e classifique o valor dos elementos para ver a compilação.";
    const values = c.elementCount ? c.byValue : [];
    renderBars(els.chartValueCount, values, {
      value: (v) => v.count,
      color: (v) => VALUE_COLORS[v.key],
      text: (v) => `${v.count}`,
      tooltip: (v) => `${v.label}: ${v.count} elemento(s) de ${c.elementCount}`,
      empty,
    });
    renderBars(els.chartValueTime, values, {
      value: (v) => v.time,
      color: (v) => VALUE_COLORS[v.key],
      text: (v) => `${ft(v.time)} ${u} • ${fmt(v.pct, 1)}%`,
      tooltip: (v) => `${v.label}: ${ft(v.time)} ${u} (${fmt(v.pct, 1)}% do ciclo)`,
      empty,
    });
    renderBars(els.chartWaste, c.byWaste, {
      value: (w) => w.time,
      color: () => WASTE_COLOR,
      text: (w) => `${ft(w.time)} ${u} • ${fmt(w.pct, 1)}%`,
      tooltip: (w) => `${w.label}: ${w.count} elemento(s), ${ft(w.time)} ${u} (${fmt(w.pct, 1)}% do ciclo)`,
      empty: "Nenhum desperdício classificado. Use a coluna Desperdício da grade.",
    });
  }

  /**
   * Peças produzidas por filmagem (modo quantidade). Os campos só são recriados quando as
   * filmagens mudam, para não perder o foco durante a digitação.
   */
  function renderFilms(computed) {
    const info = computed.films;
    const show = computed.mode === "quantidade";
    els.filmsPanel.hidden = !show;
    if (!show) return;
    const unit = computed.unit;
    const u = Calc.TIME_UNITS[unit].label;
    const ft = (minutes) => Calc.formatTime(minutes, unit);
    const sig = info.list.map((f) => f.key).join("|");
    if (els.filmsList.dataset.sig !== sig) {
      els.filmsList.dataset.sig = sig;
      els.filmsList.replaceChildren(
        ...info.list.map((f) => {
          const box = document.createElement("label");
          box.className = "film-box";
          const tag = document.createElement("span");
          tag.className = "film-tag";
          tag.textContent = `F${f.film}`;
          const input = document.createElement("input");
          input.type = "text";
          input.className = "input-cell mono film-pieces";
          input.inputMode = "decimal";
          input.autocomplete = "off";
          input.placeholder = "peças";
          input.value = f.raw;
          input.dataset.filmKey = f.key;
          input.setAttribute("aria-label", `Peças produzidas na filmagem ${f.film}`);
          const out = document.createElement("span");
          out.className = "film-out";
          box.append(tag, input, out);
          return box;
        })
      );
    }
    els.filmsList.querySelectorAll(".film-box").forEach((box, i) => {
      const f = info.list[i];
      const input = box.querySelector("input");
      if (document.activeElement !== input && input.value !== f.raw) input.value = f.raw;
      input.classList.toggle("input-invalid", !!f.error);
      input.title = f.error || `Linha ${f.startSeq} em diante`;
      box.querySelector(".film-out").textContent =
        `obs. ${ft(f.observed)} ${u}` + (f.observedPerPiece != null ? ` • ${ft(f.observedPerPiece)} ${u}/un` : "");
    });
    const hint = {
      total: "Opcional. Informe as peças de todas as filmagens para converter os acíclicos (tipo A) em tempo por unidade.",
      incompleto: `⚠ Faltam peças em ${info.list.length - info.filled} filmagem(ns): os acíclicos continuam como tempo total.`,
      "por-unidade": `Tipo A = Σtempo ÷ ${fmt(info.piecesTotal, info.piecesTotal % 1 ? 2 : 0)} peças. Ciclo real observado: ${ft(info.observedPerPiece)} ${u}/un (inclui tudo, no ritmo filmado).`,
    }[info.acyclic];
    els.filmsHint.textContent = hint;
    els.filmsHint.classList.toggle("has-conflict", info.acyclic === "incompleto");
  }

  /** Tabela "Resumo por elemento" (equivale à aba Listagem de Elementos). */
  function renderSummary(computed) {
    const unit = computed.unit;
    const ft = (minutes) => Calc.formatTime(minutes, unit);
    const qtyMode = computed.mode === "quantidade";
    const cell = (text, cls, title) => {
      const td = document.createElement("td");
      if (cls) td.className = cls;
      td.textContent = text;
      if (title) td.title = title;
      return td;
    };
    const frag = document.createDocumentFragment();
    computed.summary.elements.forEach((g) => {
      const tr = document.createElement("tr");
      if (g.conflicts.length) tr.classList.add("row-conflict");
      const conflictMsg = g.conflicts.length
        ? `Linhas com ${g.conflicts.join(" e ")} diferentes para o mesmo elemento. Prevalece a 1ª ocorrência (linha ${g.firstSeq}).`
        : "";
      const tag = document.createElement("span");
      tag.className = "tag-type" + (g.type === "A" ? " is-acyclic" : "");
      tag.textContent = g.type;
      if (g.perUnit) tag.title = "Acíclico convertido em tempo por unidade (Σtempo ÷ Σpeças das filmagens)";
      const typeTd = cell("", "cell-type");
      typeTd.appendChild(tag);
      tr.append(
        cell(String(g.seq).padStart(2, "0"), "cell-num"),
        cell((g.conflicts.length ? "⚠ " : "") + g.name, "cell-text", conflictMsg),
        typeTd,
        cell(String(g.occurrences), "cell-readonly mono"),
        cell(qtyMode ? fmt(g.sumQuantity, g.sumQuantity % 1 ? 2 : 0) : "—", "cell-readonly mono"),
        cell(ft(g.sumNormal), "cell-readonly mono"),
        cell(ft(g.cycleTime), "cell-readonly mono highlight-col", g.type === "A" ? (g.perUnit ? "Σtempo ÷ Σpeças das filmagens" : "Σtempo (tempo total observado)") : ""),
        cell(fmt(g.sharePct, 1) + "%", "cell-readonly mono"),
        cell(g.value ? Calc.VALUES[g.value].label : "—", "cell-text value-" + (g.value || "none")),
        cell(g.waste ? Calc.WASTES[g.waste] : "—", "cell-text"),
        cell(g.action, "cell-text" + (g.value ? "" : " text-muted"))
      );
      frag.appendChild(tr);
    });
    if (!computed.summary.elements.length) {
      const tr = document.createElement("tr");
      const td = cell("Os elementos aparecem aqui conforme os tempos são lançados na grade.", "cell-text text-muted");
      td.colSpan = 11;
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    els.summaryTbody.replaceChildren(frag);
    els.summaryTotal.textContent = ft(computed.summary.cycleNormal);
    const notes = [];
    if (computed.summary.conflictCount) notes.push(`⚠ ${computed.summary.conflictCount} elemento(s) com classificação divergente`);
    notes.push(`${computed.summary.elements.length} elemento(s) • observado: ${ft(computed.totals.sumSubtracted)} ${Calc.TIME_UNITS[unit].label}`);
    els.summaryNote.textContent = notes.join(" • ");
    els.summaryNote.classList.toggle("has-conflict", computed.summary.conflictCount > 0);

    // Autocompletar com os nomes já usados (mesmo nome = mesmo elemento no resumo)
    const names = computed.summary.elements.filter((g) => !g.key.startsWith("#")).map((g) => g.name);
    const sig = names.join("\n");
    if (els.names.dataset.sig !== sig) {
      els.names.dataset.sig = sig;
      els.names.replaceChildren(
        ...names.map((n) => {
          const o = document.createElement("option");
          o.value = n;
          return o;
        })
      );
    }
  }

  function renderKpis(computed) {
    const k = computed.kpis;
    els.kpiNet.textContent = fmt(k.netTime, 1);
    const unit = computed.unit;
    const u = Calc.TIME_UNITS[unit].label;
    const kd = { s: 1, min: 2, h: 4 }[unit];
    els.kpiTakt.textContent = Calc.formatTime(k.taktTime, unit, kd);
    const alt = unit === "s" ? "min" : "s";
    els.kpiTaktSec.textContent =
      k.taktTime != null ? `Equivale a ${Calc.formatTime(k.taktTime, alt)} ${alt}/pç` : "Informe jornada e demanda";
    els.kpiCycle.textContent = k.standardTime != null && k.standardTime > 0 ? Calc.formatTime(k.standardTime, unit, kd) : "--";
    els.kpiNormal.textContent = `Tempo normal do ciclo: ${Calc.formatTime(k.sumNormal, unit)} ${u}`;
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

  /** meta = { name, size, savedAt, macro } | null */
  function setTemplateInfo(meta) {
    if (meta) {
      els.templateInfo.textContent =
        `✅ ${meta.name} (${Math.round(meta.size / 1024)} KB${meta.macro ? ", com macros" : ""}) — carregado em ${formatDateTime(meta.savedAt)}. ` +
        "Exportar Excel preenche este modelo (fórmulas, gráficos e macros preservados).";
      els.btnExportXlsx.textContent = "Exportar Excel (modelo B+P)";
    } else {
      els.templateInfo.textContent = 'Nenhum modelo carregado: o botão "Exportar Excel" gera o Excel simples.';
      els.btnExportXlsx.textContent = "Exportar Excel (simples)";
    }
    els.btnRemoveTemplate.hidden = !meta;
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
    setTemplateInfo,
    openDialog,
    closeDialog,
    focusCell,
    formatDateTime,
  };
})(typeof self !== "undefined" ? self : this);
