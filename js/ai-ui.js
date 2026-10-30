/**
 * ============================================================================
 * LEAN CHRONO & MFV — TELA DO ASSISTENTE DE IA (GEMINI)
 * ----------------------------------------------------------------------------
 * Configuração da chave (só neste navegador), pedidos à IA e revisão das
 * sugestões antes de aplicar ao estudo aberto.
 * Depende de: LeanCalc, LeanAI, LeanStorage, LeanApp.
 * ============================================================================
 */
(function (root) {
  "use strict";

  const AI = root.LeanAI;
  const Calc = root.LeanCalc;
  const Store = root.LeanStorage;
  const $ = (id) => document.getElementById(id);

  let settings = { apiKey: "", model: "", anonymize: true };
  let openDialog = async () => {}; // definido em init (abre a janela do assistente)
  let pending = null; // { kind, items, text, studyId, studyName }
  // Tarefa da IA (REV 1.21): continua com a janela minimizada; o selo mostra o andamento
  let job = null; // { kind, count, studyId, studyName, state: "running" | "done" | "error" }
  const KIND_LABELS = { classify: "Classificação", kaizen: "Kaizen", notes: "Constatações", names: "Padronizar nomes", ask: "Pergunta", etapas: "Etapas" };

  function app() {
    return root.LeanApp;
  }

  function setStatus(text, isError) {
    const el = $("ai-status");
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  const running = () => !!(job && job.state === "running");
  const studyName = (st) => [st.clientName, st.processName].filter(Boolean).join(" — ") || "sem nome";

  /* ==========================================================================
     MINIMIZAR (REV 1.21): selo no canto da tela com o andamento da tarefa
     ========================================================================== */

  function updatePill() {
    const pill = $("ai-pill");
    const open = $("ai-dialog").open;
    const show = !open && !!job && (job.state === "running" || job.state === "error" || !!pending);
    pill.hidden = !show;
    document.body.classList.toggle("ai-pill-on", show);
    if (!show) return;
    const kind = KIND_LABELS[job.kind] || "IA";
    pill.className = `ai-pill ai-pill-${job.state}`;
    $("ai-pill-text").textContent =
      job.state === "running"
        ? `✨ IA trabalhando… (${kind}${job.count ? `, ${job.count} elemento(s)` : ""})`
        : job.state === "error"
          ? `⚠ Falha na IA (${kind}) — ver detalhe`
          : `✨ Sugestões prontas (${kind}) — abrir`;
    $("btn-ai-pill-discard").hidden = job.state === "running";
  }

  function startJob(kind, count, study) {
    job = { kind, count, studyId: study.id, studyName: studyName(study), state: "running" };
    document.querySelectorAll("[data-ai]").forEach((b) => (b.disabled = true));
    updatePill();
  }

  /** Fim da tarefa: com a janela minimizada, o selo muda e um aviso aparece. */
  function finishJob(state) {
    if (!job) return;
    job.state = state;
    refreshButtons();
    if (!$("ai-dialog").open) {
      const ui = root.LeanUI;
      const kind = KIND_LABELS[job.kind] || "IA";
      if (ui && ui.toast) {
        if (state === "error") ui.toast(`Falha na IA (${kind}). Clique no selo para ver o detalhe.`, "error");
        else if (pending) ui.toast(`✨ Sugestões da IA prontas (${kind}). Clique no selo para revisar.`, "ok");
      }
    }
    if (state === "done" && !pending) job = null;
    updatePill();
  }

  /** Sugestões presas ao estudo do pedido: com outro estudo aberto, não se aplica. */
  function checkStudy() {
    const cur = app() && app().state.study;
    const other = !!(pending && cur && pending.studyId !== cur.id);
    $("btn-ai-apply").disabled = other;
    $("btn-ai-append").disabled = other;
    if (other) setStatus(`Estas sugestões são do estudo "${pending.studyName}". Abra esse estudo para aplicar (ou descarte pelo selo).`, true);
    return !other;
  }

  function discardPending() {
    if (running()) return;
    pending = null;
    job = null;
    $("ai-results").hidden = true;
    setStatus("");
    updatePill();
  }

  function refreshButtons() {
    const online = root.navigator.onLine !== false;
    const ready = !!(settings.apiKey && settings.model);
    document.querySelectorAll("[data-ai]").forEach((b) => (b.disabled = !online || !ready || running()));
    $("ai-config-status").textContent = !online
      ? "• sem internet (a IA precisa de conexão)"
      : ready
        ? `• modelo: ${settings.model}`
        : "• cadastre a chave e escolha o modelo";
    if (!ready) $("ai-config").open = true;
  }

  async function loadSettings() {
    try {
      const s = await Store.getKV(AI.SETTINGS_KEY);
      if (s) settings = Object.assign(settings, s);
    } catch (e) {
      /* sem armazenamento: configuração vale só nesta sessão */
    }
    $("ai-key").value = settings.apiKey || "";
    $("ai-anon").checked = settings.anonymize !== false;
    if (settings.model) {
      $("ai-model").replaceChildren(new Option(settings.model, settings.model, true, true));
    }
  }

  async function saveSettings() {
    settings.apiKey = $("ai-key").value.trim();
    settings.model = $("ai-model").value;
    settings.anonymize = $("ai-anon").checked;
    await Store.setKV(AI.SETTINGS_KEY, settings);
    refreshButtons();
    setStatus(settings.apiKey && settings.model ? "Configuração salva neste aparelho." : "Informe a chave e escolha o modelo.");
  }

  async function loadModels() {
    const key = $("ai-key").value.trim();
    if (!key) return setStatus("Cole a chave de API primeiro.", true);
    setStatus("Consultando os modelos disponíveis para a sua chave...");
    try {
      const models = await AI.listModels(key);
      if (!models.length) return setStatus("Nenhum modelo Gemini de texto disponível para esta chave.", true);
      const def = settings.model && models.some((m) => m.id === settings.model) ? settings.model : AI.pickDefaultModel(models);
      $("ai-model").replaceChildren(...models.map((m) => new Option(`${m.label} (${m.id})`, m.id, m.id === def, m.id === def)));
      setStatus(`${models.length} modelo(s) encontrado(s). Sugerido: ${def}. Clique em "Salvar configuração".`);
    } catch (err) {
      setStatus(`Não foi possível consultar os modelos: ${err.message || err}`, true);
    }
  }

  /* ==========================================================================
     PEDIDOS À IA
     ========================================================================== */

  /**
   * Ações Kaizen (REV 1.20): todos os produtos, etapas e operadores; resposta pelo id; os
   * elementos que a IA não respondeu são pedidos de novo uma vez.
   */
  async function runKaizen() {
    const st = app() && app().state;
    if (!st || !st.study || running()) return;
    const study = st.study;
    const computed = Calc.computeStudy(study);
    const anon = settings.anonymize !== false;
    const prompt = AI.buildKaizenPrompt(study, computed, anon, { includeAll: $("ai-kaizen-all").checked });
    const outside = AI.kaizenStatsText(prompt.stats);
    if (!prompt.count) return setStatus(`Nenhum elemento para enviar. ${outside || "Lance tempos na grade antes."}`, true);
    discardPending();
    startJob("kaizen", prompt.count, study);
    const ask = (p) =>
      AI.generate(settings, p.text, {
        json: true,
        schema: p.schema,
        temperature: p.temperature,
        onRetry: (n, total) => setStatus(`Servidor do Gemini ocupado, tentando de novo (${n}/${total})...`),
      });
    setStatus(`Consultando o Gemini (${prompt.count} elemento(s))...`);
    try {
      let items = AI.parseKaizen(await ask(prompt), prompt.targets, study);
      let missing = AI.missingTargets(prompt.targets, items);
      if (missing.length) {
        setStatus(`A IA não respondeu ${missing.length} elemento(s); pedindo de novo só esses...`);
        try {
          const again = AI.buildKaizenPrompt(study, computed, anon, { targets: missing });
          items = items.concat(AI.parseKaizen(await ask(again), missing, study)).sort((a, b) => a.id - b.id);
          missing = AI.missingTargets(prompt.targets, items);
        } catch (err) {
          /* mantém as sugestões da 1ª resposta */
        }
      }
      showItems("kaizen", items, study);
      const ok = items.filter((i) => !i.noAction).length;
      const parts = [`${ok} sugestão(ões) para ${prompt.count} elemento(s) enviado(s).`];
      const noAct = items.length - ok;
      if (noAct) parts.push(`${noAct} sem ação (a IA indica o que observar).`);
      if (missing.length) parts.push(`Sem resposta da IA: ${missing.map((t) => t.name).join(", ")}.`);
      if (outside) parts.push(outside);
      parts.push('Confiança baixa vem desmarcada. Revise e clique em "Aplicar".');
      setStatus(parts.join(" "), !ok);
      finishJob("done");
    } catch (err) {
      setStatus(`Falha na IA: ${err.message || err}`, true);
      finishJob("error");
    }
  }

  /**
   * Etapas do processo (REV 1.25): a IA agrupa os elementos sem etapa de cada produto; a revisão
   * e a gravação são feitas na janela "Definir etapas" (nada é gravado direto).
   */
  async function runEtapas() {
    const st = app() && app().state;
    if (!st || !st.study || running()) return;
    const study = st.study;
    const computed = Calc.computeStudy(study);
    const anon = settings.anonymize !== false;
    const prompt = AI.buildEtapasPrompt(study, computed, anon);
    if (!prompt.count) return setStatus('Todos os elementos já têm etapa. Para mudar, use "Definir etapas".', true);
    discardPending();
    startJob("etapas", prompt.count, study);
    const ask = (p) =>
      AI.generate(settings, p.text, {
        json: true,
        schema: p.schema,
        temperature: p.temperature,
        onRetry: (n, total) => setStatus(`Servidor do Gemini ocupado, tentando de novo (${n}/${total})...`),
      });
    setStatus(`Consultando o Gemini (${prompt.count} elemento(s) sem etapa)...`);
    try {
      const res = AI.parseEtapas(await ask(prompt), prompt.targets, study);
      showEtapas(res, prompt, study, computed);
      finishJob("done");
    } catch (err) {
      setStatus(`Falha na IA: ${err.message || err}`, true);
      finishJob("error");
    }
  }

  /** Lista agrupada por produto e etapa, com o TP de cada etapa calculado pelo app. */
  function showEtapas(res, prompt, study, computed) {
    const items = res.items;
    pending = { kind: "etapas", items, studyId: study.id, studyName: studyName(study) };
    $("ai-results").hidden = false;
    $("ai-notes").hidden = true;
    $("btn-ai-append").hidden = true;
    $("btn-ai-apply").textContent = "Revisar e salvar…";
    $("btn-ai-apply").hidden = false;
    $("btn-ai-apply").disabled = false;
    $("ai-results-title").textContent = "Etapas sugeridas (o TP de cada etapa é calculado pelo app)";
    const u = Calc.TIME_UNITS[computed.unit] ? computed.unit : "s";
    const lbl = Calc.TIME_UNITS[u].label;
    const nodes = [];
    computed.products.forEach((p) => {
      const mine = items.filter((it) => it.target.productKey === p.key);
      if (!mine.length) return;
      const list = Calc.etapaElements(study, p.key, computed);
      const assign = new Map(mine.filter((it) => !it.noStage).map((it) => [it.target.key, it.etapa]));
      const pv = Calc.etapaPreview(study, p.key, Calc.etapaAssignPlan(study, list, assign));
      const tpOf = (name) => {
        const e = pv.etapas.find((x) => Calc.elementKey(x.name) === Calc.elementKey(name));
        return e ? ` — ${Calc.formatTime(e.tp, u)} ${lbl}` : "";
      };
      if (computed.multiProduct) nodes.push(Object.assign(document.createElement("li"), { className: "ai-group ai-group-product", textContent: p.name }));
      const names = [];
      mine.forEach((it) => !it.noStage && !names.includes(it.etapa) && names.push(it.etapa));
      names.forEach((name, gi) => {
        const why = res.why.get(Calc.elementKey(name));
        nodes.push(Object.assign(document.createElement("li"), { className: "ai-group", textContent: `${gi + 1}. ${name}${tpOf(name)}${why ? ` • ${why}` : ""}` }));
        mine.filter((it) => !it.noStage && it.etapa === name).forEach((it) => nodes.push(itemLi(it, items.indexOf(it), it.target.name, "")));
      });
      mine.filter((it) => it.noStage).forEach((it) => nodes.push(itemLi(it, items.indexOf(it), it.target.name, `Sem etapa clara: ${it.why}`)));
    });
    $("ai-list").replaceChildren(...nodes);
    const ok = items.filter((i) => !i.noStage).length;
    const missing = prompt.targets.length - items.length;
    setStatus(
      `${ok} elemento(s) com etapa sugerida de ${prompt.count} sem etapa.` +
        (items.length - ok ? ` ${items.length - ok} sem etapa clara (decida na revisão).` : "") +
        (missing > 0 ? ` A IA não respondeu ${missing} elemento(s).` : "") +
        ' Desmarque o que não concordar e clique em "Revisar e salvar…": a janela "Definir etapas" abre para ajustar nomes e salvar.',
      !ok
    );
  }

  function itemLi(it, index, title, detail) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !it.noStage;
    cb.disabled = !!it.noStage;
    cb.dataset.index = index;
    cb.id = `ai-item-${index}`;
    const label = document.createElement("label");
    label.htmlFor = cb.id;
    label.append(Object.assign(document.createElement("div"), { className: "ai-item-title", textContent: title }));
    if (detail) label.append(Object.assign(document.createElement("div"), { className: "ai-item-detail", textContent: detail }));
    li.append(cb, label);
    return li;
  }

  /** Abre o assistente e pede as etapas (botão da janela "Definir etapas"). */
  async function suggestEtapas() {
    await openDialog();
    if (!settings.apiKey || !settings.model) return setStatus("Cadastre a chave e o modelo do Gemini para a IA sugerir as etapas.", true);
    return runEtapas();
  }

  async function run(kind) {
    if (kind === "kaizen") return runKaizen();
    if (kind === "etapas") return runEtapas();
    const st = app() && app().state;
    if (!st || !st.study || running()) return;
    const study = st.study;
    const computed = Calc.computeStudy(study);
    const anon = settings.anonymize !== false;
    const build = {
      classify: AI.buildClassifyPrompt,
      notes: AI.buildNotesPrompt,
      names: AI.buildNamesPrompt,
      ask: (st2, c2, a2) => AI.buildQuestionPrompt(st2, c2, $("ai-question").value, a2),
    }[kind];
    const prompt = build(study, computed, anon);
    if (!prompt.count) {
      const msg = {
        classify: "Todos os elementos já estão classificados (ou ainda não há tempos lançados).",
        notes: "Lance tempos na grade antes de pedir as constatações.",
        names: "É preciso ter ao menos 2 elementos com tempo lançado.",
        ask: "Escreva a pergunta antes de clicar em Perguntar.",
      }[kind];
      return setStatus(msg, true);
    }
    discardPending();
    startJob(kind, kind === "ask" ? 0 : prompt.count, study);
    setStatus(`Consultando o Gemini (${prompt.count} elemento(s))...`);
    try {
      const text = await AI.generate(settings, prompt.text, {
        json: kind !== "notes" && kind !== "ask",
        onRetry: (n, total) => setStatus(`Servidor do Gemini ocupado, tentando de novo (${n}/${total})...`),
      });
      if (kind === "classify") showItems(kind, AI.parseClassify(text, prompt.names, study, anon), study);
      else if (kind === "names") showItems(kind, AI.parseNames(text, prompt.names, study, anon), study);
      else if (kind === "ask") showAnswer(AI.restoreNames(text, study), study);
      else showNotes(AI.restoreNames(text, study), study);
      finishJob("done");
    } catch (err) {
      setStatus(`Falha na IA: ${err.message || err}`, true);
      finishJob("error");
    }
  }

  function showItems(kind, items, study) {
    pending = { kind, items, studyId: study.id, studyName: studyName(study) };
    $("btn-ai-apply").disabled = false;
    $("ai-results").hidden = false;
    $("ai-notes").hidden = true;
    $("btn-ai-append").hidden = true;
    $("btn-ai-apply").textContent = "Aplicar selecionadas";
    $("btn-ai-apply").hidden = false;
    $("ai-results-title").textContent = {
      classify: "Classificação sugerida",
      kaizen: "Ações Kaizen sugeridas (ECRS)",
      names: "Nomes a padronizar (as variantes serão renomeadas para o nome padrão)",
    }[kind];
    $("ai-list").replaceChildren(
      ...items.map((it, i) => {
        const li = document.createElement("li");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        // Kaizen (REV 1.20): "sem ação" não se aplica; confiança baixa vem desmarcada
        cb.checked = !(kind === "kaizen" && (it.noAction || it.confidence === "baixa"));
        cb.disabled = kind === "kaizen" && it.noAction;
        cb.dataset.index = i;
        cb.id = `ai-item-${i}`;
        const label = document.createElement("label");
        label.htmlFor = cb.id;
        const title = document.createElement("div");
        title.className = "ai-item-title";
        title.textContent = kind === "names" ? `→ ${it.to}` : it.name;
        const detail = document.createElement("div");
        detail.className = "ai-item-detail";
        detail.textContent =
          kind === "classify"
            ? `${Calc.VALUES[it.value].label}${it.waste ? ` • ${Calc.WASTES[it.waste]}` : ""}${it.why ? ` — ${it.why}` : ""}`
            : kind === "names"
              ? `Renomear: ${it.from.map((n) => `"${n}"`).join(", ")}`
              : it.text;
        label.append(title, detail);
        if (kind === "kaizen") {
          const t = it.target;
          const where = [t.product, t.etapa, t.opLabel].filter(Boolean).join(" • ");
          if (where) title.append(Object.assign(document.createElement("span"), { className: "ai-item-where", textContent: ` — ${where}` }));
          if (it.noAction) detail.textContent = `Sem ação: falta observar — ${it.why || "dados insuficientes"}`;
          const meta = [Calc.LEAN_TOOLS[it.tool], it.confidence ? `confiança ${it.confidence === "media" ? "média" : it.confidence}` : "", it.noAction ? "" : it.why]
            .filter(Boolean)
            .join(" • ");
          if (meta) label.append(Object.assign(document.createElement("div"), { className: `ai-item-meta ai-conf-${it.confidence || "na"}`, textContent: meta }));
        }
        li.append(cb, label);
        return li;
      })
    );
    if (kind === "names" && !items.length) {
      pending = null;
      return setStatus("Nenhuma duplicidade de nomes encontrada. 👍");
    }
    if (kind === "kaizen") return; // a mensagem vem de runKaizen
    setStatus(items.length ? `${items.length} sugestão(ões). Desmarque o que não concordar e clique em "Aplicar".` : "A IA não devolveu sugestões utilizáveis.", !items.length);
  }

  function showNotes(text, study) {
    pending = { kind: "notes", text, studyId: study.id, studyName: studyName(study) };
    $("ai-results").hidden = false;
    $("ai-list").replaceChildren();
    $("ai-results-title").textContent = "Rascunho de constatações e soluções (editável)";
    $("ai-notes").hidden = false;
    $("ai-notes").value = text;
    $("btn-ai-apply").textContent = "Substituir constatações";
    $("btn-ai-apply").hidden = false;
    $("btn-ai-append").hidden = false;
    setStatus("Revise e edite o texto antes de aplicar.");
  }

  /** Resposta a uma pergunta livre: só leitura, com opção de levar para as constatações. */
  function showAnswer(text, study) {
    pending = { kind: "notes", text, studyId: study.id, studyName: studyName(study) };
    $("ai-results").hidden = false;
    $("ai-list").replaceChildren();
    $("ai-results-title").textContent = "Resposta da IA (confira os números no estudo)";
    $("ai-notes").hidden = false;
    $("ai-notes").value = text;
    $("btn-ai-apply").hidden = true;
    $("btn-ai-append").hidden = false;
    setStatus("Resposta recebida. Se quiser, acrescente-a às constatações do estudo.");
  }

  function apply(mode) {
    if (!pending || !checkStudy()) return;
    if (pending.kind === "etapas") {
      // Revisão na janela "Definir etapas" (a IA nunca grava direto)
      const draft = new Map();
      Array.from(document.querySelectorAll("#ai-list input:checked")).forEach((cb) => {
        const it = pending.items[Number(cb.dataset.index)];
        if (!it || it.noStage) return;
        if (!draft.has(it.target.productKey)) draft.set(it.target.productKey, new Map());
        draft.get(it.target.productKey).set(it.target.key, it.etapa);
      });
      const first = draft.keys().next();
      pending = null;
      job = null;
      $("ai-results").hidden = true;
      setStatus("");
      $("ai-dialog").close();
      updatePill();
      if (root.LeanEtapas) root.LeanEtapas.open({ draft, productKey: first.done ? undefined : first.value });
      return;
    }
    let n = 0;
    const report = { notFound: 0 };
    if (pending.kind === "notes") {
      const text = $("ai-notes").value.trim();
      if (!text) return;
      if (mode !== "append" && app().state.study.notes && !root.confirm("Substituir as constatações atuais pelo texto da IA?")) return;
      n = app().applyAi({ notes: { text, mode } }, report);
    } else {
      const chosen = Array.from(document.querySelectorAll("#ai-list input:checked"))
        .map((cb) => pending.items[Number(cb.dataset.index)])
        .filter((it) => !it.noAction);
      n = app().applyAi({ [pending.kind === "names" ? "rename" : pending.kind]: chosen }, report);
    }
    // Elementos renomeados ou apagados enquanto a IA trabalhava (REV 1.21)
    const lost = report.notFound ? ` ${report.notFound} sugestão(ões) não aplicada(s): elemento renomeado ou apagado na grade.` : "";
    setStatus((n ? `Aplicado (${n} alteração(ões)). O estudo foi salvo normalmente.` : "Nada a aplicar (os campos já estavam preenchidos).") + lost, !!report.notFound && !n);
    $("ai-results").hidden = true;
    pending = null;
    job = null;
    updatePill();
  }

  /* ==========================================================================
     INICIALIZAÇÃO
     ========================================================================== */

  function init() {
    const dlg = $("ai-dialog");
    openDialog = async () => {
      await loadSettings();
      refreshButtons();
      // Tarefa em andamento ou sugestões ainda não aplicadas: a janela volta como estava
      if (!job && !pending) {
        setStatus("");
        $("ai-results").hidden = true;
      }
      if (job && job.state === "error") job = null; // o detalhe do erro fica na janela
      if (!dlg.open) dlg.showModal();
      if (pending) checkStudy();
      updatePill();
    };
    $("btn-ai").addEventListener("click", openDialog);
    // O evento "close" do <dialog> chega depois: o selo é atualizado na hora
    const minimize = () => {
      dlg.close();
      updatePill();
    };
    $("btn-ai-close").addEventListener("click", minimize);
    $("btn-ai-minimize").addEventListener("click", minimize);
    $("ai-pill-open").addEventListener("click", openDialog);
    $("btn-ai-pill-discard").addEventListener("click", discardPending);
    dlg.addEventListener("close", updatePill);
    $("btn-ai-models").addEventListener("click", loadModels);
    $("btn-ai-save").addEventListener("click", saveSettings);
    $("btn-ai-forget").addEventListener("click", async () => {
      settings = { apiKey: "", model: "", anonymize: true };
      await Store.setKV(AI.SETTINGS_KEY, null);
      $("ai-key").value = "";
      $("ai-model").replaceChildren(new Option("Carregue os modelos da sua chave", ""));
      refreshButtons();
      setStatus("Chave apagada deste aparelho.");
    });
    document.querySelectorAll("[data-ai]").forEach((b) => b.addEventListener("click", () => run(b.dataset.ai)));
    $("btn-ai-apply").addEventListener("click", () => apply("replace"));
    $("btn-ai-append").addEventListener("click", () => apply("append"));
    root.addEventListener("online", refreshButtons);
    root.addEventListener("offline", refreshButtons);
  }

  root.LeanAIUI = { suggestEtapas };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof self !== "undefined" ? self : this);
