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
  let pending = null; // { kind, items, text }

  function app() {
    return root.LeanApp;
  }

  function setStatus(text, isError) {
    const el = $("ai-status");
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function refreshButtons() {
    const online = root.navigator.onLine !== false;
    const ready = !!(settings.apiKey && settings.model);
    document.querySelectorAll("[data-ai]").forEach((b) => (b.disabled = !online || !ready));
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
    if (!st || !st.study) return;
    const study = st.study;
    const computed = Calc.computeStudy(study);
    const anon = settings.anonymize !== false;
    const prompt = AI.buildKaizenPrompt(study, computed, anon, { includeAll: $("ai-kaizen-all").checked });
    const outside = AI.kaizenStatsText(prompt.stats);
    if (!prompt.count) return setStatus(`Nenhum elemento para enviar. ${outside || "Lance tempos na grade antes."}`, true);
    document.querySelectorAll("[data-ai]").forEach((b) => (b.disabled = true));
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
      showItems("kaizen", items);
      const ok = items.filter((i) => !i.noAction).length;
      const parts = [`${ok} sugestão(ões) para ${prompt.count} elemento(s) enviado(s).`];
      const noAct = items.length - ok;
      if (noAct) parts.push(`${noAct} sem ação (a IA indica o que observar).`);
      if (missing.length) parts.push(`Sem resposta da IA: ${missing.map((t) => t.name).join(", ")}.`);
      if (outside) parts.push(outside);
      parts.push('Confiança baixa vem desmarcada. Revise e clique em "Aplicar".');
      setStatus(parts.join(" "), !ok);
    } catch (err) {
      setStatus(`Falha na IA: ${err.message || err}`, true);
    } finally {
      refreshButtons();
    }
  }

  async function run(kind) {
    if (kind === "kaizen") return runKaizen();
    const st = app() && app().state;
    if (!st || !st.study) return;
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
    document.querySelectorAll("[data-ai]").forEach((b) => (b.disabled = true));
    setStatus(`Consultando o Gemini (${prompt.count} elemento(s))...`);
    try {
      const text = await AI.generate(settings, prompt.text, {
        json: kind !== "notes" && kind !== "ask",
        onRetry: (n, total) => setStatus(`Servidor do Gemini ocupado, tentando de novo (${n}/${total})...`),
      });
      if (kind === "classify") showItems(kind, AI.parseClassify(text, prompt.names, study, anon));
      else if (kind === "names") showItems(kind, AI.parseNames(text, prompt.names, study, anon));
      else if (kind === "ask") showAnswer(AI.restoreNames(text, study));
      else showNotes(AI.restoreNames(text, study));
    } catch (err) {
      setStatus(`Falha na IA: ${err.message || err}`, true);
    } finally {
      refreshButtons();
    }
  }

  function showItems(kind, items) {
    pending = { kind, items };
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
    if (kind === "names" && !items.length) return setStatus("Nenhuma duplicidade de nomes encontrada. 👍");
    if (kind === "kaizen") return; // a mensagem vem de runKaizen
    setStatus(items.length ? `${items.length} sugestão(ões). Desmarque o que não concordar e clique em "Aplicar".` : "A IA não devolveu sugestões utilizáveis.", !items.length);
  }

  function showNotes(text) {
    pending = { kind: "notes", text };
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
  function showAnswer(text) {
    pending = { kind: "notes", text };
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
    if (!pending) return;
    let n = 0;
    if (pending.kind === "notes") {
      const text = $("ai-notes").value.trim();
      if (!text) return;
      if (mode !== "append" && app().state.study.notes && !root.confirm("Substituir as constatações atuais pelo texto da IA?")) return;
      n = app().applyAi({ notes: { text, mode } });
    } else {
      const chosen = Array.from(document.querySelectorAll("#ai-list input:checked"))
        .map((cb) => pending.items[Number(cb.dataset.index)])
        .filter((it) => !it.noAction);
      n = app().applyAi({ [pending.kind === "names" ? "rename" : pending.kind]: chosen });
    }
    setStatus(n ? `Aplicado (${n} alteração(ões)). O estudo foi salvo normalmente.` : "Nada a aplicar (os campos já estavam preenchidos).");
    $("ai-results").hidden = true;
    pending = null;
  }

  /* ==========================================================================
     INICIALIZAÇÃO
     ========================================================================== */

  function init() {
    const dlg = $("ai-dialog");
    $("btn-ai").addEventListener("click", async () => {
      await loadSettings();
      refreshButtons();
      setStatus("");
      $("ai-results").hidden = true;
      if (!dlg.open) dlg.showModal();
    });
    $("btn-ai-close").addEventListener("click", () => dlg.close());
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof self !== "undefined" ? self : this);
