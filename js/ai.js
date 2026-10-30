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
 *       (2) sugerir ações Kaizen (ECRS); (3) redigir constatações e soluções;
 *       (4) padronizar nomes de elementos; (5) perguntas livres sobre o estudo;
 *       (6) resumo executivo do MFV.
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
    const pending = computed.summary.elements.filter((g) => !g.value && !g.unnamed);
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

  /* --------------------------------------------------------------------------
     (2) AÇÕES KAIZEN (ECRS) — REV 1.20
     Todos os produtos, etapas e operadores do estudo; cada elemento com um id (a resposta
     volta pelo id, não pelo nome); regras de decisão; ferramenta Lean; justificativa com
     dado do estudo; "sem_acao" quando os dados não bastam; esquema JSON obrigatório.
     -------------------------------------------------------------------------- */

  const ECRS_LIST = ["Eliminar", "Combinar", "Reorganizar", "Simplificar"];
  const CONFIDENCE = ["alta", "media", "baixa"];

  /** Regras práticas de Lean (desperdício → ferramenta) enviadas no pedido. */
  const KAIZEN_RULES = [
    'Movimentação (buscar, pegar longe, andar) → abastecimento no ponto de uso, layout ou 5S ("5s", "layout").',
    'Transporte → aproximar processos, layout e fluxo contínuo ("layout", "fluxo").',
    'Espera → balanceamento, abastecimento puxado e trabalho padronizado ("kanban", "padronizado", "fluxo").',
    'Processamento excessivo → simplificar o método ou eliminar etapa redundante ("padronizado").',
    'Defeitos / retrabalho → qualidade na fonte e poka-yoke ("pokayoke").',
    'Estoque / superprodução → kanban e fluxo contínuo ("kanban", "fluxo").',
    'Acíclico de preparação (setup, troca, ajuste, limpeza) → TRF/SMED, passando a atividade para o tempo externo ("smed").',
    'Busca de ferramenta ou material → 5S, quadro de sombras, kit pronto ("5s").',
    'Controle, apontamento e reuniões → gestão à vista e gerenciamento diário ("gd").',
  ];

  const KAIZEN_SCHEMA = {
    type: "OBJECT",
    properties: {
      itens: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "INTEGER" },
            sem_acao: { type: "BOOLEAN" },
            ecrs: { type: "STRING", enum: ECRS_LIST },
            ferramenta: { type: "STRING", enum: Object.keys(Calc.LEAN_TOOLS) },
            acao: { type: "STRING" },
            justificativa: { type: "STRING" },
            confianca: { type: "STRING", enum: CONFIDENCE },
            falta_observar: { type: "STRING" },
          },
          required: ["id", "sem_acao"],
        },
      },
    },
    required: ["itens"],
  };

  /**
   * Elementos que vão para a IA, de todos os produtos (e operadores) do estudo, na ordem da
   * grade. Ficam de fora os que já têm ação digitada e, sem includeAll, os de "Agrega" e os
   * sem classificação. Retorna { targets, stats: { sent, withAction, ag, unclassified } }.
   */
  function kaizenTargets(study, computed, opts) {
    const all = !!(opts && opts.includeAll);
    const r = computed;
    const els = study.elements || [];
    const opOf = (row) => (r.multiOperator ? row.operator : "");
    const withAction = new Set();
    r.rows.forEach((row, i) => {
      const el = els[i];
      if (el && String(el.kaizen || "").trim()) withAction.add(`${row.productKey}|${opOf(row)}|${Calc.elementGroupKey(row, el)}`);
    });
    const targets = [];
    const stats = { sent: 0, withAction: 0, ag: 0, unclassified: 0 };
    r.products.forEach((p) => {
      const lists = p.operators ? p.operators.map((o) => ({ op: o.op, label: o.label, list: o.summary.elements })) : [{ op: null, label: "", list: p.summary.elements }];
      lists.forEach(({ op, label, list }) => {
        const named = list.filter((g) => !g.unnamed).sort((a, b) => a.firstSeq - b.firstSeq);
        named.forEach((g, i) => {
          if (withAction.has(`${p.key}|${op == null ? "" : op}|${g.key}`)) return (stats.withAction += 1);
          if (!all && g.value !== "NA" && g.value !== "IN") return g.value === "AG" ? (stats.ag += 1) : (stats.unclassified += 1);
          targets.push({
            id: targets.length + 1,
            productKey: p.key,
            product: r.multiProduct ? p.name || "" : "",
            kpis: p.kpis,
            op,
            opLabel: label,
            groupKey: g.key,
            name: g.name,
            etapa: g.etapa || "",
            order: i + 1,
            prev: i > 0 ? named[i - 1].name : "",
            next: i < named.length - 1 ? named[i + 1].name : "",
            group: g,
          });
        });
      });
    });
    stats.sent = targets.length;
    return { targets, stats };
  }

  /** Texto do que foi (e do que não foi) enviado à IA. */
  function kaizenStatsText(stats) {
    if (!stats) return "";
    const out = [];
    if (stats.withAction) out.push(`${stats.withAction} já com ação (não são substituídos)`);
    if (stats.ag) out.push(`${stats.ag} "Agrega"`);
    if (stats.unclassified) out.push(`${stats.unclassified} sem classificação`);
    const hint = stats.ag || stats.unclassified ? ' — marque "Incluir Agrega e sem classificação" para enviá-los' : "";
    return out.length ? `Fora do pedido: ${out.join(", ")}${hint}.` : "";
  }

  /**
   * Pedido de ações Kaizen. opts: { includeAll } ou { targets } (só esses elementos, ex.: os
   * que a IA não respondeu na 1ª vez). Retorna { text, count, targets, stats, schema, temperature }.
   */
  function buildKaizenPrompt(study, computed, anonymize, opts) {
    const o = opts || {};
    const sel = o.targets ? { targets: o.targets, stats: null } : kaizenTargets(study, computed, o);
    const targets = sel.targets;
    const an = (t) => (t ? (anonymize ? anonymizeText(t, study) : t) : null);
    const unit = computed.unit;
    const conv = (v) => (v == null || !Number.isFinite(v) ? null : Number(Calc.toUnit(v, unit).toFixed(2)));
    const products = new Map();
    targets.forEach((t) => {
      if (products.has(t.productKey)) return;
      const k = t.kpis || {};
      const tp = conv(k.standardTime);
      const takt = conv(k.taktTime);
      products.set(t.productKey, {
        produto: an(t.product) || "(produto único)",
        takt,
        tempo_padrao: tp,
        diferenca_tp_menos_takt: tp != null && takt != null ? Number((tp - takt).toFixed(2)) : null,
        situacao: Calc.STATUS_LABELS[k.status] || null,
      });
    });
    const context = {
      posto: anonymize ? "[POSTO]" : study.processName || "",
      cliente: anonymize ? "[CLIENTE]" : study.clientName || "",
      unidade_tempo: Calc.TIME_UNITS[unit].label,
      filmagens: computed.filmCount,
      produtos: Array.from(products.values()),
    };
    const items = targets.map((t) => ({
      id: t.id,
      produto: an(t.product),
      etapa: an(t.etapa),
      operador: t.opLabel || null,
      ordem: t.order,
      anterior: an(t.prev),
      seguinte: an(t.next),
      elemento: an(t.name),
      tipo: t.group.type === "A" ? "acíclico" : "cíclico",
      ocorrencias: t.group.occurrences,
      tempo_no_ciclo: conv(t.group.cycleTime),
      percentual_do_ciclo: Number(t.group.sharePct.toFixed(1)),
      valor: t.group.value ? Calc.VALUES[t.group.value].label : "sem classificação",
      desperdicio: t.group.waste ? Calc.WASTES[t.group.waste] : null,
    }));
    const tools = Object.keys(Calc.LEAN_TOOLS).map((k) => `"${k}" (${Calc.LEAN_TOOLS[k]})`).join(", ");
    const text =
      `${SYSTEM}\n\nTAREFA: para CADA elemento da lista, sugerir UMA ação de melhoria pelo método ECRS, tentando nesta ordem: ` +
      `Eliminar → Combinar → Reorganizar → Simplificar (use a primeira que for viável).\n\n` +
      `REGRAS:\n` +
      `1. Baixo custo e implementação rápida (dias, não meses), realidade de pequena e média indústria; sem automação nem compra de máquina.\n` +
      `2. Ação = verbo no infinitivo + o quê + onde (ex.: "Instalar suporte de bandejas ao lado da bancada de enrolar"). Máximo de 25 palavras.\n` +
      `3. Use a sequência ("anterior" e "seguinte": mesmo produto e operador, na ordem da cronoanálise): se o elemento puder ser feito junto com o vizinho, ` +
      `sugira Combinar; se a ordem gerar ida e volta ou espera, sugira Reorganizar.\n` +
      `4. Escolha a ferramenta pelas regras abaixo, entre: ${tools}.\n` +
      KAIZEN_RULES.map((t) => `   - ${t}\n`).join("") +
      `5. A justificativa (até 15 palavras) deve citar um dado recebido: tempo no ciclo, % do ciclo, ocorrências ou diferença para o takt.\n` +
      `6. Não invente medidas, distâncias, quantidades ou custos. Se os dados não bastarem para uma ação concreta, responda ` +
      `"sem_acao": true e diga em "falta_observar" o que observar no chão de fábrica.\n` +
      `7. Elemento "Agrega" transforma o produto: nunca sugira eliminá-lo; no máximo Simplificar (método, dispositivo, padronização).\n` +
      `   O campo "ecrs" é sempre UMA das quatro palavras (Eliminar, Combinar, Reorganizar, Simplificar); não use "Manter", ` +
      `combinações como "Manter/Simplificar" nem repita o ECRS no início do texto da ação.\n` +
      `8. Confiança: "alta" quando o dado e o desperdício apontam claramente a ação; "media" quando depende de confirmar no posto; ` +
      `"baixa" quando é só uma hipótese.\n` +
      `9. Priorize a profundidade nos elementos de maior % do ciclo e, quando o tempo padrão passa do takt, nos que ajudam a ficar abaixo dele.\n\n` +
      `EXEMPLO BOM: {"id":3,"sem_acao":false,"ecrs":"Eliminar","ferramenta":"5s","acao":"Fixar as facas em quadro de sombras na bancada de corte",` +
      `"justificativa":"Busca de faca: 4,2 s/pç, 12% do ciclo, 9 ocorrências","confianca":"alta"}\n` +
      `EXEMPLO RUIM (não faça): "Melhorar a organização do posto" (genérica, sem o quê nem onde).\n\n` +
      `CONTEXTO: ${JSON.stringify(context)}\nELEMENTOS: ${JSON.stringify(items)}\n\n` +
      `Responda SOMENTE com JSON {"itens":[{"id":1,"sem_acao":false,"ecrs":"Eliminar|Combinar|Reorganizar|Simplificar",` +
      `"ferramenta":"chave da lista","acao":"...","justificativa":"...","confianca":"alta|media|baixa","falta_observar":""}]}, ` +
      `com exatamente um item para cada id recebido (${targets.length} no total).`;
    return { text, count: targets.length, targets, stats: sel.stats, schema: KAIZEN_SCHEMA, temperature: 0.2 };
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

  /** (4) Padronização de nomes: agrupa variações do mesmo elemento ("Transp. material"). */
  function buildNamesPrompt(study, computed, anonymize) {
    const groups = computed.summary.elements.filter((g) => !g.unnamed);
    const items = groups.map((g) => ({ elemento: anonymize ? anonymizeText(g.name, study) : g.name, ocorrencias: g.occurrences }));
    const text =
      `${SYSTEM}\n\nNa lista de elementos de trabalho de uma cronoanálise abaixo, encontre nomes DIFERENTES que descrevem a MESMA ` +
      `atividade (abreviações, erros de digitação, plural/singular, palavras a mais). Só agrupe quando tiver certeza de que é a ` +
      `mesma atividade; atividades parecidas mas distintas (ex.: "Transporte de material" e "Transporte de peças acabadas") ` +
      `devem ficar separadas. Para cada grupo, escolha como nome padrão o mais claro e completo da própria lista.\n\n` +
      `Elementos: ${JSON.stringify(items)}\n\n` +
      `Responda SOMENTE com JSON no formato {"grupos":[{"padrao":"...","variantes":["...","..."]}]} (variantes sem o padrão; ` +
      `grupos vazios se não houver duplicidade), usando exatamente os textos recebidos.`;
    return { text, count: items.length > 1 ? items.length : 0, names: groups.map((g) => g.name) };
  }

  /** (5) Pergunta livre do consultor sobre o estudo aberto. */
  function buildQuestionPrompt(study, computed, question, anonymize) {
    const q = anonymize ? anonymizeText(question, study) : String(question || "");
    const c = computed.compilation;
    const text =
      `${SYSTEM}\n\nResponda à pergunta do consultor sobre o estudo de cronoanálise abaixo. Baseie-se SOMENTE nos dados ` +
      `fornecidos; se faltar informação, diga o que falta. Seja direto (até 180 palavras), cite números e, quando fizer ` +
      `sentido, indique a ferramenta Lean aplicável. Texto simples, sem markdown.\n\n` +
      `Contexto: ${JSON.stringify(studyContext(study, computed, anonymize))}\n` +
      `Elementos (resumo por elemento): ${JSON.stringify(elementRows(study, computed, anonymize))}\n` +
      `Compilação por valor: ${JSON.stringify(c.byValue.map((v) => ({ valor: v.label, elementos: v.count, percentual: Number(v.pct.toFixed(1)) })))}\n` +
      `Compilação por desperdício: ${JSON.stringify(c.byWaste.map((w) => ({ desperdicio: w.label, percentual: Number(w.pct.toFixed(1)) })))}\n\n` +
      `Pergunta: ${q}`;
    return { text, count: q.trim() ? 1 : 0 };
  }

  /** (6) Resumo executivo do MFV (estado presente) para o relatório ao cliente. */
  function buildMfvSummaryPrompt(doc, r, anonymize) {
    const study = { clientName: doc.clientName, processName: doc.family };
    const min = (v, d) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d == null ? 3 : d)));
    const data = {
      cliente: anonymize ? "[CLIENTE]" : doc.clientName,
      familia: doc.family,
      unidade_produto: doc.productUnit || "pç",
      tempo_disponivel_min_dia: min(r.availDayMin, 1),
      demanda_diaria: min(r.demandDaily, 2),
      takt_min: min(r.takt),
      etapas: r.steps.map((s) => ({
        etapa: anonymize ? anonymizeText(s.name, study) : s.name,
        tc_min: min(s.tc),
        operadores: min(s.opsEff, 2),
        percentual_do_takt: min(s.taktPct, 1),
        acima_do_takt: s.overTakt,
        kaizen: s.kaizen,
      })),
      tc_total_min: min(r.tcTotal),
      gargalo: r.bottleneck ? { etapa: anonymize ? anonymizeText(r.bottleneck.name, study) : r.bottleneck.name, tc_min: min(r.bottleneck.tc) } : null,
      operadores_atuais: min(r.opsTotal, 2),
      operadores_ideais: min(r.opsIdeal, 2),
      capacidade_dia: min(r.line.capacityDay, 1),
      produtividade_hora_operador: min(r.line.productivityHour, 2),
      atravessamento_dias: min(r.leadTimeDays, 2),
      estoques: r.inventories.map((i) => ({ estoque: i.name, dias: min(i.days, 2) })),
    };
    // Produtividade real (pç/HH) e payback: só entram quando medidos (nunca estimados pela IA).
    const p = r.productivity;
    if (p && p.base.pcHH != null) {
      data.produtividade_real_pc_hh = {
        linha_de_base: min(p.base.pcHH, 3),
        dias_linha_de_base: p.base.days,
        comparado: min(p.compare, 3),
        origem_comparado: p.source, // "real" (acompanhamento) | "projetado" (estimativa do consultor)
        ganho_percentual: min(p.gainPct, 1),
        meta_percentual: p.targetPct,
      };
    }
    const pb = r.payback;
    if (pb && pb.status === "ok") {
      data.payback = { meses: min(pb.months, 1), ganho_mensal_reais: min(pb.monthlyGain, 2), hh_economizadas_mes: min(pb.hhSavedMonth, 1) };
    }
    const text =
      `${SYSTEM}\n\nRedija um RESUMO EXECUTIVO do Mapa de Fluxo de Valor (estado presente) para apresentar à diretoria do cliente. ` +
      `Estrutura: (1) Situação atual em 2–3 frases (capacidade × demanda, takt × gargalo); (2) Principais pontos de atenção ` +
      `(gargalo, balanceamento, operadores atuais × ideais, estoques/atravessamento); se houver produtividade real (pç/HH), ` +
      `compare o ganho com a meta e cite o payback, deixando claro quando o valor é projetado; (3) Oportunidades e próximos passos para ` +
      `o estado futuro, com a ferramenta Lean correspondente. Use os números fornecidos e não invente dados. Linguagem ` +
      `executiva, até 230 palavras, texto simples com marcadores "•".\n\nDados do MFV: ${JSON.stringify(data)}` +
      (doc.notes ? `\nPremissas do consultor: ${anonymize ? anonymizeText(doc.notes, study) : doc.notes}` : "");
    return { text, count: r.steps.length };
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

  /**
   * Lê as ações Kaizen pelo id (REV 1.20). Item com "sem_acao" volta como { noAction, why }.
   * Retorna [{ id, target, name, text, tool, why, confidence, noAction }], na ordem dos ids.
   */
  function parseKaizen(text, targets, study) {
    const data = extractJson(text);
    const byId = new Map(targets.map((t) => [t.id, t]));
    const seen = new Set();
    const clean = (v, max) => restoreNames(String(v == null ? "" : v).replace(/\s+/g, " "), study).slice(0, max);
    const out = [];
    (Array.isArray(data.itens) ? data.itens : []).forEach((it) => {
      const id = Number(it && it.id);
      const t = byId.get(id);
      if (!t || seen.has(id)) return;
      if (it.sem_acao === true) {
        seen.add(id);
        out.push({ id, target: t, name: t.name, noAction: true, text: "", tool: "", confidence: "", why: clean(it.falta_observar || it.justificativa, 200) });
        return;
      }
      const action = clean(it.acao, 220);
      if (!action) return;
      seen.add(id);
      const ecrs = ECRS_LIST.find((e) => new RegExp(`^${e}`, "i").test(String(it.ecrs || "")));
      const conf = String(it.confianca || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      out.push({
        id,
        target: t,
        name: t.name,
        noAction: false,
        text: `${ecrs ? ecrs + ": " : ""}${action}`.slice(0, 240),
        tool: Calc.LEAN_TOOLS[it.ferramenta] ? it.ferramenta : "",
        why: clean(it.justificativa, 200),
        confidence: CONFIDENCE.includes(conf) ? conf : "",
      });
    });
    return out.sort((a, b) => a.id - b.id);
  }

  /** Elementos enviados que a IA não respondeu. */
  function missingTargets(targets, items) {
    const ids = new Set(items.map((i) => i.id));
    return targets.filter((t) => !ids.has(t.id));
  }

  /**
   * Lê os grupos de nomes. Só aceita nomes que existem no estudo; o padrão precisa ser um
   * dos nomes do grupo. Retorna [{ to, from: [nomes a renomear] }].
   */
  function parseNames(text, originalNames, study, anonymize) {
    const data = extractJson(text);
    const byKey = new Map(originalNames.map((n) => [Calc.elementKey(anonymize ? anonymizeText(n, study) : n), n]));
    const used = new Set();
    return (Array.isArray(data.grupos) ? data.grupos : [])
      .map((g) => {
        const to = byKey.get(Calc.elementKey(g && g.padrao));
        if (!to || used.has(to)) return null;
        const from = (Array.isArray(g.variantes) ? g.variantes : [])
          .map((v) => byKey.get(Calc.elementKey(v)))
          .filter((n) => n && n !== to && !used.has(n));
        if (!from.length) return null;
        [to, ...from].forEach((n) => used.add(n));
        return { to, from: Array.from(new Set(from)) };
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
    if (res.status === 503) {
      const e = new Error("Gemini sobrecarregado no momento (erro 503). Tente em alguns minutos ou escolha outro modelo em ✨ IA → configuração.");
      e.status = 503;
      return e;
    }
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

  /** Esperas antes das novas tentativas quando o Gemini responde 503 (servidor sobrecarregado). REV 1.17 */
  const RETRY_DELAYS_MS = [3000, 8000];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Gera o texto. Erro 503 (modelo sobrecarregado, em geral passageiro): tenta de novo sozinho
   * mais 2 vezes (após ~3 s e ~8 s), avisando por options.onRetry(tentativa, total). Os demais
   * erros (chave, limite 429, filtro) não são repetidos. options: { json, schema, temperature }.
   */
  async function generate(settings, prompt, options, fetchImpl) {
    const f = fetchImpl || fetch;
    const o = options || {};
    if (!settings || !settings.apiKey) throw new Error("Cadastre a chave de API do Gemini");
    if (!settings.model) throw new Error("Escolha um modelo do Gemini");
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: Object.assign(
        { temperature: o.temperature != null ? o.temperature : 0.3 },
        o.json ? { responseMimeType: "application/json" } : {},
        o.json && o.schema ? { responseSchema: o.schema } : {}
      ),
    };
    const delays = o.retryDelays || RETRY_DELAYS_MS;
    const wait = o.sleep || sleep;
    for (let attempt = 0; ; attempt++) {
      const res = await f(`${API_BASE}/models/${encodeURIComponent(settings.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
        body: JSON.stringify(body),
      });
      if (res.ok) return responseText(await res.json());
      // Modelo que não aceita o esquema JSON (REV 1.20): repete uma vez sem o esquema
      if (res.status === 400 && body.generationConfig.responseSchema) {
        delete body.generationConfig.responseSchema;
        attempt -= 1;
        continue;
      }
      const err = await httpError(res);
      if (err.status !== 503 || attempt >= delays.length) throw err;
      if (typeof o.onRetry === "function") o.onRetry(attempt + 2, delays.length + 1);
      await wait(delays[attempt]);
    }
  }

  return {
    API_BASE,
    SETTINGS_KEY,
    anonymizeText,
    buildClassifyPrompt,
    buildKaizenPrompt,
    buildNotesPrompt,
    buildNamesPrompt,
    buildQuestionPrompt,
    buildMfvSummaryPrompt,
    parseNames,
    parseClassify,
    parseKaizen,
    kaizenTargets,
    kaizenStatsText,
    missingTargets,
    restoreNames,
    extractJson,
    listModels,
    pickDefaultModel,
    generate,
    RETRY_DELAYS_MS,
  };
});
