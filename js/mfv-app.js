/**
 * ============================================================================
 * LEAN CHRONO & MFV — PÁGINA DO MAPA DE FLUXO DE VALOR (ESTADO PRESENTE)
 * ----------------------------------------------------------------------------
 * Tela + orquestração do MFV. Usa o mesmo armazenamento da cronoanálise
 * (navegador + pasta do OneDrive, com controle de revisão contra conflito)
 * e lê os estudos para preencher o TC de cada etapa (editável).
 * Grupos do Yamazumi: "posto" vira 1 etapa (TC = ciclo, conteúdo de trabalho, nº de
 * operadores = nº de estudos); "linha" vira 1 etapa por estudo.
 * Depende de: LeanCalc, LeanMfv, LeanStorage, LeanYamazumi.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const Calc = root.LeanCalc;
  const M = root.LeanMfv;
  const Y = root.LeanYamazumi;
  const Store = root.LeanStorage;
  const STORE = Store.STORE_MFV;
  const IO = { normalize: M.normalizeMfv, serialize: M.serializeMfv };
  const DISK_SAVE_DELAY_MS = 3000;
  const $ = (id) => document.getElementById(id);
  const fmt = Calc.formatNumber;
  const money = (v) =>
    v == null || !Number.isFinite(v) ? "--" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

  const Tpl = root.LeanXlsxTemplate;
  const TEMPLATE_KEY = "template:mfv";
  const MIX_KEY = "__mix__"; // opção "Mix (TC ponderado)" de um estudo com vários produtos
  const TEMPLATE_DIR = "_Modelos";

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
    studies: [], // estudos disponíveis para vincular: { key, id, product, productName, fileName, clientName, processName, tcMin }
    pendingStudyKey: null, // estudo trazido pelo botão "→ MFV" da cronoanálise, ainda sem MFV escolhido
    pendingGroupId: null, // grupo trazido pelo botão "→ MFV" do Yamazumi
    studyDocs: new Map(), // id → estudo (para calcular os grupos)
    groups: [], // grupos do Yamazumi: { id, name, kind, situation, clientName, fileName, cycle, content, n, members }
    tcChanges: [], // últimas atualizações de TC (para o "Desfazer")
    docsCache: [], // MFVs salvos (para sugerir famílias da empresa)
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
    const docs = new Map();
    const add = (study, fileName) => {
      const prev = map.get(study.id);
      if (prev && String(prev.updatedAt) >= String(study.updatedAt)) return;
      docs.set(study.id, study);
      // Estudo com vários produtos: uma opção por produto (cada um com o seu tempo padrão)
      const r = Calc.computeStudy(study);
      const tc = (k) => (k.standardTime > 0 ? k.standardTime : k.sumNormal > 0 ? k.sumNormal : null);
      map.set(study.id, {
        id: study.id,
        fileName: fileName || study.fileName,
        clientName: study.clientName,
        processName: study.processName,
        updatedAt: study.updatedAt,
        tcMin: tc(r.kpis),
        products: r.multiProduct
          ? r.products
              .map((p) => ({ key: p.key, name: p.name, tcMin: tc(p.kpis) }))
              .concat(r.mix && r.mix.status !== "incompleto" ? [{ key: MIX_KEY, name: "Mix (TC ponderado)", tcMin: r.mix.weightedTP }] : [])
          : [],
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
    // Lista plana: estudo de produto único = 1 opção; com vários produtos = 1 opção por produto
    state.studies = [];
    map.forEach((st) => {
      if (!st.products.length) state.studies.push(Object.assign({ key: st.id, product: "", productName: "" }, st));
      else st.products.forEach((p) => state.studies.push(Object.assign({}, st, { key: `${st.id}::${p.key}`, product: p.key, productName: p.name, tcMin: p.tcMin })));
    });
    state.studyDocs = docs;
    await loadGroups();
    renderStudyPicker();
  }

  /** Grupos do Yamazumi (navegador e pasta), calculados com os estudos atuais. */
  async function loadGroups() {
    if (!Y) return;
    const items = new Map();
    (await Store.listLocal(Store.STORE_GROUPS)).forEach((r) => r && r.study && items.set(r.id, r.study));
    if (await Store.folderReady()) {
      try {
        const { studies } = await Store.listFolderStudies({ pattern: Y.FILE_PATTERN, normalize: Y.normalizeGroup });
        studies.forEach((g) => {
          const prev = items.get(g.id);
          if (!prev || String(g.updatedAt) > String(prev.updatedAt)) items.set(g.id, g);
        });
      } catch (err) {
        console.warn("Erro ao ler grupos da pasta:", err);
      }
    }
    state.groups = Array.from(items.values()).map((g) => {
      const r = Y.computeGroup(g, state.studyDocs);
      return {
        id: g.id,
        name: g.name || "Grupo",
        kind: g.kind,
        situation: g.situation,
        clientName: g.clientName,
        fileName: g.fileName,
        cycle: r.cycle,
        content: r.n ? r.content : null,
        n: r.n,
        members: r.members.filter((m) => m.found && m.tp > 0).map((m) => ({ studyId: m.studyId, product: m.productKey || "", label: m.label })),
      };
    });
  }

  function findGroup(step) {
    return state.groups.find((g) => g.id === step.groupId) || null;
  }

  /** Etapas criadas a partir de um grupo: posto = 1 etapa; linha = 1 etapa por estudo. */
  function stepsFromGroup(g) {
    if (g.kind === "linha") {
      return g.members
        .map((m) => {
          const st = state.studies.find((x) => x.id === m.studyId && x.product === m.product) || state.studies.find((x) => x.id === m.studyId);
          if (!st) return null;
          const step = stepFromStudy(st);
          if (m.label && !/^Etapa \d+$/.test(m.label)) step.name = m.label;
          return step;
        })
        .filter(Boolean);
    }
    return [
      M.createStep({
        name: g.name,
        source: "group",
        groupId: g.id,
        groupFileName: g.fileName,
        tcGroupMin: g.cycle,
        contentGroupMin: g.content,
        groupOperators: g.n,
        operators: String(g.n || 1),
      }),
    ];
  }

  function addGroupSteps(g) {
    if (!g.n) return toast(`O grupo "${g.name}" não tem estudos com tempo padrão.`, "warn");
    if (g.kind === "posto" && state.doc.steps.some((s) => s.groupId === g.id)) return toast(`"${g.name}" já é etapa deste MFV.`, "ok");
    const steps = stepsFromGroup(g);
    state.doc.steps.push(...steps);
    if (!state.doc.clientName && g.clientName) state.doc.clientName = g.clientName;
    markChanged({ render: true });
    toast(
      g.kind === "posto"
        ? `Etapa do posto "${g.name}": TC = ciclo ${ft(g.cycle)} ${Calc.TIME_UNITS[unitOf()].label}, ${g.n} operador(es). No MFV vale o takt do MFV.`
        : `${steps.length} etapa(s) da linha "${g.name}" adicionada(s). Preencha o uptime.`,
      "ok",
      7000
    );
  }

  function renderStudyPicker() {
    const sel = $("study-picker");
    const client = state.doc ? Calc.elementKey(state.doc.clientName) : "";
    const list = state.studies.slice().sort((a, b) => {
      const ma = Calc.elementKey(a.clientName) === client ? 0 : 1;
      const mb = Calc.elementKey(b.clientName) === client ? 0 : 1;
      return ma - mb || String(a.processName).localeCompare(String(b.processName), "pt-BR");
    });
    const options = list.map((s) =>
      el("option", {
        value: s.key,
        textContent: `${s.processName || "Sem posto"}${s.productName ? ` • ${s.productName}` : ""} — ${s.clientName || "Sem cliente"} (${s.tcMin ? ft(s.tcMin) + " " + Calc.TIME_UNITS[unitOf()].label : "sem tempo"})`,
      })
    );
    const groups = state.groups
      .slice()
      .sort((a, b) => (Calc.elementKey(a.clientName) === client ? 0 : 1) - (Calc.elementKey(b.clientName) === client ? 0 : 1) || a.name.localeCompare(b.name, "pt-BR"))
      .map((g) =>
        el("option", {
          value: `grupo:${g.id}`,
          textContent: `${g.kind === "linha" ? "Linha" : "Posto"}: ${g.name} (${g.situation}) — ${g.clientName || "Sem cliente"} (${g.cycle ? `${g.kind === "linha" ? "gargalo" : "ciclo"} ${ft(g.cycle)} ${Calc.TIME_UNITS[unitOf()].label}, ${g.n} estudo(s)` : "sem tempo"})`,
        })
      );
    sel.replaceChildren(
      el("option", { value: "", textContent: list.length || groups.length ? "Selecione um estudo ou grupo..." : "Nenhum estudo encontrado" }),
      ...(groups.length ? [el("optgroup", { label: "Estudos de cronoanálise" }, options), el("optgroup", { label: "Grupos do Yamazumi" }, groups)] : options)
    );
  }

  /** Atualiza o TC das etapas vinculadas com o tempo padrão atual dos estudos. */
  function refreshLinkedSteps(announce) {
    if (!state.doc) return 0;
    let changed = 0;
    const visible = []; // mudanças que alteram o TC usado (etapa não editada à mão)
    state.doc.steps.forEach((s) => {
      if (s.groupId) {
        const g = findGroup(s);
        if (!g) return;
        if (g.cycle !== s.tcGroupMin || g.content !== s.contentGroupMin || g.n !== s.groupOperators || g.fileName !== s.groupFileName) {
          if (s.source === "group" && Number.isFinite(s.tcGroupMin) && g.cycle !== s.tcGroupMin) {
            visible.push({ id: s.id, name: s.name || g.name, from: s.tcGroupMin, to: g.cycle });
          }
          // Nº de operadores acompanha o grupo, salvo se tiver sido alterado à mão
          if (g.n && String(s.operators).trim() === String(s.groupOperators)) s.operators = String(g.n);
          s.tcGroupMin = g.cycle;
          s.contentGroupMin = g.content;
          s.groupOperators = g.n;
          s.groupFileName = g.fileName;
          changed += 1;
        }
        return;
      }
      if (!s.studyId) return;
      const st = findStudy(s);
      if (!st) return;
      if (st.tcMin !== s.tcStudyMin || st.fileName !== s.studyFileName) {
        if (s.source === "study" && Number.isFinite(s.tcStudyMin) && st.tcMin !== s.tcStudyMin) {
          visible.push({ id: s.id, name: s.name || st.processName, from: s.tcStudyMin, to: st.tcMin });
        }
        s.tcStudyMin = st.tcMin;
        s.studyFileName = st.fileName;
        changed += 1;
      }
    });
    showTcBanner(visible);
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

  /** Faixa "N TC(s) atualizados a partir dos estudos", com Desfazer. */
  function showTcBanner(changes) {
    state.tcChanges = changes;
    const banner = $("tc-banner");
    if (!changes.length) {
      banner.hidden = true;
      return;
    }
    const u = Calc.TIME_UNITS[unitOf()].label;
    const v = (m) => (Number.isFinite(m) ? ft(m) : "—");
    $("tc-banner-text").textContent =
      `ℹ ${changes.length} TC(s) atualizado(s) a partir dos estudos: ` + changes.map((c) => `${c.name} ${v(c.from)} → ${v(c.to)} ${u}`).join(" · ");
    banner.hidden = false;
  }

  /** Desfazer: mantém os TCs anteriores como valor editado (não voltam a ser atualizados). */
  function undoTcChanges() {
    if (!state.doc || !state.tcChanges.length) return;
    state.tcChanges.forEach((c) => {
      const step = state.doc.steps.find((x) => x.id === c.id);
      if (step && Number.isFinite(c.from)) {
        step.source = "manual";
        step.tcManualMin = c.from;
      }
    });
    toast(`${state.tcChanges.length} TC(s) mantido(s) como antes (marcados como editados; use ↺ para voltar ao estudo ou grupo).`, "ok", 6000);
    showTcBanner([]);
    markChanged({ render: true });
  }

  /* ==========================================================================
     MFVs SALVOS E LIGAÇÃO COM A CRONOANÁLISE
     ========================================================================== */

  /** MFVs do navegador e da pasta (o mais recente de cada id). */
  async function listDocs() {
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
    const list = Array.from(items.values()).sort((a, b) => String(b.doc.updatedAt).localeCompare(String(a.doc.updatedAt)));
    state.docsCache = list;
    return { list, source };
  }

  /** Nome de empresa já usado nos estudos/MFVs com a mesma grafia (ignora maiúsculas e espaços). */
  function knownClients(docs) {
    const map = new Map();
    state.studies.forEach((s) => s.clientName && !map.has(Calc.elementKey(s.clientName)) && map.set(Calc.elementKey(s.clientName), s.clientName.trim()));
    (docs || []).forEach(({ doc }) => doc.clientName && !map.has(Calc.elementKey(doc.clientName)) && map.set(Calc.elementKey(doc.clientName), doc.clientName.trim()));
    return map;
  }

  function stepFromStudy(st) {
    return M.createStep({
      name: st.productName ? `${st.processName || "Etapa"} • ${st.productName}` : st.processName || "Etapa",
      source: "study",
      studyId: st.id,
      studyProduct: st.product,
      studyFileName: st.fileName,
      tcStudyMin: st.tcMin,
    });
  }

  /** Lista de estudos da empresa digitada no "Novo MFV" (marcados viram etapas). */
  function renderNewDocStudies() {
    const key = Calc.elementKey($("new-client").value);
    const list = key
      ? state.studies
          .filter((s) => Calc.elementKey(s.clientName) === key)
          .sort((a, b) => String(a.processName).localeCompare(String(b.processName), "pt-BR") || (a.product === MIX_KEY) - (b.product === MIX_KEY))
      : [];
    const ul = $("new-doc-study-list");
    const prev = new Set(Array.from(ul.querySelectorAll("input:checked")).map((i) => i.value));
    if (state.pendingStudyKey) prev.add(state.pendingStudyKey);
    const u = Calc.TIME_UNITS[unitOf()].label;
    ul.replaceChildren(
      ...list.map((s) => {
        const cb = el("input", { type: "checkbox", value: s.key, checked: prev.has(s.key) });
        const label = el("label", {}, [
          cb,
          el("span", { textContent: `${s.processName || "Sem posto"}${s.productName ? ` • ${s.productName}` : ""}` }),
          el("span", { className: "study-check-tc", textContent: s.tcMin ? `TC ${ft(s.tcMin)} ${u}` : "sem tempo padrão" }),
        ]);
        return el("li", {}, [label]);
      })
    );
    $("new-doc-studies").hidden = !list.length;
    // Família: sugere os produtos dos estudos e as famílias dos MFVs desta empresa (o consultor escolhe)
    const fam = new Map();
    const addFam = (n) => n && !fam.has(Calc.elementKey(n)) && fam.set(Calc.elementKey(n), n.trim());
    list.forEach((st) => st.product !== MIX_KEY && addFam(st.productName));
    state.docsCache.forEach(({ doc }) => key && Calc.elementKey(doc.clientName) === key && addFam(doc.family));
    $("family-list").replaceChildren(...Array.from(fam.values()).map((n) => el("option", { value: n })));
    $("new-doc-hint").textContent = !key
      ? "Escolha a empresa: os estudos de cronoanálise dela aparecem aqui para virar etapas, com o TC já preenchido."
      : list.length
        ? `${list.length} estudo(s) desta empresa. Nº de operadores e uptime ficam para você preencher.`
        : "Nenhum estudo de cronoanálise com esta empresa. As etapas podem ser incluídas depois.";
  }

  /** Inclui no MFV aberto o estudo trazido pelo botão "→ MFV" (se ainda não for etapa). */
  function addPendingStudy() {
    const key = state.pendingStudyKey;
    state.pendingStudyKey = null;
    if (!key || !state.doc) return;
    const st = state.studies.find((x) => x.key === key);
    if (!st) return toast("Estudo não encontrado para incluir no MFV.", "warn");
    const exists = state.doc.steps.find((s) => s.studyId === st.id && (s.studyProduct || "") === st.product);
    if (exists) {
      toast(`"${exists.name}" já é etapa deste MFV.`, "ok");
      return;
    }
    state.doc.steps.push(stepFromStudy(st));
    markChanged({ render: true });
    toast(`Etapa adicionada: ${st.processName}${st.productName ? ` • ${st.productName}` : ""} (TC ${st.tcMin ? ft(st.tcMin) + " " + Calc.TIME_UNITS[unitOf()].label : "sem tempo padrão"}). Preencha nº de operadores e uptime.`, "ok", 7000);
  }

  function addPendingGroup() {
    const id = state.pendingGroupId;
    state.pendingGroupId = null;
    if (!id || !state.doc) return;
    const g = state.groups.find((x) => x.id === id);
    if (g) addGroupSteps(g);
  }

  /** Abertura pelo botão "→ MFV" do Yamazumi: mfv.html?grupo=<id>. */
  async function openFromGroup(id) {
    try {
      root.history.replaceState(null, "", root.location.pathname);
    } catch (e) {
      /* file:// em alguns navegadores: ignora */
    }
    const g = state.groups.find((x) => x.id === id);
    if (!g) {
      toast("Grupo não encontrado. Salve o grupo e tente de novo.", "warn");
      return false;
    }
    state.pendingGroupId = g.id;
    const { list } = await listDocs();
    const same = list.filter(({ doc }) => Calc.elementKey(doc.clientName) === Calc.elementKey(g.clientName));
    if (same.length === 1 && (await openDoc(same[0].doc.id, same[0].doc.fileName))) {
      addPendingGroup();
      return true;
    }
    await showDocs();
    $("new-client").value = g.clientName || "";
    renderNewDocStudies();
    toast(
      same.length > 1
        ? `${g.clientName} tem ${same.length} MFVs: abra o desejado na lista (o grupo será incluído) ou crie um novo.`
        : `${g.clientName} ainda não tem MFV: informe a família e crie. O grupo "${g.name}" entra como etapa.`,
      same.length > 1 ? "warn" : "ok",
      8000
    );
    return true;
  }

  /** Abertura pelo botão "→ MFV" da cronoanálise: mfv.html?estudo=<id>&produto=<chave>. */
  async function openFromCrono() {
    let params;
    try {
      params = new root.URLSearchParams(root.location.search);
    } catch (e) {
      return false;
    }
    const groupId = params.get("grupo");
    if (groupId) return openFromGroup(groupId);
    const id = params.get("estudo");
    if (!id) return false;
    try {
      root.history.replaceState(null, "", root.location.pathname); // recarregar não repete a inclusão
    } catch (e) {
      /* file:// em alguns navegadores: ignora */
    }
    const product = params.get("produto") || "";
    const st = state.studies.find((x) => x.id === id && x.product === product) || state.studies.find((x) => x.id === id);
    if (!st) {
      toast("Estudo não encontrado. Salve o estudo e tente de novo.", "warn");
      return false;
    }
    state.pendingStudyKey = st.key;
    const { list } = await listDocs();
    const same = list.filter(({ doc }) => Calc.elementKey(doc.clientName) === Calc.elementKey(st.clientName));
    if (same.length === 1) {
      if (await openDoc(same[0].doc.id, same[0].doc.fileName)) {
        addPendingStudy();
        return true;
      }
    }
    await showDocs();
    $("new-client").value = st.clientName || "";
    // Vindo de um produto do resumo: sugere o nome dele como família (editável)
    if (st.productName && st.product !== MIX_KEY && !$("new-family").value.trim()) $("new-family").value = st.productName;
    renderNewDocStudies();
    if (same.length > 1) {
      toast(`${st.clientName} tem ${same.length} MFVs: abra o desejado na lista (o estudo será incluído) ou crie um novo.`, "warn", 8000);
    } else {
      $("new-family").focus();
      toast(`${st.clientName} ainda não tem MFV: informe a família e crie. O estudo já está marcado.`, "ok", 7000);
    }
    return true;
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
    // Produtividade real (pç/HH)
    $("prod-tbody").replaceChildren(...d.productivity.map((p, i) => prodRow(p, i)));
    if (!d.productivity.length) {
      const td = el("td", { className: "cell-text text-muted", textContent: "Registre um dia por linha: produção, nº de operadores e horas trabalhadas. Use '+ Dia (linha de base)' no T1 e '+ Dia (acompanhamento)' no T3." });
      td.colSpan = 9;
      $("prod-tbody").append(el("tr", {}, [td]));
    }

    renderStudyPicker();
    update();
  }

  function prodRow(p, i) {
    const tr = el("tr", { className: p.period === "acomp" ? "period-acomp" : "" });
    tr.dataset.id = p.id;
    const mk = (field, value, cls, extra) => {
      const inp = el("input", Object.assign({ type: "text", className: `input-cell ${cls || ""}`, value: value == null ? "" : value, autocomplete: "off" }, extra || {}));
      inp.dataset.field = field;
      return inp;
    };
    const period = el("select", { className: "input-cell", title: "Período da medição" }, [
      el("option", { value: "base", textContent: "Linha de base" }),
      el("option", { value: "acomp", textContent: "Acompanhamento" }),
    ]);
    period.value = p.period;
    period.dataset.field = "period";
    const del = el("button", { type: "button", className: "btn-icon-del", textContent: "×", title: "Remover dia" });
    del.dataset.action = "remove";
    tr.append(
      el("td", { className: "cell-num", textContent: String(i + 1).padStart(2, "0") }),
      el("td", {}, [mk("date", p.date, "mono", { type: "date" })]),
      el("td", {}, [period]),
      el("td", {}, [mk("pieces", p.pieces, "mono", { inputMode: "decimal" })]),
      el("td", {}, [mk("operators", p.operators, "mono", { inputMode: "decimal" })]),
      el("td", {}, [mk("hours", p.hours, "mono", { inputMode: "decimal", placeholder: "Ex.: 8,8" })]),
      el("td", { className: "cell-readonly mono" }),
      el("td", { className: "cell-readonly mono highlight-col" }),
      el("td", { className: "cell-actions" }, [del])
    );
    tr.children[6].dataset.out = "hh";
    tr.children[7].dataset.out = "pcHH";
    return tr;
  }

  /** Produtividade real e payback (só valores calculados; mantém o foco). */
  function updateProductivity(r) {
    const p = r.productivity;
    const pb = r.payback;
    $("prod-tbody").querySelectorAll("tr[data-id]").forEach((tr, i) => {
      const x = p.records[i];
      if (!x) return;
      tr.querySelector('[data-out="hh"]').textContent = x.hh != null ? fmt(x.hh, 2) : "--";
      tr.querySelector('[data-out="pcHH"]').textContent = x.pcHH != null ? fmt(x.pcHH, 3) : "--";
      tr.classList.toggle("row-error", x.errors.length > 0);
      tr.title = x.errors.join(" • ");
    });
    const cap = (g) => (g.days ? `${g.days} dia(s) • ${fmt(g.pieces, g.pieces % 1 ? 2 : 0)} ${pu()} ÷ ${fmt(g.hh, 1)} HH` : "Sem dias registrados");
    $("kpi-prod-base").textContent = p.base.pcHH != null ? fmt(p.base.pcHH, 3) : "--";
    $("kpi-prod-base-cap").textContent = cap(p.base);
    const projectedOnly = p.source === "projetado";
    $("kpi-prod-acomp-title").textContent = projectedOnly ? "Projetado (estimativa)" : "Acompanhamento";
    $("kpi-prod-acomp").textContent = p.compare != null ? fmt(p.compare, 3) : "--";
    $("kpi-prod-acomp-cap").textContent = projectedOnly ? "Valor digitado: substituído pelo real quando houver acompanhamento" : cap(p.acomp);

    const gainCard = $("kpi-gain-card");
    gainCard.classList.remove("is-bottleneck", "is-balanced", "is-warning");
    const target = `Meta B+P: +${fmt(p.targetPct, p.targetPct % 1 ? 1 : 0)}%`;
    if (p.gainPct != null) {
      $("kpi-gain").textContent = `${p.gainPct >= 0 ? "+" : ""}${fmt(p.gainPct, 1)}%`;
      const label = { meta: "✓ meta atingida", abaixo: "abaixo da meta", queda: "⚠ queda de produtividade" }[p.status];
      $("kpi-gain-cap").textContent = `${target} • ${label}${projectedOnly ? " (projetado)" : ""}`;
      gainCard.classList.add(p.status === "meta" ? "is-balanced" : p.status === "abaixo" ? "is-warning" : "is-bottleneck");
    } else {
      $("kpi-gain").textContent = "--";
      $("kpi-gain-cap").textContent =
        p.base.pcHH != null && p.targetPcHH != null ? `${target} → atingir ${fmt(p.targetPcHH, 3)} ${pu()}/HH` : `${target} • registre a linha de base`;
    }

    // Payback: campos e cartões conforme o método (padrão B+P ou mão de obra)
    const bp = pb.method === "bp";
    document.querySelectorAll(".pb-bp").forEach((n) => (n.hidden = !bp));
    document.querySelectorAll(".pb-hh").forEach((n) => (n.hidden = bp));
    const prodLabel = pb.monthlyProd != null ? `${fmt(pb.monthlyProd, 0)} ${pu()}/mês${pb.monthlyProdFromDemand ? " (demanda do MFV)" : ""}` : null;
    if (bp) {
      $("pb-hint").textContent =
        "Padrão B+P (Módulo T1.4): ganho = (produção T3 − T1) × preço de venda. É ganho de faturamento e só vale se a produção a mais for vendida. Investimento = custo do programa + investimentos do cliente.";
      $("kpi-hh-saved-title").textContent = "Aumento de produção";
      $("kpi-hh-saved-unit").textContent = `${pu()}/mês`;
      $("kpi-hh-saved").textContent = pb.prodIncrease != null ? fmt(pb.prodIncrease, pb.prodIncrease % 1 ? 1 : 0) : "--";
      $("kpi-hh-saved-cap").textContent =
        pb.prodIncrease != null
          ? `T1 ${prodLabel} → T3 ${fmt(pb.prodT3, 0)}${pb.prodT3Estimated ? " (estimada pelo ganho de pç/HH)" : ""}`
          : prodLabel
            ? "Informe a produção T3 ou registre o pç/HH (linha de base e acompanhamento)"
            : "Informe a produção mensal T1 ou a demanda";
      $("kpi-monthly-gain").textContent = money(pb.monthlyGain);
      $("kpi-monthly-gain-cap").textContent =
        pb.monthlyGain != null ? `Vendas ${money(pb.salesGain)} + outros ${money(pb.otherGains)} • ${money(pb.annualGain)}/ano` : "Informe o preço de venda ou outros ganhos";
    } else {
      $("pb-hint").textContent = "HH economizadas/mês = produção mensal × (1 ÷ pç/HH base − 1 ÷ pç/HH atual). Ganho = HH economizadas × custo da HH. Só é ganho financeiro se as HH liberadas forem realocadas ou evitadas (hora extra, contratação).";
      $("kpi-hh-saved-title").textContent = "HH economizadas";
      $("kpi-hh-saved-unit").textContent = "HH/mês";
      $("kpi-hh-saved").textContent = pb.hhSavedMonth != null ? fmt(pb.hhSavedMonth, 1) : "--";
      $("kpi-hh-saved-cap").textContent = prodLabel || "Informe a produção ou a demanda mensal";
      $("kpi-monthly-gain").textContent = money(pb.monthlyGain);
      $("kpi-monthly-gain-cap").textContent =
        pb.monthlyGain != null ? `MO ${money(pb.laborGain)} + outros ${money(pb.otherGains)} • ${money(pb.annualGain)}/ano` : "Informe o custo da HH ou outros ganhos";
    }
    const pbCard = $("kpi-payback-card");
    pbCard.classList.remove("is-bottleneck", "is-balanced", "is-warning");
    $("kpi-payback").textContent = pb.months != null ? fmt(pb.months, 1) : "--";
    const pbCap = {
      ok: `${money(pb.investment)} ÷ ganho mensal${pb.source === "projetado" || pb.source === "estimado" ? " (estimativa)" : ""}`,
      "sem-retorno": "⚠ Sem retorno: o ganho mensal não é positivo",
      invalido: `⚠ ${pb.issues[0] || "Valores inválidos"}`,
      incompleto: pb.investment == null ? "Informe o custo do programa e/ou os investimentos" : "Faltam dados para o ganho mensal",
    }[pb.status];
    $("kpi-payback-cap").textContent = pbCap;
    if (pb.status === "ok") pbCard.classList.add(pb.months <= 12 ? "is-balanced" : "is-warning");
    else if (pb.status === "sem-retorno" || pb.status === "invalido") pbCard.classList.add("is-bottleneck");
  }

  function stepRow(s, i) {
    const tr = el("tr");
    tr.dataset.id = s.id;
    const radio = el("input", { type: "radio", name: "kaizen", checked: !!s.kaizen, title: "Processo Kaizen" });
    radio.dataset.field = "kaizen";
    const origin = el("td", { className: "cell-text origin-cell" + (s.groupId ? " origin-cell-group" : "") });
    if (s.groupId) {
      const g = findGroup(s);
      const edited = s.source === "manual";
      origin.append(
        el("span", {
          className: "origin-study origin-group",
          textContent: `${edited ? "✎ editado • " : "Posto: "}${g ? `${g.name} (${g.n} estudo(s))` : s.groupFileName || "grupo não encontrado"}`,
          title: s.groupFileName,
        })
      );
      if (edited) {
        const back = el("button", { type: "button", className: "btn-link", textContent: "↺ usar grupo", title: "Voltar a usar o ciclo do grupo" });
        back.dataset.action = "use-study";
        origin.append(back);
      }
      const content = el("input", {
        type: "text",
        className: "input-cell mono input-content",
        inputMode: "decimal",
        autocomplete: "off",
        title: "Conteúdo de trabalho Σ(TP − espera). Vazio = calculado pelo grupo (proporcional ao TC, se o TC for editado)",
      });
      content.dataset.field = "content";
      origin.append(el("label", { className: "content-cell" }, ["Conteúdo ", content]));
    } else if (s.studyId) {
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

  /** Estudo (e produto) vinculado à etapa. */
  function findStudy(step) {
    return (
      state.studies.find((x) => x.id === step.studyId && x.product === (step.studyProduct || "")) ||
      // produto renomeado ou estudo que passou a ter um produto só: usa o estudo, se for único
      (state.studies.filter((x) => x.id === step.studyId).length === 1 ? state.studies.find((x) => x.id === step.studyId) : null)
    );
  }

  function studyLabel(s) {
    const st = findStudy(s);
    if (st && st.productName) return `${st.processName || st.fileName} • ${st.productName}`;
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
        const tcMin = src.source === "study" ? src.tcStudyMin : src.source === "group" ? src.tcGroupMin : src.tcManualMin;
        tcInput.value = Number.isFinite(tcMin) ? ft(tcMin) : "";
      }
      const contentInput = tr.querySelector('[data-field="content"]');
      if (contentInput && document.activeElement !== contentInput) {
        contentInput.value = Number.isFinite(src.contentManualMin) ? ft(src.contentManualMin) : "";
        contentInput.placeholder = s.content != null ? ft(s.content) : "";
      }
      tr.querySelector('[data-out="opsEff"]').textContent = fmt(s.opsEff, 2);
      tr.querySelector('[data-out="takt"]').textContent = s.taktPct != null ? `${fmt(s.taktPct, 1)}%` : "--";
      tr.classList.toggle("row-error", s.errors.length > 0);
      tr.classList.toggle("row-over-takt", s.overTakt);
      tr.title = s.errors.concat(s.warnings).join(" • ") || (s.overTakt ? "TC acima do takt (gargalo)" : "");
    });
    $("tc-total").textContent = r.tcTotal ? ft(r.tcTotal) : "--";
    $("ops-total").textContent = fmt(r.opsTotal, 2);
    renderGbo(r);

    // Resultados
    $("kpi-bottleneck-tc").textContent = r.bottleneck ? ft(r.bottleneck.tc) : "--";
    $("kpi-bottleneck-unit").textContent = r.bottleneck ? `${u}/${pu()}` : "";
    $("kpi-bottleneck-name").textContent = r.bottleneck ? `${r.bottleneck.seq}. ${r.bottleneck.name}` : "Sem etapas";
    $("kpi-ops").textContent = fmt(r.opsTotal, 2);
    $("kpi-ops").title = r.opsTyped ? `Digitado (equipe compartilhada). Soma das etapas: ${fmt(r.opsSum, 2)}` : "Soma dos operadores efetivos das etapas";
    $("kpi-ops-ideal").textContent =
      `Ideal (${r.hasGroups ? "Σ conteúdo" : "ΣTC"} ÷ takt): ${r.opsIdeal != null ? fmt(r.opsIdeal, 2) : "--"} • Balanceamento: ${r.lineBalancePct != null ? fmt(r.lineBalancePct, 1) + "%" : "--"}`;
    $("kpi-ops-ideal").title = "Balanceamento da linha = Σ conteúdo ÷ (operadores atuais × TC do gargalo)";
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

    updateProductivity(r);
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
      if (f === "content") {
        const v = Calc.parseNumber(e.target.value);
        s.contentManualMin = v != null && v > 0 ? v / Calc.TIME_UNITS[unitOf()].factor : null;
      } else if (f === "tc") {
        const v = Calc.parseNumber(e.target.value);
        s.tcManualMin = v != null && v > 0 ? v / Calc.TIME_UNITS[unitOf()].factor : null;
        if (s.source !== "manual") {
          s.source = "manual"; // TC editado: passa a usar o valor digitado
          const origin = tr.querySelector(".origin-cell");
          const fresh = stepRow(s, Array.from(steps.children).indexOf(tr));
          origin.replaceWith(fresh.querySelector(".origin-cell"));
          markChanged();
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
        list[i].source = list[i].groupId ? "group" : "study";
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
      const value = $("study-picker").value;
      if (value.startsWith("grupo:")) {
        const g = state.groups.find((x) => x.id === value.slice(6));
        return g ? addGroupSteps(g) : toast("Grupo não encontrado.", "warn");
      }
      const st = state.studies.find((x) => x.key === value);
      if (!st) return toast("Escolha um estudo na lista.", "warn");
      state.doc.steps.push(stepFromStudy(st));
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

    // Produtividade real (pç/HH)
    const prod = $("prod-tbody");
    const onProdEdit = (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || !e.target.dataset.field) return;
      const rec = state.doc.productivity.find((x) => x.id === tr.dataset.id);
      if (!rec) return;
      rec[e.target.dataset.field] = e.target.value;
      if (e.target.dataset.field === "period") tr.classList.toggle("period-acomp", e.target.value === "acomp");
      markChanged();
    };
    prod.addEventListener("input", onProdEdit);
    prod.addEventListener("change", (e) => {
      if (e.target.tagName === "SELECT" || e.target.type === "date") onProdEdit(e);
    });
    prod.addEventListener("click", (e) => {
      if (!e.target.closest('[data-action="remove"]')) return;
      const id = e.target.closest("tr").dataset.id;
      state.doc.productivity = state.doc.productivity.filter((x) => x.id !== id);
      markChanged({ render: true });
    });
    const addDay = (period) => {
      const list = state.doc.productivity;
      const last = [...list].reverse().find((x) => x.period === period) || list[list.length - 1];
      // Repete operadores e horas do último dia do mesmo período (agiliza a digitação).
      list.push(M.createProductivityRecord({ period, operators: last ? last.operators : "", hours: last ? last.hours : "" }));
      markChanged({ render: true });
      const inputs = prod.querySelectorAll('[data-field="pieces"]');
      inputs[inputs.length - 1].focus();
    };
    $("btn-add-prod-base").addEventListener("click", () => addDay("base"));
    $("btn-add-prod-acomp").addEventListener("click", () => addDay("acomp"));

    // Cabeçalho, conflito, exportação
    $("btn-connect-folder").addEventListener("click", connectFolder);
    $("btn-docs").addEventListener("click", () => showDocs());
    $("new-client").addEventListener("input", renderNewDocStudies);
    $("doc-dialog").addEventListener("close", () => {
      state.pendingStudyKey = null;
      state.pendingGroupId = null;
    });
    $("btn-tc-undo").addEventListener("click", undoTcChanges);
    $("btn-tc-ok").addEventListener("click", () => showTcBanner([]));
    $("btn-export-xlsx-mfv").addEventListener("click", exportXlsx);
    $("btn-mfv-ai").addEventListener("click", mfvAiSummary);
    $("btn-mfv-ai-generate").addEventListener("click", mfvAiSummary);
    $("btn-mfv-ai-close").addEventListener("click", () => $("mfv-ai-dialog").close());
    $("btn-mfv-ai-append").addEventListener("click", () => applyMfvAi("append"));
    $("btn-mfv-ai-replace").addEventListener("click", () => applyMfvAi("replace"));
    $("input-template-mfv").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) loadTemplateFile(file);
    });
    $("btn-remove-template-mfv").addEventListener("click", async () => {
      if (!root.confirm("Remover o modelo do MFV deste navegador? (a cópia na pasta _Modelos é mantida)")) return;
      await Store.setKV(TEMPLATE_KEY, null);
      state.template = null;
      setTemplateInfo(null);
    });
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
      const typed = $("new-client").value.trim();
      const family = $("new-family").value.trim();
      if (!typed || !family) return toast("Informe a empresa e a família.", "warn");
      // Mesma empresa dos estudos com a mesma grafia ("metal alfa" → "Metal Alfa")
      const client = knownClients().get(Calc.elementKey(typed)) || typed;
      const chosen = Array.from($("new-doc-study-list").querySelectorAll("input:checked"))
        .map((i) => state.studies.find((x) => x.key === i.value))
        .filter(Boolean);
      state.pendingStudyKey = null;
      await flushSave();
      const doc = M.createMfv({ clientName: client, family });
      doc.steps = chosen.map(stepFromStudy);
      const pg = state.pendingGroupId && state.groups.find((g) => g.id === state.pendingGroupId);
      state.pendingGroupId = null;
      if (pg) doc.steps.push(...stepsFromGroup(pg));
      setCurrent({ study: doc, diskRevision: null, dirty: true });
      await persistLocal();
      await Store.setKV("lastMfvId", doc.id);
      dlg.close();
      if (state.folder === "granted") queueWrite();
      toast(`MFV criado: ${doc.fileName}${chosen.length ? ` com ${chosen.length} etapa(s) dos estudos. Preencha nº de operadores e uptime.` : ""}`, "ok", 6000);
    });
    $("doc-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const li = btn.closest("li");
      if (btn.dataset.action === "open") {
        await flushSave();
        if (await openDoc(li.dataset.id, li.dataset.fileName)) {
          addPendingStudy();
          addPendingGroup();
          dlg.close();
        }
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
    const { list, source } = await listDocs();
    $("doc-source").textContent = source;
    // Empresas dos estudos e MFVs: o nome digitado no "Novo MFV" sai igual ao dos estudos
    $("client-list").replaceChildren(...Array.from(knownClients(list).values()).map((n) => el("option", { value: n })));
    renderNewDocStudies();
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
     MODELO EXCEL DO MFV (navegador + pasta _Modelos)
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
    $("template-info-mfv").textContent = rec
      ? `✅ ${rec.name} (${Math.round(rec.size / 1024)} KB) — carregado em ${new Date(rec.savedAt).toLocaleString("pt-BR")}. "Exportar Excel" preenche as abas EP e EF.`
      : 'Nenhum modelo carregado. Carregue a planilha "MFV Simplificado" para exportar no padrão B+P.';
    $("btn-remove-template-mfv").hidden = !rec;
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
      await Tpl.loadTemplate(bytes, { expect: "mfv" });
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
    toast(`Modelo MFV reconhecido ✅ ${file.name}`, "ok");
  }

  /** Pasta conectada: envia o modelo para _Modelos ou traz de lá se o navegador não tiver. */
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
          await Tpl.loadTemplate(f.bytes, { expect: "mfv" });
          toast(`Modelo MFV encontrado na pasta ${TEMPLATE_DIR}: ${f.name}`, "ok");
          return saveTemplate(f.name, f.bytes);
        } catch (err) {
          /* não é o modelo do MFV */
        }
      }
    } catch (err) {
      console.warn("Não foi possível sincronizar o modelo do MFV:", err);
    }
    return null;
  }

  async function exportXlsx() {
    if (!state.doc) return;
    await flushSave();
    const rec = (await getTemplate()) || state.template || (await syncTemplate());
    if (!rec) {
      toast('Carregue o modelo "MFV Simplificado" em MFVs → Modelo Excel para exportar no padrão B+P.', "warn", 8000);
      return showDocs();
    }
    try {
      const res = await Tpl.fillFromBytes(rec.bytes, state.doc, { expect: "mfv" });
      const name = Tpl.exportMfvFileName(state.doc, rec.name);
      Store.downloadText(
        name,
        res.bytes,
        /\.xlsm$/i.test(name) ? "application/vnd.ms-excel.sheet.macroEnabled.12" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      toast(`Excel (modelo B+P) exportado: ${name} — ${res.steps} etapa(s).`, "ok", 6000);
      res.warnings.forEach((w) => toast(w, "warn", 9000));
    } catch (err) {
      console.error("Falha ao preencher o modelo do MFV:", err);
      toast(`Não foi possível exportar: ${err.message || err}`, "error", 9000);
    }
  }

  /* ==========================================================================
     RESUMO EXECUTIVO COM IA (mesma configuração do ✨ IA da cronoanálise)
     ========================================================================== */

  async function mfvAiSummary() {
    const AI = root.LeanAI;
    const dlg = $("mfv-ai-dialog");
    const status = (t, err) => {
      $("mfv-ai-status").textContent = t;
      $("mfv-ai-status").classList.toggle("is-error", !!err);
    };
    if (!dlg.open) dlg.showModal();
    let settings = null;
    try {
      settings = await Store.getKV(AI.SETTINGS_KEY);
    } catch (e) {
      /* sem armazenamento */
    }
    if (!settings || !settings.apiKey || !settings.model) {
      return status("Configure a IA no botão ✨ IA da Cronoanálise (chave de API e modelo) e volte aqui.", true);
    }
    if (root.navigator.onLine === false) return status("A IA precisa de internet.", true);
    const prompt = AI.buildMfvSummaryPrompt(state.doc, M.computeMfv(state.doc), settings.anonymize !== false);
    if (!prompt.count) return status("Adicione as etapas do GBO antes de pedir o resumo.", true);
    status("Consultando o Gemini...");
    $("btn-mfv-ai-generate").disabled = true;
    try {
      const text = await AI.generate(settings, prompt.text, {});
      $("mfv-ai-text").value = AI.restoreNames(text, { clientName: state.doc.clientName, processName: state.doc.family });
      status("Revise e edite o texto antes de aplicar. Confira os números com o MFV.");
    } catch (err) {
      status(`Falha na IA: ${err.message || err}`, true);
    } finally {
      $("btn-mfv-ai-generate").disabled = false;
    }
  }

  function applyMfvAi(mode) {
    const text = $("mfv-ai-text").value.trim();
    if (!text || !state.doc) return;
    if (mode === "replace" && state.doc.notes && !root.confirm("Substituir as premissas e observações atuais pelo resumo?")) return;
    state.doc.notes = mode === "append" && state.doc.notes ? `${state.doc.notes}\n\n${text}` : text;
    markChanged({ render: true });
    $("mfv-ai-dialog").close();
    toast("Resumo executivo aplicado às premissas e observações.", "ok");
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
    setTemplateInfo(await getTemplate());
    syncTemplate();
    await loadStudies();
    // Vindo do botão "→ MFV" da cronoanálise: abre/cria o MFV da empresa com o estudo
    if (await openFromCrono()) {
      refreshStatus();
      return;
    }
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
