/**
 * ============================================================================
 * LEAN CHRONO & MFV — ASSISTENTE DE IA (GOOGLE GEMINI)
 * ----------------------------------------------------------------------------
 * Recurso OPCIONAL, usado só com internet e com a chave de API do próprio
 * consultor (Google AI Studio). A chave fica apenas no navegador do aparelho.
 * A IA só SUGERE: nada é aplicado ao estudo sem a aprovação do consultor, e os
 * cálculos (TS, TN, TP, takt, GBO) continuam determinísticos, sem IA.
 *
 * Usos: (1) classificar valor agregado e desperdício dos elementos;
 *       (2) sugerir ações Kaizen (ECRS); (3) redigir constatações e soluções.
 * Anonimização (padrão ligado): o nome do cliente e do posto não são enviados.
 *
 * Funções de montagem de pedido e leitura de resposta são puras (testadas no Node).
 * Depende de: LeanCalc (calc.js).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"));
  } else {
    root.LeanAI = factory(root.LeanCalc);
  }
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";

  const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
  const SETTINGS_KEY = "ai:settings";
  const VALUE_KEYS = Object.keys(Calc.VALUES); // AG | NA | IN
  const WASTE_KEYS = Object.keys(Calc.WASTES);

  /* ==========================================================================
     ANONIMIZAÇÃO
     ========================================================================== */

  /**
   * Remove do texto o NOME COMPLETO do cliente. Palavras soltas não são trocadas, para não
   * estragar descrições de processo (ex.: cliente "Laje Forte" × elemento "Forma de Lajes").
   * O nome do posto não é enviado quando a anonimização está ligada.
   */
  function anonymizeText(text, study) {
    const client = String(study.clientName || "").trim();
    if (client.length < 3) return String(text || "");
    const re = new RegExp(client.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    return String(text || "").replace(re, "[CLIENTE]");
  }

  /* ==========================================================================
     MONTAGEM DOS PEDIDOS (PROMPTS)
     ========================================================================== */

  const SYSTEM =
    "Você é um consultor sênior de Lean Manufacturing do Programa Brasil Mais Produtivo, " +
    "especialista em cronoanálise, análise de valor agregado e Mapa de Fluxo de Valor. " +
    "Responda sempre em português do Brasil, de forma técnica, objetiva e aplicável ao chão de fábrica.";

  function studyContext(study, computed, anonymize) {
    const r = computed;
    const u = Calc.TIME_UNITS[r.unit].label;
    const ctx = {
      posto: anonymize ? "[POSTO]" : study.processName || "",
      cliente: anonymize ? "[CLIENTE]" : study.clientName || "",
      unidade_tempo: u,
      takt: r.kpis.taktTime != null ? Number(Calc.toUnit(r.kpis.taktTime, r.unit).toFixed(2)) : null,
      tempo_padrao: r.kpis.standardTime != null ? Number(Calc.toUnit(r.kpis.standardTime, r.unit).toFixed(2)) : null,
      capacidade_pcs_dia: r.kpis.capacity,
      status: Calc.STATUS_LABELS[r.kpis.status],
      filmagens: r.filmCount,
      tempo_observado: Number(Calc.toUnit(r.totals.sumSubtracted, r.unit).toFixed(1)),
    };
    return ctx;
  }

  function elementRows(study, computed, anonymize, filter) {
    return computed.summary.elements.filter(filter || (() => true)).map((g) => ({
      elemento: anonymize ? anonymizeText(g.name, study) : g.name,
      tipo: g.type === "A" ? "acíclico" : "cíclico",
      ocorrencias: g.occurrences,
      tempo_no_ciclo: Number(Calc.toUnit(g.cycleTime, computed.unit).toFixed(2)),
      percentual_do_ciclo: Number(g.sharePct.toFixed(1)),
      valor_atual: g.value ? Calc.VALUES[g.value].label : null,
      desperdicio_atual: g.waste ? Calc.WASTES[g.waste] : null,
    }));
  }

  /** (1) Classificação de valor e desperdício para elementos ainda não classificados. */
  function buildClassifyPrompt(study, computed, anonymize) {
    const pending = computed.summary.elements.filter((g) => !g.value && !g.key.startsWith("#"));
    const items = elementRows(study, computed, anonymize, (g) => pending.includes(g));
    const text =
      `${SYSTEM}\n\nClassifique cada elemento de trabalho quanto ao VALOR (do ponto de vista do cliente final):\n` +
      `- "AG" = Agrega valor (transforma o produto);\n- "NA" = Não agrega (desperdício puro, eliminar);\n` +
      `- "IN" = Incidental (não agrega, mas é necessário hoje; reduzir).\n` +
      `Para NA e IN, indique o DESPERDÍCIO Lean principal entre: ${WASTE_KEYS.map((k) => `"${k}" (${Calc.WASTES[k]})`).join(", ")}. ` +
      `Para AG use desperdicio null.\n\nContexto do posto: ${JSON.stringify(studyContext(study, computed, anonymize))}\n` +
      `Elementos: ${JSON.stringify(items)}\n\n` +
      `Responda SOMENTE com JSON no formato {"itens":[{"elemento":"...","valor":"AG|NA|IN","desperdicio":"chave|null","justificativa":"até 20 palavras"}]}, ` +
      `usando exatamente o mesmo texto de "elemento" recebido.`;
    return { text, count: items.length, names: pending.map((g) => g.name) };
  }

  /** (2) Ações Kaizen (ECRS) para elementos que não agregam ou são incidentais. */
  function buildKaizenPrompt(study, computed, anonymize) {
    const targets = computed.summary.elements.filter((g) => (g.value === "NA" || g.value === "IN") && !g.key.startsWith("#"));
    const items = elementRows(study, computed, anonymize, (g) => targets.includes(g));
    const text =
      `${SYSTEM}\n\nPara cada elemento abaixo (que NÃO agrega valor ou é incidental), sugira UMA ação de melhoria ` +
      `pelo método ECRS (Eliminar, Combinar, Reorganizar, Simplificar), de baixo custo e aplicável no chão de fábrica ` +
      `(ex.: layout, kanban, SMED, 5S, poka-yoke, padronização, abastecimento no ponto de uso).\n\n` +
      `Contexto do posto: ${JSON.stringify(studyContext(study, computed, anonymize))}\nElementos: ${JSON.stringify(items)}\n\n` +
      `Responda SOMENTE com JSON no formato {"itens":[{"elemento":"...","ecrs":"Eliminar|Combinar|Reorganizar|Simplificar","acao":"até 25 palavras"}]}, ` +
      `usando exatamente o mesmo texto de "elemento" recebido.`;
    return { text, count: items.length, names: targets.map((g) => g.name) };
  }

  /** (3) Rascunho de constatações e soluções (aba "Compilação e Soluções"). */
  function buildNotesPrompt(study, computed, anonymize) {
    const c = computed.compilation;
    const u = Calc.TIME_UNITS[computed.unit].label;
    const comp = {
      por_valor: c.byValue.map((v) => ({ valor: v.label, elementos: v.count, tempo: Number(Calc.toUnit(v.time, computed.unit).toFixed(1)), percentual: Number(v.pct.toFixed(1)) })),
      por_desperdicio: c.byWaste.map((w) => ({ desperdicio: w.label, elementos: w.count, tempo: Number(Calc.toUnit(w.time, computed.unit).toFixed(1)), percentual: Number(w.pct.toFixed(1)) })),
    };
    const top = elementRows(study, computed, anonymize).sort((a, b) => b.tempo_no_ciclo - a.tempo_no_ciclo).slice(0, 12);
    const text =
      `${SYSTEM}\n\nRedija o texto de "PRINCIPAIS CONSTATAÇÕES" e "SOLUÇÕES PROPOSTAS (baixo custo)" de um estudo de cronoanálise, ` +
      `no estilo de relatório técnico de consultoria. Use os números fornecidos (tempos em ${u}), cite percentuais, ` +
      `priorize os maiores desperdícios e proponha de 4 a 6 soluções numeradas com a ferramenta Lean correspondente. ` +
      `Não invente dados que não estejam abaixo. Máximo de 220 palavras. Texto simples, sem markdown, com marcadores "•".\n\n` +
      `Contexto: ${JSON.stringify(studyContext(study, computed, anonymize))}\nCompilação: ${JSON.stringify(comp)}\n` +
      `Maiores elementos: ${JSON.stringify(top)}\n` +
      (study.notes ? `Anotações atuais do consultor (aproveite o que for útil): ${anonymize ? anonymizeText(study.notes, study) : study.notes}\n` : "");
    return { text, count: top.length };
  }

  /* ==========================================================================
     LEITURA DAS RESPOSTAS (VALIDAÇÃO RIGOROSA)
     ========================================================================== */

  function extractJson(text) {
    const s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    try {
      return JSON.parse(s);
    } catch (e) {
      const m = s.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error("A IA não devolveu JSON válido");
    }
  }

  /** Casa o nome devolvido pela IA com o elemento original (o envio pode ter sido anonimizado). */
  function matchNames(items, originalNames, study, anonymize) {
    const byKey = new Map(originalNames.map((n) => [Calc.elementKey(anonymize ? anonymizeText(n, study) : n), n]));
    return items
      .map((it) => ({ it, name: byKey.get(Calc.elementKey(it && it.elemento)) }))
      .filter((x) => x.name);
  }

  function parseClassify(text, originalNames, study, anonymize) {
    const data = extractJson(text);
    const list = Array.isArray(data.itens) ? data.itens : [];
    return matchNames(list, originalNames, study, anonymize)
      .map(({ it, name }) => {
        const value = String(it.valor || "").toUpperCase();
        if (!VALUE_KEYS.includes(value)) return null;
        const waste = value === "AG" ? "" : WASTE_KEYS.includes(it.desperdicio) ? it.desperdicio : "";
        return { name, value, waste, why: String(it.justificativa || "").slice(0, 200) };
      })
      .filter(Boolean);
  }

  function parseKaizen(text, originalNames, study, anonymize) {
    const data = extractJson(text);
    const list = Array.isArray(data.itens) ? data.itens : [];
    return matchNames(list, originalNames, study, anonymize)
      .map(({ it, name }) => {
        const action = String(it.acao || "").trim();
        if (!action) return null;
        const ecrs = ["Eliminar", "Combinar", "Reorganizar", "Simplificar"].find((e) => new RegExp(`^${e}`, "i").test(String(it.ecrs || "")));
        return { name, text: `${ecrs ? ecrs + ": " : ""}${action}`.slice(0, 240) };
      })
      .filter(Boolean);
  }

  /** Devolve o texto anonimizado ao formato original (troca [CLIENTE]/[POSTO] pelos nomes reais). */
  function restoreNames(text, study) {
    return String(text || "")
      .replace(/\[CLIENTE\]/g, study.clientName || "cliente")
      .replace(/\[POSTO\]/g, study.processName || "posto")
      .trim();
  }

  /* ==========================================================================
     CHAMADAS À API DO GEMINI
     ========================================================================== */

  function responseText(json) {
    const c = json && json.candidates && json.candidates[0];
    if (!c) {
      const block = json && json.promptFeedback && json.promptFeedback.blockReason;
      throw new Error(block ? `Pedido bloqueado pelo filtro da IA (${block})` : "Resposta vazia da IA");
    }
    return ((c.content && c.content.parts) || []).map((p) => p.text || "").join("");
  }

  async function httpError(res) {
    let detail = "";
    try {
      const j = await res.json();
      detail = (j.error && j.error.message) || "";
    } catch (e) {
      /* sem corpo */
    }
    if (res.status === 400 && /API key/i.test(detail)) return new Error("Chave de API inválida");
    if (res.status === 403) return new Error("Chave sem permissão para a API do Gemini (verifique no AI Studio)");
    if (res.status === 429) return new Error("Limite de uso da chave atingido; tente de novo em instantes");
    return new Error(`Erro ${res.status} da API do Gemini${detail ? `: ${detail}` : ""}`);
  }

  /** Lista os modelos que geram texto disponíveis para a chave (evita fixar nomes que mudam). */
  async function listModels(apiKey, fetchImpl) {
    const f = fetchImpl || fetch;
    const res = await f(`${API_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
    if (!res.ok) throw await httpError(res);
    const json = await res.json();
    return (json.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ""), label: m.displayName || m.name }))
      .filter((m) => /gemini/i.test(m.id) && !/embed|aqa|tts|image|live/i.test(m.id));
  }

  /** Sugere um modelo padrão: o mais recente "flash" estável (rápido e barato), senão o primeiro. */
  function pickDefaultModel(models) {
    const stable = models.filter((m) => !/exp|preview/i.test(m.id));
    const pool = stable.length ? stable : models;
    const flash = pool.filter((m) => /flash/i.test(m.id) && !/lite/i.test(m.id));
    const sorted = (flash.length ? flash : pool).slice().sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true }));
    return sorted.length ? sorted[0].id : "";
  }

  async function generate(settings, prompt, options, fetchImpl) {
    const f = fetchImpl || fetch;
    if (!settings || !settings.apiKey) throw new Error("Cadastre a chave de API do Gemini");
    if (!settings.model) throw new Error("Escolha um modelo do Gemini");
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: Object.assign({ temperature: 0.3 }, options && options.json ? { responseMimeType: "application/json" } : {}),
    };
    const res = await f(`${API_BASE}/models/${encodeURIComponent(settings.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await httpError(res);
    return responseText(await res.json());
  }

  return {
    API_BASE,
    SETTINGS_KEY,
    anonymizeText,
    buildClassifyPrompt,
    buildKaizenPrompt,
    buildNotesPrompt,
    parseClassify,
    parseKaizen,
    restoreNames,
    extractJson,
    listModels,
    pickDefaultModel,
    generate,
  };
});
