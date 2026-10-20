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
  let lastComputed = null;

  /** Filtros da grade e do resumo: só exibição (não são gravados e não alteram cálculos). */
  const filter = { text: "", product: "", type: "", value: "", waste: "", film: "", errors: false };
  const filterActive = () => !!(filter.text || filter.product || filter.type || filter.value || filter.waste || filter.film || filter.errors);

  /** Ordem do fluxo rápido com Enter. Frequência e Kaizen ficam fora (acesso por Tab). */
  const ENTER_FLOW = {
    product: "description",
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
      btnToMfv: $("btn-to-mfv"),
      mixPanel: $("mix-panel"),
      mixTbody: $("mix-tbody"),
      mixHint: $("mix-hint"),
      mixDemand: $("mix-demand"),
      mixWeighted: $("mix-weighted"),
      mixLoad: $("mix-load"),
      mixOccupancy: $("mix-occupancy"),
      multiProduct: $("opt-multi-product"),
      thProduct: $("th-product"),
      colProduct: $("col-product"),
      colElem: $("col-elem"),
      tfootLabel: $("tfoot-label"),
      productNames: $("product-names"),
      summaryProductField: $("summary-product-field"),
      summaryProduct: $("summary-product"),
      filterBar: $("filter-bar"),
      fltText: $("flt-text"),
      fltProduct: $("flt-product"),
      fltType: $("flt-type"),
      fltValue: $("flt-value"),
      fltWaste: $("flt-waste"),
      fltFilm: $("flt-film"),
      fltErrors: $("flt-errors"),
      fltStatus: $("flt-status"),
      btnClearFilter: $("btn-clear-filter"),
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

    // Filmagens do estudo: peças (a cada tecla) e início (ao confirmar)
    els.filmsList.addEventListener("input", (e) => {
      const key = e.target.dataset && e.target.dataset.filmKey;
      if (key) h.onFilmPiecesChange(key, e.target.value);
    });
    const commitStart = (input) => {
      const res = h.onFilmStartCommit(input.dataset.filmStart, input.value);
      input.classList.toggle("input-invalid", !res.ok);
      if (res.ok) input.value = res.formatted;
      else toast(`Início da filmagem: ${res.error}`, "error");
      return res.ok;
    };
    els.filmsList.addEventListener("change", (e) => {
      if (e.target.dataset && e.target.dataset.filmStart) commitStart(e.target);
    });
    els.filmsList.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset && e.target.dataset.filmStart) {
        e.preventDefault();
        commitStart(e.target);
      }
    });

    // Vários produtos (coluna Produto) e produto exibido no resumo/indicadores
    els.multiProduct.addEventListener("change", () => {
      const ok = h.onMultiProductToggle(els.multiProduct.checked);
      if (!ok) els.multiProduct.checked = !els.multiProduct.checked;
    });
    els.summaryProduct.addEventListener("change", () => h.onProductSelect(els.summaryProduct.value));

    // Carga do posto: demanda de cada produto
    els.mixTbody.addEventListener("input", (e) => {
      const key = e.target.dataset && e.target.dataset.mixDemand;
      if (key != null) {
        const ok = h.onProductDemandChange(key, e.target.value);
        e.target.classList.toggle("input-invalid", !ok);
      }
    });

    // Cronoanálise → MFV
    els.btnToMfv.addEventListener("click", () => h.onGoToMfv());

    // Filtros
    const onFilter = () => {
      filter.text = els.fltText.value.trim();
      filter.product = els.fltProduct.value;
      filter.type = els.fltType.value;
      filter.value = els.fltValue.value;
      filter.waste = els.fltWaste.value;
      filter.film = els.fltFilm.value;
      filter.errors = els.fltErrors.checked;
      applyFilters(true);
    };
    els.fltText.addEventListener("input", onFilter);
    [els.fltProduct, els.fltType, els.fltValue, els.fltWaste, els.fltFilm, els.fltErrors].forEach((c) => c.addEventListener("change", onFilter));
    els.btnClearFilter.addEventListener("click", () => {
      clearFilters();
      els.fltText.focus();
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
    // Produto: guarda o valor ao entrar no campo (para saber se foi preenchido ou trocado)
    // e seleciona o texto: digitar substitui o produto (inclusive o que acabou de ser preenchido)
    els.tbody.addEventListener("focusin", (e) => {
      if (e.target.dataset && e.target.dataset.field === "product") {
        e.target.dataset.before = e.target.value;
        e.target.select();
      }
    });
    els.tbody.addEventListener("keydown", onGridKeyDown);
    els.tbody.addEventListener("click", onGridClick);

    // Atalhos globais
    document.addEventListener("keydown", onGlobalKeyDown);

    // Diálogo de estudos
    els.btnCloseDialog.addEventListener("click", () => closeDialog());
    // Sem estudo aberto a janela também fecha: fica a tela vazia, com o menu dos módulos
    const emptyOpen = document.getElementById("btn-empty-open");
    if (emptyOpen) emptyOpen.addEventListener("click", () => h.onOpenStudies());
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
    if (info.field === "product") commitProduct(info, e.target);
  }

  /** Preencher para baixo: aplica o produto às linhas vazias abaixo (ou troca o bloco). */
  function commitProduct(info, input) {
    const before = input.dataset.before == null ? input.value : input.dataset.before;
    input.dataset.before = input.value; // Enter + saída do campo não repetem a ação
    const plan = h.onProductCommit(info.id, before, filterActive());
    if (!plan) return;
    plan.ids.forEach((rid) => {
      const other = els.tbody.querySelector(`tr[data-id="${rid}"] [data-field="product"]`);
      if (other) {
        other.value = plan.value;
        other.dataset.before = plan.value;
      }
    });
    toast(`${plan.value ? `"${plan.value}" aplicado` : "Produto removido"} nas linhas ${plan.from} a ${plan.to}.`, "ok");
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
      if (info.field === "product") commitProduct(info, e.target);
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
      const target = visibleRow(info.index, e.key === "ArrowUp" ? -1 : 1);
      if (target >= 0) {
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
    if (res.newVideo) {
      toast(`Linha ${info.index + 1}: ${res.rowError}. Ajuste o início da filmagem F${res.film} (bloco "Filmagens do estudo") ou o tempo final.`, "error", 8000);
      return false;
    }
    const ok = root.confirm(
      `Linha ${info.index + 1}: o tempo ${res.formatted} é menor que a leitura anterior.\n\n` +
        "Esta linha é o INÍCIO DE UMA NOVA FILMAGEM (outro vídeo)?\n\n" +
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
    toast(`Linha ${info.index + 1}: início da filmagem ${r.film} (leitura reiniciada em 00:00; ajuste o início em "Filmagens do estudo", se preciso).`, "ok", 6000);
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
    let target = Math.min(info.index, total - 1);
    if (els.tbody.rows[target] && els.tbody.rows[target].hidden) {
      const down = visibleRow(target, 1);
      target = down >= 0 ? down : visibleRow(target, -1);
    }
    if (target >= 0) focusCell(target, info.field || "description");
  }

  /** Próxima linha visível (os filtros escondem linhas). -1 se não houver. */
  function visibleRow(index, step) {
    for (let i = index + step; i >= 0 && i < els.tbody.rows.length; i += step) {
      if (!els.tbody.rows[i].hidden) return i;
    }
    return -1;
  }

  function goToNextRow(index) {
    const next = visibleRow(index, 1);
    if (next >= 0) focusCell(next, "description");
    else addRowAndFocus();
  }

  function addRowAndFocus() {
    // Com filtro, a linha nova entraria fora da sequência do vídeo sem o consultor ver.
    if (filterActive()) {
      toast("Filtro ativo: limpe o filtro para incluir linhas (a leitura contínua depende da sequência completa).", "warn", 6000);
      return;
    }
    const index = h.onAddRow();
    focusCell(index, "description");
  }

  function onGlobalKeyDown(e) {
    // Ctrl+Enter: nova linha (de qualquer lugar fora do diálogo)
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !els.dialog.open && h.hasOpenStudy()) {
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
    clearFilters(true);
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
    // Coluna Produto: aparece com "Vários produtos" marcado ou quando alguma linha tem produto
    const showProduct = !!(study.settings && study.settings.multiProduct) || study.elements.some((e) => String(e.product || "").trim());
    els.multiProduct.checked = showProduct;
    els.thProduct.hidden = !showProduct;
    if (showProduct && !els.colProduct.isConnected) els.colElem.before(els.colProduct);
    if (!showProduct && els.colProduct.isConnected) els.colProduct.remove();
    els.tfootLabel.colSpan = showProduct ? 6 : 5;
    study.elements.forEach((el) => {
      const tr = els.rowTemplate.content.firstElementChild.cloneNode(true);
      tr.dataset.id = el.id;
      if (!showProduct) tr.querySelector(".cell-product").remove();
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

    lastComputed = computed;
    renderProducts(computed);
    renderFilms(computed);
    renderSummary(computed);
    renderMix(computed);
    renderCompilation(computed);
    renderKpis(computed);
    applyFilters(false);
  }

  /** Quadro "Carga do posto (mix)": só com vários produtos. Campos recriados só se os produtos mudam. */
  function renderMix(computed) {
    const mix = computed.mix;
    els.mixPanel.hidden = !mix;
    if (!mix) return;
    const unit = computed.unit;
    const ft = (m) => (m == null ? "--" : Calc.formatTime(m, unit));
    const sig = mix.items.map((i) => i.key).join("|");
    if (els.mixTbody.dataset.sig !== sig) {
      els.mixTbody.dataset.sig = sig;
      els.mixTbody.replaceChildren(
        ...mix.items.map((i) => {
          const tr = document.createElement("tr");
          tr.dataset.key = i.key;
          const input = document.createElement("input");
          input.type = "text";
          input.className = "input-cell mono mix-demand";
          input.inputMode = "decimal";
          input.autocomplete = "off";
          input.dataset.mixDemand = i.key;
          input.setAttribute("aria-label", `Demanda diária de ${i.name}`);
          const cells = ["cell-text", "", "cell-readonly mono", "cell-readonly mono", "cell-readonly mono"].map((c) => {
            const td = document.createElement("td");
            if (c) td.className = c;
            return td;
          });
          cells[0].textContent = i.name;
          cells[1].append(input);
          tr.append(...cells);
          return tr;
        })
      );
    }
    const general = lastComputed && lastComputed.products.find((p) => !p.demandOwn);
    Array.from(els.mixTbody.rows).forEach((tr, n) => {
      const i = mix.items[n];
      const p = computed.products[n];
      if (!i || !p) return;
      const input = tr.querySelector("input");
      if (document.activeElement !== input && input.value !== p.demandRaw) input.value = p.demandRaw;
      input.placeholder = p.demandOwn ? "" : general && general.demand != null ? `geral: ${fmt(general.demand, 0)}` : "informe";
      tr.cells[2].textContent = ft(i.tp);
      tr.cells[3].textContent = i.load == null ? "--" : fmt(i.load, 1);
      tr.cells[4].textContent = i.load == null || !(mix.netTime > 0) ? "--" : `${fmt((i.load / mix.netTime) * 100, 1)}%`;
      tr.title = i.load == null ? (i.tp == null ? "Produto sem tempo padrão" : "Informe a demanda") : "";
    });
    els.mixDemand.textContent = mix.demand == null ? "--" : fmt(mix.demand, mix.demand % 1 ? 2 : 0);
    els.mixWeighted.textContent = mix.weightedTP == null ? "--" : `${ft(mix.weightedTP)} (ponderado)`;
    els.mixLoad.textContent = mix.load == null ? "--" : fmt(mix.load, 1);
    els.mixOccupancy.textContent = mix.occupancyPct == null ? "--" : `${mix.status === "sobrecarga" ? "🔴" : mix.status === "atende" ? "🟢" : "⚠"} ${fmt(mix.occupancyPct, 1)}%`;
    els.mixOccupancy.classList.toggle("is-over", mix.status === "sobrecarga");
    els.mixOccupancy.classList.toggle("is-ok", mix.status === "atende");
    const u = Calc.TIME_UNITS[unit].label;
    const base = `Tempo líquido: ${fmt(mix.netTime, 1)} min/dia` + (mix.taktMix != null ? ` • Takt misto = ${ft(mix.taktMix)} ${u}/pç (tempo líquido ÷ Σ demandas)` : "");
    els.mixHint.textContent =
      mix.status === "incompleto"
        ? `${base} • ⚠ ${mix.missing} produto(s) sem demanda ou sem tempo padrão: ocupação parcial.`
        : `${base} • ${mix.status === "sobrecarga" ? "O posto NÃO atende o mix (ocupação acima de 100%)." : "O posto atende o mix."}`;
  }

  /** Lista de produtos: autocompletar, seletor do resumo e filtro. */
  function renderProducts(computed) {
    const names = computed.multiProduct ? computed.products.filter((p) => p.key).map((p) => p.name) : [];
    const sig = names.join("\n");
    if (els.productNames.dataset.sig !== sig) {
      els.productNames.dataset.sig = sig;
      els.productNames.replaceChildren(...names.map((n) => Object.assign(document.createElement("option"), { value: n })));
    }
    const multi = computed.multiProduct && computed.products.length > 1;
    els.summaryProductField.hidden = !multi;
    els.fltProduct.hidden = !computed.multiProduct;
    const options = (sel, list, first) => {
      const want = first.concat(list.map((p) => [p.key, p.name]));
      const cur = Array.from(sel.options).map((o) => [o.value, o.textContent]);
      if (JSON.stringify(cur) !== JSON.stringify(want)) {
        const keep = sel.value;
        sel.replaceChildren(...want.map(([v, t]) => Object.assign(document.createElement("option"), { value: v, textContent: t })));
        sel.value = want.some(([v]) => v === keep) ? keep : want[0] ? want[0][0] : "";
      }
    };
    options(els.summaryProduct, computed.products, []);
    if (multi) els.summaryProduct.value = computed.product.key;
    options(els.fltProduct, computed.multiProduct ? computed.products : [], [["", "Produto: todos"]]);
    filter.product = els.fltProduct.value;
    const films = [["", "Filmagem: todas"]].concat(computed.filmList.map((f) => [String(f.film), `F${f.film}`]));
    const curFilms = Array.from(els.fltFilm.options).map((o) => [o.value, o.textContent]);
    if (JSON.stringify(curFilms) !== JSON.stringify(films)) {
      const keep = els.fltFilm.value;
      els.fltFilm.replaceChildren(...films.map(([v, t]) => Object.assign(document.createElement("option"), { value: v, textContent: t })));
      els.fltFilm.value = films.some(([v]) => v === keep) ? keep : "";
    }
    filter.film = els.fltFilm.value;
    els.fltFilm.hidden = computed.filmList.length < 2 && !filter.film;
  }

  /* ==========================================================================
     FILTROS (SÓ EXIBIÇÃO)
     ========================================================================== */

  function clearFilters(silent) {
    Object.assign(filter, { text: "", product: "", type: "", value: "", waste: "", film: "", errors: false });
    els.fltText.value = "";
    [els.fltProduct, els.fltType, els.fltValue, els.fltWaste, els.fltFilm].forEach((c) => (c.value = ""));
    els.fltErrors.checked = false;
    if (!silent) applyFilters(true);
  }

  const matchText = (name) => !filter.text || Calc.elementKey(name).includes(Calc.elementKey(filter.text));
  const matchValue = (v) => !filter.value || (filter.value === "none" ? !v : v === filter.value);
  const matchWaste = (w) => !filter.waste || (filter.waste === "none" ? !w : w === filter.waste);

  /**
   * Esconde as linhas da grade e do resumo que não atendem aos filtros.
   * force=false (recálculo durante a digitação): a linha em edição nunca some.
   */
  function applyFilters(force) {
    const computed = lastComputed;
    if (!computed) return;
    const active = filterActive();
    const focusRow = document.activeElement && document.activeElement.closest ? document.activeElement.closest("#chrono-tbody tr") : null;
    let shown = 0;
    Array.from(els.tbody.rows).forEach((tr, i) => {
      const row = computed.rows[i];
      const el = h.getElement(tr.dataset.id);
      if (!row || !el) return;
      const ok =
        !active ||
        (matchText(el.description) &&
          (!filter.product || row.productKey === filter.product) &&
          (!filter.type || row.type === filter.type) &&
          matchValue(el.value) &&
          matchWaste(el.waste) &&
          (!filter.film || String(row.film) === filter.film) &&
          (!filter.errors || !row.valid));
      const hide = !ok && (force || tr !== focusRow);
      tr.hidden = hide;
      if (!hide) shown += 1;
    });
    // Resumo: nome, tipo, valor e desperdício (o produto é o do seletor do resumo)
    let sumShown = 0;
    let timeShown = 0;
    Array.from(els.summaryTbody.rows).forEach((tr, i) => {
      const g = computed.summary.elements[i];
      if (!g) return;
      const ok = !active || (matchText(g.name) && (!filter.type || g.type === filter.type) && matchValue(g.value) && matchWaste(g.waste));
      tr.classList.toggle("row-filtered-out", !ok);
      if (ok) {
        sumShown += 1;
        timeShown += g.cycleTime;
      }
    });
    const total = els.tbody.rows.length;
    els.filterBar.classList.toggle("is-filtering", active);
    els.btnClearFilter.hidden = !active;
    els.btnAddRow.disabled = active;
    els.btnAddRow.title = active ? "Limpe o filtro para incluir linhas" : "Nova linha (Ctrl+Enter)";
    [els.fltText, els.fltProduct, els.fltType, els.fltValue, els.fltWaste, els.fltFilm].forEach((c) => c.classList.toggle("is-active", !!c.value));
    if (active) {
      const ft = (m) => Calc.formatTime(m, computed.unit);
      const cyc = computed.summary.cycleNormal;
      els.fltStatus.textContent =
        `Filtro ativo: ${shown} de ${total} linha(s) • resumo: ${sumShown} elemento(s), ${ft(timeShown)} ${Calc.TIME_UNITS[computed.unit].label}` +
        (cyc > 0 ? ` (${fmt((timeShown / cyc) * 100, 1)}% do ciclo)` : "");
    } else {
      els.fltStatus.textContent = "";
    }
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
   * Filmagens do estudo: início da análise em cada vídeo (todas as filmagens) e peças
   * produzidas (modo quantidade; por produto quando a filmagem tem mais de um).
   * Os campos só são recriados quando as filmagens mudam, para não perder o foco.
   */
  function renderFilms(computed) {
    const qty = computed.mode === "quantidade";
    const unit = computed.unit;
    const u = Calc.TIME_UNITS[unit].label;
    const ft = (minutes) => Calc.formatTime(minutes, unit);
    // Peças de cada segmento (filmagem × produto), vindas do produto correspondente
    const seg = new Map();
    computed.products.forEach((p) => p.films.list.forEach((x) => seg.set(x.key, x)));
    const sig = [qty ? "q" : "f"].concat(computed.filmList.map((f) => `${f.key}:${f.segments.map((sg) => sg.key).join(",")}`)).join("|");
    if (els.filmsList.dataset.sig !== sig) {
      els.filmsList.dataset.sig = sig;
      els.filmsList.replaceChildren(
        ...computed.filmList.map((f) => {
          const box = document.createElement("div");
          box.className = "film-box";
          box.dataset.film = f.film;
          const tag = document.createElement("span");
          tag.className = "film-tag";
          tag.textContent = `F${f.film}`;
          const lbl = document.createElement("span");
          lbl.className = "film-label";
          lbl.textContent = "Início";
          const start = document.createElement("input");
          start.type = "text";
          start.className = "input-cell mono film-start";
          start.inputMode = "numeric";
          start.autocomplete = "off";
          start.placeholder = "00:00";
          start.dataset.filmStart = f.key;
          start.setAttribute("aria-label", `Início da análise na filmagem ${f.film}`);
          box.append(tag, lbl, start);
          if (qty) {
            f.segments.forEach((sg) => {
              const wrap = document.createElement("span");
              wrap.className = "film-seg";
              const pl = document.createElement("span");
              pl.className = "film-label";
              pl.textContent = f.segments.length > 1 || computed.multiProduct ? `Peças ${sg.productName || ""}`.trim() : "Peças";
              const input = document.createElement("input");
              input.type = "text";
              input.className = "input-cell mono film-pieces";
              input.inputMode = "decimal";
              input.autocomplete = "off";
              input.placeholder = "peças";
              input.dataset.filmKey = sg.key;
              input.setAttribute("aria-label", `Peças produzidas na filmagem ${f.film}${sg.productName ? ` (${sg.productName})` : ""}`);
              wrap.append(pl, input);
              box.append(wrap);
            });
          }
          const out = document.createElement("span");
          out.className = "film-out";
          box.append(out);
          return box;
        })
      );
    }
    els.filmsList.querySelectorAll(".film-box").forEach((box, i) => {
      const f = computed.filmList[i];
      if (!f) return;
      const start = box.querySelector(".film-start");
      if (document.activeElement !== start) {
        const v = f.startRaw;
        if (start.value !== v) start.value = v;
        start.classList.toggle("input-invalid", !!f.startError);
      }
      start.title = f.startError || `Instante do vídeo em que a análise começa (linha ${f.startSeq}). Vazio = 00:00`;
      const perPiece = [];
      box.querySelectorAll(".film-pieces").forEach((input) => {
        const x = seg.get(input.dataset.filmKey);
        if (!x) return;
        if (document.activeElement !== input && input.value !== x.raw) input.value = x.raw;
        input.classList.toggle("input-invalid", !!x.error);
        input.title = x.error || "Peças produzidas neste trecho";
        if (x.observedPerPiece != null) perPiece.push(`${ft(x.observedPerPiece)} ${u}/un`);
      });
      box.querySelector(".film-out").textContent = `obs. ${ft(f.observed)} ${u}` + (perPiece.length ? ` • ${perPiece.join(" • ")}` : "");
    });
    // A Leitura inicial da barra é o início da F1 (os dois campos ficam sincronizados)
    if (document.activeElement !== els.videoStart && computed.filmList[0] && els.videoStart.value !== computed.filmList[0].startRaw) {
      els.videoStart.value = computed.filmList[0].startRaw;
    }
    const info = computed.films;
    const name = computed.multiProduct ? ` (${computed.product.name})` : "";
    let hint = "Início vazio = 00:00 (a 1ª filmagem usa a Leitura inicial).";
    if (qty) {
      hint += {
        total: " Informe as peças de todas as filmagens para converter os acíclicos (tipo A) em tempo por unidade.",
        incompleto: ` ⚠ Faltam peças em ${info.list.length - info.filled} trecho(s)${name}: os acíclicos continuam como tempo total.`,
        "por-unidade": ` Tipo A${name} = Σtempo ÷ ${fmt(info.piecesTotal, info.piecesTotal % 1 ? 2 : 0)} peças. Ciclo real observado: ${ft(info.observedPerPiece)} ${u}/un (inclui tudo, no ritmo filmado).`,
      }[info.acyclic];
    }
    els.filmsHint.textContent = hint;
    els.filmsHint.classList.toggle("has-conflict", qty && info.acyclic === "incompleto");
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
    els.kpiNormal.textContent =
      (computed.multiProduct ? `${computed.product.name} • ` : "") + `Tempo normal do ciclo: ${Calc.formatTime(k.sumNormal, unit)} ${u}`;
    els.kpiCapacity.textContent = k.capacity != null ? fmt(k.capacity, 0) : "--";

    els.kpiCard.classList.remove("is-bottleneck", "is-balanced", "is-invalid");
    const errNote = computed.errorCount ? ` • ⚠ ${computed.errorCount} linha(s) com erro` : "";
    // Vários produtos: o gargalo do posto é avaliado pela carga do mix (o tempo é dividido)
    const mix = computed.mix;
    if (mix && mix.status !== "incompleto") {
      const over = mix.status === "sobrecarga";
      els.kpiCard.classList.add(over ? "is-bottleneck" : "is-balanced");
      els.kpiStatus.textContent = over ? "SOBRECARGA" : "ATENDE O MIX";
      els.kpiDetail.textContent = `Ocupação do posto: ${fmt(mix.occupancyPct, 1)}% (${computed.products.length} produtos)` + errNote;
      if (k.taktTime != null) els.kpiTaktSec.textContent = `Takt de ${computed.product.name}${computed.product.demandOwn ? "" : " (demanda geral)"} • misto: ${Calc.formatTime(mix.taktMix, unit, kd)} ${u}`;
      return;
    }
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
