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

  async function run(kind) {
    const st = app() && app().state;
    if (!st || !st.study) return;
    const study = st.study;
    const computed = Calc.computeStudy(study);
    const anon = settings.anonymize !== false;
    const build = { classify: AI.buildClassifyPrompt, kaizen: AI.buildKaizenPrompt, notes: AI.buildNotesPrompt }[kind];
    const prompt = build(study, computed, anon);
    if (!prompt.count) {
      const msg = {
        classify: "Todos os elementos já estão classificados (ou ainda não há tempos lançados).",
        kaizen: 'Nenhum elemento classificado como "Não agrega" ou "Incidental".',
        notes: "Lance tempos na grade antes de pedir as constatações.",
      }[kind];
      return setStatus(msg, true);
    }
    document.querySelectorAll("[data-ai]").forEach((b) => (b.disabled = true));
    setStatus(`Consultando o Gemini (${prompt.count} elemento(s))...`);
    try {
      const text = await AI.generate(settings, prompt.text, { json: kind !== "notes" });
      if (kind === "classify") showItems(kind, AI.parseClassify(text, prompt.names, study, anon));
      else if (kind === "kaizen") showItems(kind, AI.parseKaizen(text, prompt.names, study, anon));
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
    $("ai-results-title").textContent = kind === "classify" ? "Classificação sugerida" : "Ações Kaizen sugeridas (ECRS)";
    $("ai-list").replaceChildren(
      ...items.map((it, i) => {
        const li = document.createElement("li");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.index = i;
        cb.id = `ai-item-${i}`;
        const label = document.createElement("label");
        label.htmlFor = cb.id;
        const title = document.createElement("div");
        title.className = "ai-item-title";
        title.textContent = it.name;
        const detail = document.createElement("div");
        detail.className = "ai-item-detail";
        detail.textContent =
          kind === "classify"
            ? `${Calc.VALUES[it.value].label}${it.waste ? ` • ${Calc.WASTES[it.waste]}` : ""}${it.why ? ` — ${it.why}` : ""}`
            : it.text;
        label.append(title, detail);
        li.append(cb, label);
        return li;
      })
    );
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
    $("btn-ai-append").hidden = false;
    setStatus("Revise e edite o texto antes de aplicar.");
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
      const chosen = Array.from(document.querySelectorAll("#ai-list input:checked")).map((cb) => pending.items[Number(cb.dataset.index)]);
      n = app().applyAi(pending.kind === "classify" ? { classify: chosen } : { kaizen: chosen });
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
