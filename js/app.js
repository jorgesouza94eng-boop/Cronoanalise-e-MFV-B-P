/**
 * ============================================================================
 * LEAN CHRONO & MFV — ORQUESTRAÇÃO DO APLICATIVO
 * ----------------------------------------------------------------------------
 * Liga a interface (ui.js) ao motor de cálculo (calc.js) e ao armazenamento
 * (storage.js). Fluxo de salvamento:
 *   cada alteração → cache do navegador (imediato)
 *                  → pasta do OneDrive (debounce de 3 s após a última tecla)
 * Depende de: LeanCalc, LeanStorage, LeanUI.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const Store = root.LeanStorage;
  const UI = root.LeanUI;

  const LOCAL_SAVE_DELAY_MS = 250;
  const DISK_SAVE_DELAY_MS = 3000; // proteção contra conflito de sincronização do OneDrive
  const DISK_RETRY_DELAY_MS = 10000;

  const Tpl = root.LeanXlsxTemplate;
  const TEMPLATE_KEY = "template:crono";
  const TEMPLATE_DIR = "_Modelos";
  let templateMeta = null;
  let memoryTemplate = null; // usado só quando o navegador não permite guardar binários

  /* ---- Modelo Excel B+P (navegador + pasta _Modelos) ----------------------- */

  async function getTemplate() {
    try {
      const rec = await Store.getKV(TEMPLATE_KEY);
      return rec && rec.bytes ? rec : null;
    } catch (err) {
      return null;
    }
  }

  async function saveTemplate(name, bytes, macro) {
    const rec = { name, size: bytes.length, savedAt: new Date().toISOString(), macro: !!macro, bytes };
    templateMeta = { name: rec.name, size: rec.size, savedAt: rec.savedAt, macro: rec.macro };
    if (Store.canStoreBinary()) await Store.setKV(TEMPLATE_KEY, rec);
    else UI.toast("Este navegador não permite guardar o modelo: ele valerá só até fechar a página.", "warn");
    if (!Store.canStoreBinary()) memoryTemplate = rec;
    UI.setTemplateInfo(templateMeta);
    return templateMeta;
  }

  /** Pasta conectada: envia o modelo do navegador para _Modelos ou traz de lá se o navegador não tiver. */
  async function syncTemplateFromFolder(quiet) {
    try {
      const local = (await getTemplate()) || memoryTemplate;
      const files = await Store.readBinaryFiles(TEMPLATE_DIR, /\.xls[xm]$/i);
      if (local) {
        if (!files.some((f) => f.name === local.name)) await Store.writeBinaryFile(TEMPLATE_DIR, local.name, local.bytes);
        return local;
      }
      for (const f of files) {
        try {
          const tpl = await Tpl.loadTemplate(f.bytes, { expect: "crono" });
          await saveTemplate(f.name, f.bytes, tpl.macro);
          if (!quiet) UI.toast(`Modelo Excel encontrado na pasta ${TEMPLATE_DIR}: ${f.name}`, "ok");
          return getTemplate().then((r) => r || memoryTemplate);
        } catch (err) {
          /* arquivo que não é o modelo REV2: ignora */
        }
      }
    } catch (err) {
      console.warn("Não foi possível sincronizar o modelo com a pasta:", err);
    }
    return null;
  }

  const state = {
    study: null,
    computed: null,
    diskRevision: null, // revisão da pasta conhecida por este dispositivo
    dirty: false, // há alterações ainda não gravadas na pasta
    exportedAt: null, // último "Exportar JSON" (relevante no celular)
    changeSeq: 0,
    conflict: null,
    folder: "unsupported", // unsupported | none | prompt | granted
    saving: false,
    lastDiskSaveAt: null,
    lastError: null,
  };

  let localTimer = null;
  let diskTimer = null;
  let writing = null;
  let pendingWrite = false;

  /* ==========================================================================
     REGISTRO DE ALTERAÇÕES
     ========================================================================== */

  function markChanged(opts) {
    const o = opts || {};
    state.study.updatedAt = new Date().toISOString();
    state.dirty = true;
    state.changeSeq += 1;
    if (o.recompute !== false) recompute(o.rerender);
    scheduleLocalSave();
    scheduleDiskSave(DISK_SAVE_DELAY_MS);
    refreshStatus();
  }

  function recompute(rerender) {
    state.computed = Calc.computeStudy(state.study);
    if (rerender) UI.renderRows(state.study, state.computed);
    else UI.updateComputed(state.computed);
  }

  function findElement(id) {
    return state.study ? state.study.elements.find((e) => e.id === id) : null;
  }

  /* ==========================================================================
     HANDLERS CHAMADOS PELA INTERFACE
     ========================================================================== */

  const handlers = {
    hasOpenStudy: () => !!state.study,
    getElement: findElement,

    onMetaChange(field, value) {
      if (!state.study || state.study[field] === value) return;
      state.study[field] = value;
      // O nome do arquivo NÃO muda ao renomear cliente/posto (evita arquivos órfãos).
      markChanged({ recompute: false });
    },

    onFilmPiecesChange(key, raw) {
      if (!state.study) return;
      const value = String(raw == null ? "" : raw).trim();
      const pieces = state.study.filmPieces || (state.study.filmPieces = {});
      if ((pieces[key] || "") === value) return;
      if (value) pieces[key] = value;
      else delete pieces[key];
      markChanged();
    },

    onParamChange(key, raw) {
      if (!state.study) return false;
      const value = Calc.parseNumber(raw);
      if (state.study.shiftParams[key] !== value) {
        state.study.shiftParams[key] = value;
        markChanged();
      }
      return value !== null;
    },

    onVideoStartCommit(raw) {
      const p = Calc.parseTimeInput(raw);
      if (p.error) return { ok: false, error: p.error };
      if (state.study.videoStart !== p.formatted) {
        state.study.videoStart = p.formatted;
        markChanged();
      }
      return { ok: true, formatted: p.formatted };
    },

    onElementInput(id, field, value) {
      const el = findElement(id);
      if (!el || el[field] === value) return;
      el[field] = value;
      // A descrição define o agrupamento do resumo; só o Kaizen não altera cálculos.
      markChanged({ recompute: field !== "kaizen" });
    },

    /**
     * Ao confirmar a descrição: se o elemento já existe em outra linha, copia o tipo,
     * o valor e o desperdício (linha ainda não classificada). Retorna o que foi copiado.
     */
    onDescriptionCommit(id) {
      const el = findElement(id);
      if (!el || el.value) return null;
      const key = Calc.elementKey(el.description);
      if (!key) return null;
      const src = state.study.elements.find((e) => e !== el && e.value && Calc.elementKey(e.description) === key);
      if (!src) return null;
      el.type = src.type;
      el.value = src.value;
      el.waste = src.waste;
      markChanged();
      return { type: el.type, value: el.value, waste: el.waste };
    },

    /** Configurações do estudo: modo de lançamento e unidade de exibição. */
    onSettingChange(key, value) {
      if (!state.study) return;
      const settings = state.study.settings || (state.study.settings = {});
      if (settings[key] === value) return;
      settings[key] = value;
      markChanged({ rerender: true });
    },

    onTimeCommit(id, raw) {
      const el = findElement(id);
      if (!el) return { ok: false, error: "Linha não encontrada" };
      const p = Calc.parseTimeInput(raw);
      const stored = p.error ? String(raw).trim() : p.formatted;
      if (el.videoTime !== stored) {
        el.videoTime = stored;
        markChanged();
      }
      if (p.error) return { ok: false, error: p.error };
      const row = state.computed.rows.find((r) => r.id === id);
      const rowError = row && row.errors.find((m) => /leitura anterior/.test(m));
      return { ok: true, formatted: p.formatted, rowError: rowError || null };
    },

    /** Marca/desmarca a linha como início de uma nova filmagem (leitura volta a 00:00). */
    onSetNewVideo(id, value) {
      const els = state.study.elements;
      const idx = els.findIndex((e) => e.id === id);
      if (idx < 0) return { ok: false, error: "Linha não encontrada" };
      if (idx === 0) return { ok: false, error: "A primeira linha já inicia a filmagem 1." };
      const el = els[idx];
      const next = value === undefined ? !el.newVideo : !!value;
      if (el.newVideo !== next) {
        el.newVideo = next;
        markChanged();
      }
      const row = state.computed.rows[idx];
      return { ok: true, newVideo: next, film: row.film, filmCount: state.computed.filmCount };
    },

    onPaceCommit(id, raw) {
      const el = findElement(id);
      if (!el) return { ok: false, error: "Linha não encontrada" };
      const p = Calc.parsePace(raw);
      return p.error ? { ok: false, error: p.error } : { ok: true };
    },

    onAddRow() {
      const els = state.study.elements;
      const last = els[els.length - 1];
      // Novo elemento herda o ritmo da linha anterior (o ritmo do operador tende a se manter).
      const inheritedPace = last && !Calc.parsePace(last.pace).error ? last.pace : "100";
      els.push(Calc.createElement({ pace: inheritedPace }));
      markChanged({ rerender: true });
      return els.length - 1;
    },

    onDeleteRow(id) {
      const els = state.study.elements;
      const idx = els.findIndex((e) => e.id === id);
      if (idx < 0) return;
      if (els.length === 1) els[0] = Calc.createElement();
      else els.splice(idx, 1);
      markChanged({ rerender: true });
    },

    onExportJSON() {
      if (!state.study) return;
      exportStudyFile(state.study);
      state.exportedAt = new Date().toISOString();
      persistLocal();
      refreshStatus();
    },

    onExportCSV() {
      if (!state.study) return;
      const name = state.study.fileName.replace(/\.json$/i, ".csv");
      Store.downloadText(name, Calc.buildCSV(state.study), "text/csv;charset=utf-8");
      UI.toast(`CSV exportado: ${name}`, "ok");
    },

    /** Com modelo carregado: preenche a planilha B+P. Sem modelo: Excel simples. */
    async onExportXlsx() {
      if (!state.study) return;
      let rec = (await getTemplate()) || memoryTemplate;
      if (!rec && state.folder === "granted") rec = await syncTemplateFromFolder(true);
      if (!rec) return handlers.onExportXlsxSimple();
      try {
        const res = await Tpl.fillFromBytes(rec.bytes, state.study);
        const name = Tpl.exportFileName(state.study, rec.name);
        const mime = /\.xlsm$/i.test(name)
          ? "application/vnd.ms-excel.sheet.macroEnabled.12"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        Store.downloadText(name, res.bytes, mime);
        UI.toast(`Excel (modelo B+P) exportado: ${name} — ${res.lines} lançamento(s), ${res.elements} elemento(s).`, "ok", 6000);
        res.warnings.forEach((w) => UI.toast(w, "warn", 9000));
      } catch (err) {
        console.error("Falha ao preencher o modelo:", err);
        UI.toast(`Não foi possível usar o modelo: ${err.message || err}. Foi exportado o Excel simples.`, "error", 9000);
        handlers.onExportXlsxSimple();
      }
    },

    onExportXlsxSimple() {
      if (!state.study) return;
      const name = state.study.fileName.replace(/\.json$/i, "_BP.xlsx");
      Store.downloadText(name, root.LeanXlsx.buildBPWorkbook(state.study), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      UI.toast(`Excel simples exportado: ${name}`, "ok");
    },

    async onLoadTemplate(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let tpl;
      try {
        tpl = await Tpl.loadTemplate(bytes, { expect: "crono" });
      } catch (err) {
        UI.toast(`Modelo recusado: ${err.message || err}`, "error", 9000);
        return;
      }
      const meta = await saveTemplate(file.name, bytes, tpl.macro);
      if (state.folder === "granted") {
        try {
          await Store.writeBinaryFile(TEMPLATE_DIR, file.name, bytes);
        } catch (err) {
          UI.toast(`Modelo guardado no navegador, mas não na pasta ${TEMPLATE_DIR}: ${err.message || err}`, "warn");
        }
      }
      UI.toast(`Modelo REV2 reconhecido ✅ ${meta.name}${tpl.macro ? " (com macros)" : ""}.`, "ok", 6000);
    },

    async onRemoveTemplate() {
      if (!root.confirm("Remover o modelo Excel deste navegador? (a cópia na pasta _Modelos do OneDrive é mantida)")) return;
      await Store.setKV(TEMPLATE_KEY, null);
      templateMeta = null;
      UI.setTemplateInfo(null);
    },

    onFlush() {
      flushSave().then(() => {
        if (state.folder === "granted" && !state.dirty && !state.conflict) UI.toast("Estudo gravado na pasta.", "ok");
        else if (state.folder !== "granted") UI.toast("Estudo salvo no navegador.", "ok");
      });
    },

    onConnectFolder: connectFolder,
    onOpenStudies: () => showStudies(),

    async onOpenStudy(id, fileName) {
      if (state.study && state.study.id === id) {
        UI.closeDialog();
        return;
      }
      await flushSave();
      if (await openStudy(id, fileName)) UI.closeDialog();
    },

    async onCreateStudy(clientName, processName) {
      await flushSave();
      const study = Calc.createStudy({
        clientName,
        processName,
        shiftParams: state.study ? Object.assign({}, state.study.shiftParams) : undefined,
        settings: state.study ? Object.assign({}, state.study.settings) : undefined,
      });
      setCurrent({ study, diskRevision: null, dirty: true, exportedAt: null });
      await persistLocal();
      await Store.setKV("lastStudyId", study.id);
      UI.closeDialog();
      if (state.folder === "granted") queueWrite();
      UI.toast(`Estudo criado: ${study.fileName}`, "ok");
      UI.focusCell(0, "description");
    },

    async onImportFile(file) {
      const res = await Store.readImportFile(file);
      if (!res.ok) {
        UI.toast(`Importação recusada: ${res.error}`, "error");
        return;
      }
      const study = res.study;
      const existing = await Store.getLocal(study.id);
      if (existing) {
        const msg =
          `Este estudo já existe neste dispositivo:\n` +
          `• Atual: atualizado em ${UI.formatDateTime(existing.study.updatedAt)}\n` +
          `• Importado: atualizado em ${UI.formatDateTime(study.updatedAt)}\n\n` +
          `Substituir pela versão importada?`;
        if (!root.confirm(msg)) return;
      }
      await flushSave();
      // A revisão do arquivo importado é a base para detectar conflito com a pasta.
      await Store.putLocal({
        id: study.id,
        study,
        diskRevision: study.revision,
        dirty: true,
        exportedAt: existing ? existing.exportedAt : null,
      });
      if (await openStudy(study.id, study.fileName)) {
        UI.closeDialog();
        UI.toast(`Estudo importado: ${study.clientName} — ${study.processName}`, "ok");
      }
    },

    async onExportStudy(id, fileName) {
      if (state.study && state.study.id === id) return handlers.onExportJSON();
      let study = null;
      const local = await Store.getLocal(id);
      if (local) study = local.study;
      else if (state.folder === "granted" && fileName) {
        const disk = await Store.readStudyFile(fileName);
        if (disk && !disk.invalid) study = disk;
      }
      if (!study) return UI.toast("Não foi possível ler o estudo.", "error");
      exportStudyFile(study);
      if (local) {
        local.exportedAt = new Date().toISOString();
        await Store.putLocal(local);
      }
    },

    async onRemoveStudy(id) {
      const local = await Store.getLocal(id);
      if (!local) return;
      const label = `${local.study.clientName} — ${local.study.processName}`;
      const warning =
        local.dirty && state.folder !== "granted"
          ? "\n\nATENÇÃO: este estudo só existe neste navegador. Exporte antes de remover, ou os dados serão perdidos."
          : "";
      if (!root.confirm(`Remover "${label}" deste navegador?${warning}`)) return;
      await Store.deleteLocal(id);
      showStudies();
    },

    async onConflictUseDisk() {
      if (!state.conflict || !(await ensureFolderPermission())) return;
      const disk = await Store.readStudyFile(state.study.fileName);
      if (!disk || disk.invalid) {
        UI.toast("Não foi possível ler a versão da pasta (arquivo ausente ou corrompido).", "error");
        return;
      }
      const copy = state.conflict.conflictFile;
      setCurrent({ study: disk, diskRevision: disk.revision, dirty: false, exportedAt: state.exportedAt });
      await persistLocal();
      UI.toast(
        copy ? `Versão da pasta carregada. Sua versão anterior ficou salva em ${copy}.` : "Versão da pasta carregada.",
        "ok",
        8000
      );
    },

    async onConflictKeepLocal() {
      if (!state.conflict) return;
      const ok = root.confirm(
        "Sobrescrever o arquivo da pasta com a versão aberta nesta tela?\n\n" +
          "As alterações feitas no outro dispositivo serão substituídas."
      );
      if (!ok || !(await ensureFolderPermission())) return;
      try {
        const res = await Store.writeStudy(state.study, null, { force: true });
        if (res.status === "ok") {
          state.conflict = null;
          state.diskRevision = res.revision;
          state.study.revision = res.revision;
          state.dirty = false;
          state.lastDiskSaveAt = new Date();
          UI.hideConflict();
          await persistLocal();
          UI.toast("Arquivo da pasta sobrescrito com a sua versão.", "ok");
        }
      } catch (err) {
        reportWriteError(err);
      }
      refreshStatus();
    },
  };

  /* ==========================================================================
     ESTUDO ABERTO
     ========================================================================== */

  function setCurrent(record) {
    state.study = record.study;
    state.diskRevision = record.diskRevision == null ? null : record.diskRevision;
    state.dirty = !!record.dirty;
    state.exportedAt = record.exportedAt || null;
    state.conflict = null;
    state.lastError = null;
    state.changeSeq += 1;
    UI.hideConflict();
    state.computed = Calc.computeStudy(state.study);
    UI.renderStudy(state.study, state.computed);
    refreshStatus();
  }

  /**
   * Abre um estudo conciliando a cópia do navegador com o arquivo da pasta.
   * Retorna true se abriu.
   */
  async function openStudy(id, fileNameHint) {
    const local = await Store.getLocal(id);
    const fileName = fileNameHint || (local && local.study.fileName);

    let disk = null;
    let diskInvalid = false;
    if (fileName && (await Store.folderReady())) {
      try {
        const d = await Store.readStudyFile(fileName);
        if (d && d.invalid) diskInvalid = true;
        else disk = d;
      } catch (err) {
        console.error("Erro ao ler o arquivo da pasta:", err);
        UI.toast(`Não foi possível ler ${fileName} da pasta: ${err.message || err}`, "error");
      }
    }

    if (!local && !disk) {
      UI.toast("Estudo não encontrado (arquivo ausente ou inválido).", "error");
      return false;
    }

    const decision = diskInvalid && local ? "conflict" : Calc.reconcile(local, disk);
    if (decision === "use-disk") {
      if (fileName) disk.fileName = fileName;
      setCurrent({ study: disk, diskRevision: disk.revision, dirty: false, exportedAt: local && local.exportedAt });
      await persistLocal();
    } else {
      // "use-local" ou "conflict": abre a cópia do navegador; a gravação decide o resto.
      if (fileName) local.study.fileName = fileName;
      setCurrent(local);
      if (state.folder === "granted" && (!disk || local.dirty || decision === "conflict")) {
        state.dirty = true;
        queueWrite(); // em conflito, a gravação NÃO sobrescreve: salva cópia e mostra o aviso
      }
    }

    await Store.setKV("lastStudyId", id);
    return true;
  }

  function exportStudyFile(study) {
    Store.downloadText(study.fileName, Calc.serializeStudy(study), "application/json");
    UI.toast(`Arquivo exportado: ${study.fileName}`, "ok");
  }

  /* ==========================================================================
     SALVAMENTO (NAVEGADOR + PASTA)
     ========================================================================== */

  function scheduleLocalSave() {
    clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      localTimer = null;
      persistLocal();
    }, LOCAL_SAVE_DELAY_MS);
  }

  async function persistLocal() {
    if (!state.study) return;
    try {
      await Store.putLocal({
        id: state.study.id,
        study: state.study,
        diskRevision: state.diskRevision,
        dirty: state.dirty,
        exportedAt: state.exportedAt,
      });
    } catch (err) {
      console.error("Falha ao salvar no navegador:", err);
      UI.setStatus("error", "Falha ao salvar no navegador", `Erro: ${err.message || err}. Exporte o JSON por segurança.`);
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

  /** Fila de gravação: nunca há duas gravações simultâneas no mesmo arquivo. */
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
    if (!state.study || !state.dirty || state.conflict) return;
    if (!(await Store.folderReady())) {
      if (Store.getDirHandle()) state.folder = "prompt";
      updateFolderButton();
      refreshStatus();
      return;
    }

    const study = state.study;
    const seq = state.changeSeq;
    state.saving = true;
    refreshStatus();
    try {
      const res = await Store.writeStudy(study, state.diskRevision);
      if (study !== state.study) return; // estudo trocado durante a gravação
      if (res.status === "ok") {
        state.diskRevision = res.revision;
        study.revision = res.revision;
        state.dirty = state.changeSeq !== seq; // houve digitação durante a gravação?
        state.lastDiskSaveAt = new Date();
        state.lastError = null;
        if (state.dirty) scheduleDiskSave(DISK_SAVE_DELAY_MS);
      } else if (res.status === "conflict") {
        state.conflict = res;
        showConflictBanner();
      } else if (res.status === "no-permission") {
        state.folder = "prompt";
        updateFolderButton();
      }
      await persistLocal();
    } catch (err) {
      reportWriteError(err);
      scheduleDiskSave(DISK_RETRY_DELAY_MS);
    } finally {
      state.saving = false;
      refreshStatus();
    }
  }

  function reportWriteError(err) {
    console.error("Erro ao gravar na pasta:", err);
    const first = !state.lastError;
    state.lastError = err;
    if (first) {
      UI.toast(
        `Falha ao gravar na pasta (${err.name || "erro"}). Os dados continuam salvos no navegador; nova tentativa automática.`,
        "error",
        8000
      );
    }
  }

  /** Grava imediatamente o que estiver pendente (troca de estudo, Ctrl+S, saída da página). */
  async function flushSave() {
    if (localTimer) {
      clearTimeout(localTimer);
      localTimer = null;
    }
    if (diskTimer) {
      clearTimeout(diskTimer);
      diskTimer = null;
    }
    await persistLocal();
    if (state.folder === "granted" && state.dirty) await queueWrite();
    else if (writing) await writing;
  }

  function showConflictBanner() {
    const c = state.conflict;
    let text;
    if (c.diskInvalid) {
      text = `O arquivo "${state.study.fileName}" na pasta está corrompido ou incompleto.`;
    } else {
      const when = c.diskStudy ? UI.formatDateTime(c.diskStudy.updatedAt) : "—";
      text = `O arquivo "${state.study.fileName}" foi alterado em outro dispositivo (atualizado em ${when}).`;
    }
    if (c.conflictFile) text += ` Sua versão foi salva como cópia: ${c.conflictFile}.`;
    text += " Nada será gravado na pasta até você escolher uma versão.";
    UI.showConflict(text);
  }

  /* ==========================================================================
     PASTA DO ONEDRIVE
     ========================================================================== */

  async function connectFolder() {
    if (!Store.fsSupported) {
      UI.toast("Este navegador não permite acesso a pastas. Use Exportar/Importar JSON.", "warn");
      return;
    }
    try {
      // Pasta já conhecida e sem permissão: apenas reautoriza (exige este clique).
      if (Store.getDirHandle() && state.folder === "prompt") {
        const perm = await Store.requestPermission();
        if (perm === "granted") return onFolderReady(false);
      }
      await Store.pickDirectory();
      await onFolderReady(true);
    } catch (err) {
      if (err && err.name === "AbortError") return; // usuário cancelou o seletor
      console.error("Erro ao conectar a pasta:", err);
      UI.toast(`Não foi possível conectar a pasta: ${err.message || err}`, "error");
    }
  }

  /** Usado em ações de clique (conflito) para reautorizar a pasta se necessário. */
  async function ensureFolderPermission() {
    if (await Store.folderReady()) return true;
    if (!Store.getDirHandle()) {
      UI.toast("Conecte a pasta do OneDrive primeiro.", "warn");
      return false;
    }
    const perm = await Store.requestPermission();
    if (perm === "granted") {
      state.folder = "granted";
      updateFolderButton();
      return true;
    }
    UI.toast("Permissão de acesso à pasta negada.", "error");
    return false;
  }

  async function onFolderReady(isNewFolder) {
    state.folder = "granted";
    state.lastError = null;
    updateFolderButton();
    refreshStatus();
    const name = Store.getDirHandle().name;

    if (state.study) {
      await persistLocal();
      await openStudy(state.study.id, state.study.fileName);
    }

    await syncTemplateFromFolder(false);

    if (isNewFolder) {
      try {
        const { studies } = await Store.listFolderStudies();
        UI.toast(`Pasta conectada: ${name} (${studies.length} estudo(s) encontrado(s)).`, "ok");
      } catch (err) {
        UI.toast(`Pasta conectada: ${name}.`, "ok");
      }
    } else {
      UI.toast(`Pasta reautorizada: ${name}.`, "ok");
    }
    if (!state.study) showStudies();
  }

  function updateFolderButton() {
    const map = { unsupported: "hidden", none: "connect", prompt: "reconnect", granted: "connected" };
    const handle = Store.getDirHandle();
    UI.setFolderButton(map[state.folder], handle && handle.name);
  }

  /* ==========================================================================
     GERENCIADOR DE ESTUDOS
     ========================================================================== */

  async function showStudies(opts) {
    const items = new Map();
    const locals = await Store.listLocal();
    locals.forEach((r) => {
      if (!r || !r.study) return;
      items.set(r.id, {
        id: r.id,
        clientName: r.study.clientName,
        processName: r.study.processName,
        fileName: r.study.fileName,
        updatedAt: r.study.updatedAt,
        inLocal: true,
        inFolder: false,
        pending: Store.fsSupported && !!r.dirty,
      });
    });

    let source = "Navegador deste dispositivo";
    if (await Store.folderReady()) {
      source = `Pasta: ${Store.getDirHandle().name}`;
      try {
        const { studies, skipped } = await Store.listFolderStudies();
        studies.forEach((s) => {
          const it = items.get(s.id);
          if (it) {
            it.inFolder = true;
            it.fileName = s.fileName;
            if (s.updatedAt > it.updatedAt) {
              it.updatedAt = s.updatedAt;
              it.clientName = s.clientName;
              it.processName = s.processName;
            }
          } else {
            items.set(s.id, {
              id: s.id,
              clientName: s.clientName,
              processName: s.processName,
              fileName: s.fileName,
              updatedAt: s.updatedAt,
              inLocal: false,
              inFolder: true,
              pending: false,
            });
          }
        });
        if (skipped.length) {
          UI.toast(
            `${skipped.length} arquivo(s) ignorado(s) na pasta: ${skipped.map((s) => `${s.fileName} (${s.error})`).join("; ")}`,
            "warn",
            9000
          );
        }
      } catch (err) {
        UI.toast(`Erro ao ler a pasta: ${err.message || err}`, "error");
      }
    }

    // Ordena antes de marcar o estudo aberto
    const list = Array.from(items.values()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (state.study) {
      const cur = list.find((it) => it.id === state.study.id);
      if (cur) {
        cur.current = true;
        cur.clientName = state.study.clientName;
        cur.processName = state.study.processName;
        cur.pending = Store.fsSupported && state.dirty;
      }
    }

    let hint = "";
    if (!Store.fsSupported) {
      hint = "Neste dispositivo os estudos ficam no navegador. Use Exportar para levar o .json ao OneDrive.";
    } else if (state.folder !== "granted") {
      hint = "Conecte a pasta do OneDrive para listar os arquivos sincronizados.";
    }

    UI.openDialog(list, Object.assign({ source, hint }, opts || {}));
  }

  /* ==========================================================================
     INDICADOR DE STATUS
     ========================================================================== */

  function refreshStatus() {
    if (!state.study) {
      UI.setStatus("offline", "Nenhum estudo aberto");
      return;
    }
    const handle = Store.getDirHandle();
    if (state.conflict) {
      UI.setStatus("error", "Conflito com a pasta: escolha uma versão");
    } else if (state.folder === "granted") {
      if (state.lastError) {
        UI.setStatus("error", "Falha ao gravar na pasta (nova tentativa automática)", String(state.lastError.message || state.lastError));
      } else if (state.saving) {
        UI.setStatus("saving", "Gravando na pasta...");
      } else if (state.dirty) {
        UI.setStatus("saving", "Alterações pendentes (gravação em 3 s)");
      } else {
        const when = state.lastDiskSaveAt ? ` às ${state.lastDiskSaveAt.toLocaleTimeString("pt-BR")}` : "";
        UI.setStatus("online", `Salvo na pasta${when}`, `Pasta: ${handle.name} • Arquivo: ${state.study.fileName}`);
      }
    } else if (state.folder === "prompt") {
      UI.setStatus("reconnect", "Salvo no navegador: reautorize a pasta", "Clique em \"Reautorizar pasta\" para voltar a gravar no OneDrive.");
    } else if (state.folder === "none") {
      UI.setStatus("local", "Salvo só no navegador: conecte a pasta");
    } else {
      const exp = state.exportedAt ? `exportado ${relativeTime(state.exportedAt)}` : "nunca exportado";
      UI.setStatus("local", `Salvo no navegador • ${exp}`, "No celular, use Exportar JSON regularmente para salvar uma cópia no OneDrive.");
    }
  }

  function relativeTime(iso) {
    const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `há ${diffMin} min`;
    const hours = Math.round(diffMin / 60);
    if (hours < 24) return `há ${hours} h`;
    return `há ${Math.round(hours / 24)} dia(s)`;
  }

  /* ==========================================================================
     PWA (SOMENTE QUANDO HOSPEDADO VIA http/https)
     ========================================================================== */

  function registerPwa() {
    // Em file:// o manifesto e o service worker geram erro de CORS: só ativa via servidor.
    if (!/^https?:$/.test(root.location.protocol)) return;
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.webmanifest";
    document.head.appendChild(link);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker não registrado:", err));
    }
  }

  /* ==========================================================================
     INICIALIZAÇÃO
     ========================================================================== */

  async function start() {
    UI.init(handlers);
    UI.setStatus("offline", "Iniciando...");

    const info = await Store.init();
    if (info.backend !== "idb") {
      UI.toast(
        info.backend === "localStorage"
          ? "Armazenamento limitado neste navegador (localStorage). Exporte o JSON com frequência."
          : "Este navegador não permite salvar dados. Exporte o JSON antes de fechar a página!",
        "warn",
        9000
      );
    }
    registerPwa();

    if (Store.fsSupported) {
      const r = await Store.restoreDirHandle();
      state.folder = r.handle ? (r.permission === "granted" ? "granted" : "prompt") : "none";
    }
    updateFolderButton();

    const tplRec = await getTemplate();
    templateMeta = tplRec ? { name: tplRec.name, size: tplRec.size, savedAt: tplRec.savedAt, macro: tplRec.macro } : null;
    UI.setTemplateInfo(templateMeta);
    if (!templateMeta && state.folder === "granted") syncTemplateFromFolder(false);

    let opened = false;
    const lastId = await Store.getKV("lastStudyId");
    if (lastId) opened = await openStudy(lastId);
    if (!opened) {
      const locals = (await Store.listLocal()).filter((r) => r && r.study);
      locals.sort((a, b) => String(b.study.updatedAt).localeCompare(String(a.study.updatedAt)));
      if (locals.length) opened = await openStudy(locals[0].id);
    }
    if (!opened) await showStudies({ focusNew: true });
    refreshStatus();

    if (opened) UI.focusCell(0, "description");

    // Gravação garantida ao sair/ocultar a aba
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushSave();
    });
    root.addEventListener("pagehide", () => flushSave());
    root.addEventListener("beforeunload", (e) => {
      if (state.folder === "granted" && state.dirty && !state.conflict) {
        flushSave();
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // Atualiza o "exportado há X" no modo celular
    setInterval(() => {
      if (state.folder === "unsupported") refreshStatus();
    }, 60000);
  }

  // Exposto para diagnóstico e testes automatizados.
  /**
   * Aplica sugestões aprovadas da IA. Só preenche campos ainda vazios do estudo.
   * classify: [{ name, value, waste }] | kaizen: [{ name, text }] | rename: [{ to, from: [] }] |
   * notes: { text, mode: "replace"|"append" }
   */
  function applyAi(s) {
    if (!state.study) return 0;
    let changed = 0;
    const els = state.study.elements;
    (s.classify || []).forEach((c) => {
      const key = Calc.elementKey(c.name);
      els.forEach((el) => {
        if (Calc.elementKey(el.description) === key && !el.value) {
          el.value = c.value;
          el.waste = c.waste || "";
          changed += 1;
        }
      });
    });
    (s.kaizen || []).forEach((k) => {
      const key = Calc.elementKey(k.name);
      const rows = els.filter((el) => Calc.elementKey(el.description) === key);
      // Uma ação por elemento: na 1ª linha com o campo vazio (se nenhuma já tiver ação)
      if (rows.length && !rows.some((el) => el.kaizen)) {
        rows[0].kaizen = k.text;
        changed += 1;
      }
    });
    // Padronização de nomes: renomeia as linhas das variantes para o nome padrão
    (s.rename || []).forEach((g) => {
      const keys = new Set(g.from.map((n) => Calc.elementKey(n)));
      els.forEach((el) => {
        if (keys.has(Calc.elementKey(el.description))) {
          el.description = g.to;
          changed += 1;
        }
      });
    });
    if (s.notes && s.notes.text) {
      state.study.notes = s.notes.mode === "append" && state.study.notes ? `${state.study.notes}\n\n${s.notes.text}` : s.notes.text;
      changed += 1;
    }
    if (changed) {
      markChanged({ rerender: true });
      UI.renderStudy(state.study, state.computed);
    }
    return changed;
  }

  root.LeanApp = {
    state,
    applyAi,
    flushSave,
    openStudy,
    showStudies,
    useFolderHandle: async (handle) => {
      await Store.useDirectoryHandle(handle);
      await onFolderReady(true);
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})(typeof self !== "undefined" ? self : this);
