/**
 * ============================================================================
 * LEAN CHRONO & MFV — PLANO DE AÇÃO (5W2H) — REGRAS PURAS
 * ----------------------------------------------------------------------------
 * Um plano por cliente (REV 1.19): cabeçalho (objetivo, meta, indicador, datas e
 * responsáveis) e ações 5W2H (O que, Como, Quem, Quando, Onde, Por que, Quanto,
 * % completo), mais Status, tipo ECRS, desperdício, ferramenta Lean, prioridade e
 * origem (estudo + elemento). As ações podem vir da coluna "Ação sugerida / Kaizen
 * (ECRS)" da cronoanálise; o app nunca preenche Quem, Quando, Quanto nem % completo.
 * Depende de: LeanCalc (calc.js). Também roda no Node (testes).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"));
  } else {
    root.LeanPlano = factory(root.LeanCalc);
  }
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";

  const SCHEMA_ID = "lean-chrono-plano";
  const SCHEMA_VERSION = 1;
  const FILE_PATTERN = /^Plano_.+\.json$/i;

  const ECRS = { eliminar: "Eliminar", combinar: "Combinar", reorganizar: "Reorganizar", simplificar: "Simplificar" };
  const TOOLS = Calc.LEAN_TOOLS; // mesma lista da sugestão Kaizen da IA (REV 1.20)
  const STATUS = { "nao-iniciada": "Não iniciada", andamento: "Em andamento", concluida: "Concluída", atrasada: "Atrasada" };

  const str = (v) => (v == null ? "" : String(v));
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(str(s));
  const num = (v) => {
    const n = Calc.parseNumber(v);
    return Number.isFinite(n) ? n : null;
  };

  function buildFileName(clientName, isoDate, id) {
    const date = str(isoDate || new Date().toISOString()).slice(0, 10);
    return `Plano_${Calc.slugify(clientName, "Cliente")}_${date}_${String(id).slice(0, 8)}.json`;
  }

  function createAction(overrides) {
    return Object.assign(
      {
        id: Calc.generateId(),
        what: "", // O que
        how: "", // Como
        who: "", // Quem
        start: "", // Quando — início (AAAA-MM-DD)
        end: "", // Quando — fim (AAAA-MM-DD)
        where: "", // Onde
        why: "", // Por que
        cost: "", // Quanto (R$)
        pct: "", // % completo (0–100, digitado)
        ecrs: "", // tipo ECRS da ação
        waste: "", // desperdício atacado (chave de Calc.WASTES)
        tool: "", // ferramenta Lean (chave de TOOLS)
        priority: null, // prioridade (1 = maior), pelo Pareto ao vir da cronoanálise
        origin: null, // { studyId, studyFileName, processName, product, etapa, element, kaizen }
      },
      overrides || {}
    );
  }

  function createPlan(opts) {
    const o = opts || {};
    const now = o.now || new Date().toISOString();
    const id = o.id || Calc.generateId();
    return {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id,
      fileName: buildFileName(o.clientName, now, id),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      clientName: str(o.clientName).trim(),
      objective: "Aumentar a produtividade (pç/HH) em 20%",
      targetPct: "20",
      indicator: "Produtividade (pç/HH)",
      owner: "",
      createdDate: now.slice(0, 10),
      reviewDate: "",
      reviewOwner: "",
      actions: [],
      notes: "",
    };
  }

  function normalizeOrigin(o) {
    if (!o || typeof o !== "object" || !o.studyId) return null;
    return {
      studyId: str(o.studyId),
      studyFileName: str(o.studyFileName),
      processName: str(o.processName),
      product: str(o.product),
      etapa: str(o.etapa),
      element: str(o.element),
      kaizen: str(o.kaizen),
    };
  }

  function normalizePlan(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Conteúdo não é um objeto JSON válido" };
    if (raw.schema !== SCHEMA_ID) return { ok: false, error: "Arquivo não é um plano de ação deste aplicativo" };
    const version = Number(raw.schemaVersion);
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Versão do arquivo inválida" };
    if (version > SCHEMA_VERSION) return { ok: false, error: `Plano criado por uma versão mais nova do aplicativo (v${version}).` };
    if (typeof raw.id !== "string" || !raw.id) return { ok: false, error: "Plano sem identificador (id)" };
    const doc = {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id: raw.id,
      fileName: typeof raw.fileName === "string" && FILE_PATTERN.test(raw.fileName) ? raw.fileName : buildFileName(raw.clientName, raw.createdAt, raw.id),
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      createdAt: str(raw.createdAt) || new Date().toISOString(),
      updatedAt: str(raw.updatedAt) || str(raw.createdAt) || new Date().toISOString(),
      clientName: str(raw.clientName),
      objective: str(raw.objective),
      targetPct: raw.targetPct == null ? "20" : str(raw.targetPct),
      indicator: str(raw.indicator),
      owner: str(raw.owner),
      createdDate: isDate(raw.createdDate) ? raw.createdDate : "",
      reviewDate: isDate(raw.reviewDate) ? raw.reviewDate : "",
      reviewOwner: str(raw.reviewOwner),
      actions: (Array.isArray(raw.actions) ? raw.actions : [])
        .filter((a) => a && typeof a === "object")
        .map((a) =>
          createAction({
            id: typeof a.id === "string" && a.id ? a.id : Calc.generateId(),
            what: str(a.what),
            how: str(a.how),
            who: str(a.who),
            start: isDate(a.start) ? a.start : "",
            end: isDate(a.end) ? a.end : "",
            where: str(a.where),
            why: str(a.why),
            cost: str(a.cost),
            pct: str(a.pct),
            ecrs: ECRS[a.ecrs] ? a.ecrs : "",
            waste: Calc.WASTES[a.waste] ? a.waste : "",
            tool: TOOLS[a.tool] ? a.tool : "",
            priority: Number.isInteger(a.priority) && a.priority > 0 ? a.priority : null,
            origin: normalizeOrigin(a.origin),
          })
        ),
      notes: str(raw.notes),
    };
    return { ok: true, doc, study: doc }; // "study": nome esperado pela camada de armazenamento
  }

  /* ==========================================================================
     STATUS E RESUMO
     ========================================================================== */

  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  /**
   * Status da ação (calculado, não digitado):
   *  concluída = % ≥ 100; atrasada = fim já passou e % < 100;
   *  em andamento = % > 0 ou início já chegou; não iniciada = o resto.
   */
  function actionStatus(a, today) {
    const t = today || todayIso();
    const n = num(a.pct);
    const pct = n != null && n >= 0 && n <= 100 ? n : null; // % inválido (ex.: 120) não conclui a ação
    if (pct === 100) return "concluida";
    if (isDate(a.end) && a.end < t) return "atrasada";
    if ((pct != null && pct > 0) || (isDate(a.start) && a.start <= t)) return "andamento";
    return "nao-iniciada";
  }

  /**
   * Resumo do plano. today = "AAAA-MM-DD" (padrão: hoje).
   * Retorna as ações com status e avisos, contagem por status, % médio, Σ Quanto e a
   * próxima entrega.
   */
  function computePlan(doc, today) {
    const t = today || todayIso();
    const actions = doc.actions.map((a, i) => {
      const issues = [];
      const pct = num(a.pct);
      const cost = num(a.cost);
      if (str(a.pct).trim() && (pct == null || pct < 0 || pct > 100)) issues.push("% completo deve estar entre 0 e 100");
      if (str(a.cost).trim() && (cost == null || cost < 0)) issues.push("Quanto deve ser um valor em R$ (0 ou mais)");
      if (isDate(a.start) && isDate(a.end) && a.end < a.start) issues.push("Fim antes do início");
      if (!str(a.what).trim()) issues.push("Informe O que");
      return { id: a.id, seq: i + 1, status: actionStatus(a, t), pct: pct != null && pct >= 0 && pct <= 100 ? pct : null, cost: cost != null && cost >= 0 ? cost : null, issues };
    });
    const count = { "nao-iniciada": 0, andamento: 0, concluida: 0, atrasada: 0 };
    actions.forEach((a) => (count[a.status] += 1));
    const pcts = actions.map((a) => (a.pct == null ? 0 : a.pct));
    const next = doc.actions
      .map((a, i) => ({ a, s: actions[i].status }))
      .filter((x) => x.s !== "concluida" && isDate(x.a.end) && x.a.end >= t)
      .sort((x, y) => x.a.end.localeCompare(y.a.end))[0];
    return {
      today: t,
      actions,
      count,
      total: actions.length,
      pctMean: actions.length ? pcts.reduce((s, v) => s + v, 0) / actions.length : null,
      costTotal: actions.reduce((s, a) => s + (a.cost || 0), 0),
      costInformed: actions.some((a) => a.cost != null),
      next: next ? { seq: doc.actions.indexOf(next.a) + 1, what: next.a.what, end: next.a.end } : null,
    };
  }

  /* ==========================================================================
     AÇÕES A PARTIR DA CRONOANÁLISE (coluna "Ação sugerida / Kaizen (ECRS)")
     ========================================================================== */

  /** "Reorganizar: Aplicar 5S…" → { ecrs: "reorganizar", text: "Aplicar 5S…" } (sem prefixo: ecrs ""). */
  function parseEcrs(text) {
    const s = str(text).trim();
    const m = s.match(/^(eliminar|combinar|reorganizar|simplificar)\s*[:\-–—]\s*(.*)$/i);
    return m ? { ecrs: m[1].toLowerCase(), text: m[2].trim() } : { ecrs: "", text: s };
  }

  const originKey = (o) =>
    [o.studyId, Calc.elementKey(o.product), Calc.elementKey(o.etapa), Calc.elementKey(o.element), Calc.elementKey(o.kaizen)].join("|");

  /**
   * Ações Kaizen digitadas num estudo: uma por elemento + texto da ação (o mesmo elemento com
   * a mesma ação em várias linhas = 1 ação), com o tempo no ciclo e o % do ciclo do elemento
   * no resumo (para a prioridade pelo Pareto). Linhas com erro também contam (a ação existe).
   */
  function studyCandidates(study) {
    const r = Calc.computeStudy(study);
    const els = (study && study.elements) || [];
    const map = new Map();
    els.forEach((el, i) => {
      const kaizen = str(el.kaizen).trim().replace(/\s+/g, " ");
      const name = str(el.description).trim().replace(/\s+/g, " ");
      if (!kaizen || !name) return;
      const row = r.rows[i];
      const origin = {
        studyId: study.id,
        studyFileName: str(study.fileName),
        processName: str(study.processName),
        product: row.product || "",
        etapa: row.etapa || "",
        element: name,
        kaizen,
      };
      const key = originKey(origin);
      const tool = TOOLS[el.kaizenTool] ? el.kaizenTool : "";
      if (map.has(key)) {
        if (!map.get(key).tool && tool) map.get(key).tool = tool;
        return;
      }
      const prod = r.products.find((p) => p.key === row.productKey) || r.product;
      const gKey = (row.etapaKey ? `${row.etapaKey}|` : "") + Calc.elementKey(name);
      const g = prod.summary.elements.find((x) => x.key === gKey && (x.op == null || x.op === row.operator));
      map.set(key, {
        key,
        origin,
        clientName: str(study.clientName),
        value: el.value || (g && g.value) || "",
        waste: el.waste || (g && g.waste) || "",
        cycleTime: g ? g.cycleTime : null,
        sharePct: g ? g.sharePct : null,
        unit: r.unit,
        tool, // ferramenta Lean sugerida pela IA (REV 1.20), se houver
        operator: r.multiOperator ? r.operatorLabel(row.operator).split(" ")[0] : "",
      });
    });
    return Array.from(map.values());
  }

  /** Converte uma ação Kaizen da cronoanálise em ação do plano (Quem/Quando/Quanto/% ficam em branco). */
  function actionFromCandidate(c, priority) {
    const p = parseEcrs(c.origin.kaizen);
    const where = [c.origin.processName, c.origin.product, c.origin.etapa, c.operator].filter(Boolean).join(" — ");
    const u = Calc.TIME_UNITS[c.unit] ? c.unit : "s";
    const valor = Calc.VALUES[c.value] ? Calc.VALUES[c.value].label : "";
    const desp = Calc.WASTES[c.waste] || "";
    const numbers =
      c.cycleTime != null
        ? `${Calc.formatTime(c.cycleTime, u)} ${Calc.TIME_UNITS[u].label}/pç${c.sharePct != null ? ` (${Calc.formatNumber(c.sharePct, 1)}% do ciclo)` : ""}`
        : "";
    const why = [[valor, desp].filter(Boolean).join(" / "), numbers].filter(Boolean).join(": ") || "Ação Kaizen da cronoanálise";
    return createAction({
      what: p.ecrs ? `${ECRS[p.ecrs]} — ${c.origin.element}` : c.origin.element,
      how: p.text,
      where,
      why,
      ecrs: p.ecrs,
      waste: Calc.WASTES[c.waste] ? c.waste : "",
      tool: TOOLS[c.tool] ? c.tool : "",
      priority: Number.isInteger(priority) && priority > 0 ? priority : null,
      origin: Object.assign({}, c.origin),
    });
  }

  /**
   * Situação das ações que vieram da cronoanálise: "ok", "alterada" (o texto da ação ou o
   * elemento mudou ou saiu do estudo) ou "sem-estudo" (estudo não encontrado/arquivado).
   * candidatesByStudy: Map<studyId, candidatos de studyCandidates>.
   */
  function originStatus(action, candidatesByStudy) {
    if (!action.origin) return "";
    const list = candidatesByStudy.get(action.origin.studyId);
    if (!list) return "sem-estudo";
    return list.some((c) => c.key === originKey(action.origin)) ? "ok" : "alterada";
  }

  /** Data AAAA-MM-DD → número de série do Excel (dias desde 30/12/1899). */
  function excelDate(iso) {
    if (!isDate(iso)) return null;
    const [y, m, d] = iso.split("-").map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  /** "AAAA-MM-DD" → "dd/mm/aaaa" (exibição e exportação). */
  function formatDate(iso) {
    return isDate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
  }

  /** Excel simples (sem o modelo): aba "5W2H" com todos os campos. Formato de LeanXlsx.buildWorkbook. */
  function buildPlanSheets(doc, today) {
    const r = computePlan(doc, today);
    const H = (v) => ({ v, s: "header" });
    const T = (v) => ({ v: v == null ? "" : v, s: "notes" });
    const N = (v, s) => ({ v: v == null ? "" : v, s: s || "num1" });
    const n = (v) => {
      const x = Calc.parseNumber(v);
      return Number.isFinite(x) ? x : null;
    };
    const rows = [
      [{ v: `PLANO DE AÇÃO (5W2H) — ${doc.clientName || ""}`, s: "title" }],
      [{ v: "Objetivo:", s: "label" }, T(doc.objective), { v: "Meta (%):", s: "label" }, N(n(doc.targetPct)), { v: "Indicador:", s: "label" }, T(doc.indicator)],
      [{ v: "Criação:", s: "label" }, T(formatDate(doc.createdDate)), { v: "Responsável:", s: "label" }, T(doc.owner), { v: "Revisão:", s: "label" }, T(formatDate(doc.reviewDate)), { v: "Responsável:", s: "label" }, T(doc.reviewOwner)],
      null,
      ["Nº", "Prior.", "O que", "Como", "Quem", "Início", "Fim", "Onde", "Por que", "Quanto (R$)", "% completo", "Status", "Tipo ECRS", "Desperdício", "Ferramenta Lean", "Origem"].map(H),
    ];
    doc.actions.forEach((a, i) =>
      rows.push([
        N(i + 1, "int"),
        N(a.priority, "int"),
        T(a.what),
        T(a.how),
        T(a.who),
        T(formatDate(a.start)),
        T(formatDate(a.end)),
        T(a.where),
        T(a.why),
        N(n(a.cost)),
        N(n(a.pct)),
        T(STATUS[r.actions[i].status]),
        T(ECRS[a.ecrs] || ""),
        T(Calc.WASTES[a.waste] || ""),
        T(TOOLS[a.tool] || ""),
        T(a.origin ? [a.origin.processName, a.origin.product, a.origin.etapa, a.origin.element].filter(Boolean).join(" • ") : ""),
      ])
    );
    rows.push(null, [
      { v: `Status: ${Object.keys(STATUS).map((k) => `${STATUS[k]} ${r.count[k]}`).join(" | ")} | % médio ${r.pctMean == null ? "--" : Calc.formatNumber(r.pctMean, 1)}% | Σ Quanto R$ ${Calc.formatNumber(r.costTotal, 2)}`, s: "label" },
    ]);
    if (doc.notes) rows.push([{ v: "Observações:", s: "label" }, T(doc.notes)]);
    return [{ name: "5W2H", rows, cols: [6, 7, 30, 40, 16, 11, 11, 22, 34, 13, 11, 14, 13, 18, 20, 30], merges: ["A1:H1"] }];
  }

  /** JSON gravado: dados de entrada + resumo (ignorado ao carregar). */
  function serializePlan(doc, today) {
    const r = computePlan(doc, today);
    return JSON.stringify(
      Object.assign({}, doc, {
        results: {
          calculatedAt: new Date().toISOString(),
          actions: r.total,
          byStatus: r.count,
          pctMean: r.pctMean == null ? null : Math.round(r.pctMean * 10) / 10,
          costTotal: r.costInformed ? Math.round(r.costTotal * 100) / 100 : null,
          status: doc.actions.map((a, i) => ({ seq: i + 1, what: a.what, status: r.actions[i].status })),
        },
      }),
      null,
      2
    );
  }

  return {
    SCHEMA_ID,
    SCHEMA_VERSION,
    FILE_PATTERN,
    ECRS,
    TOOLS,
    STATUS,
    buildFileName,
    createPlan,
    createAction,
    normalizePlan,
    actionStatus,
    computePlan,
    parseEcrs,
    originKey,
    studyCandidates,
    actionFromCandidate,
    originStatus,
    excelDate,
    formatDate,
    buildPlanSheets,
    serializePlan,
    todayIso,
  };
});
