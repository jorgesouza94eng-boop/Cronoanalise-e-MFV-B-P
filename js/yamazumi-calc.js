/**
 * ============================================================================
 * LEAN CHRONO & MFV — MOTOR DE CÁLCULO DO YAMAZUMI (GRUPOS DE ESTUDOS)
 * ----------------------------------------------------------------------------
 * Um grupo junta estudos de cronoanálise (cada estudo = 1 operador):
 *   - "posto": vários operadores no mesmo posto (célula). Vira 1 etapa no MFV.
 *   - "linha": estudos em sequência. Cada estudo vira 1 etapa no MFV.
 * Regra confirmada pelo consultor (REV 1.9, CLAUDE.md "grupo Posto"):
 *   - Ciclo = maior TP dos estudos.
 *   - Espera = elementos com desperdício "Espera" (parcela no TP).
 *   - Conteúdo de trabalho = Σ (TP − espera).
 *   - Balanceamento = conteúdo ÷ (nº de estudos × ciclo).
 *   - Operadores ideais = conteúdo ÷ takt (takt do grupo, só para o Yamazumi).
 * Funções puras. Script clássico (window.LeanYamazumi) e CommonJS (testes).
 * Depende de: LeanCalc (calc.js).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"));
  } else {
    root.LeanYamazumi = factory(root.LeanCalc);
  }
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";

  const SCHEMA_ID = "lean-chrono-grupo";
  const SCHEMA_VERSION = 1;
  const FILE_PATTERN = /^Yamazumi_.+\.json$/i;
  const KINDS = { posto: "Posto (operadores no mesmo posto)", linha: "Linha (estudos em sequência)" };
  const SITUATIONS = { T1: "T1 — linha de base", T3: "T3 — após as melhorias" };
  const EPS = 1e-9;

  /** Classes do gráfico (ordem de empilhamento, de baixo para cima). */
  const CLASSES = {
    AG: { label: "Agrega", color: "ag" },
    IN: { label: "Incidental", color: "in" },
    NA: { label: "Não agrega", color: "na" },
    ESP: { label: "Espera", color: "esp" },
    SC: { label: "Sem classificação", color: "sc" },
    TOL: { label: "Tolerância", color: "tol" },
  };
  const CLASS_ORDER = ["AG", "IN", "NA", "ESP", "SC", "TOL"];

  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Calc.parseNumber(v);
    return Number.isFinite(n) ? n : null;
  };

  /* ==========================================================================
     MODELO DO DOCUMENTO (ARQUIVO Yamazumi_*.json)
     ========================================================================== */

  function buildFileName(clientName, name, isoDate, id) {
    const date = String(isoDate || new Date().toISOString()).slice(0, 10);
    const shortId = String(id || Calc.generateId()).replace(/-/g, "").slice(0, 8);
    return `Yamazumi_${Calc.slugify(clientName, "Cliente")}_${Calc.slugify(name, "Grupo")}_${date}_${shortId}.json`;
  }

  /** Membro do grupo: um estudo (e o produto, quando o estudo tem vários). */
  function createMember(overrides) {
    return Object.assign({ id: Calc.generateId(), studyId: "", product: "", label: "" }, overrides || {});
  }

  function createGroup(opts) {
    const o = opts || {};
    const now = o.now || new Date().toISOString();
    const id = o.id || Calc.generateId();
    return {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id,
      fileName: buildFileName(o.clientName, o.name, now, id),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      clientName: String(o.clientName || "").trim(),
      name: String(o.name || "").trim(),
      kind: KINDS[o.kind] ? o.kind : "posto",
      situation: SITUATIONS[o.situation] ? o.situation : "T1",
      timeUnit: Calc.TIME_UNITS[o.timeUnit] ? o.timeUnit : "s",
      members: (o.members || []).map((m) => createMember(m)),
      taktMin: Number.isFinite(o.taktMin) ? o.taktMin : null, // vazio = pré-preenchido pelo 1º estudo
      netTimeMin: Number.isFinite(o.netTimeMin) ? o.netTimeMin : null, // tempo líquido/dia (capacidade)
      compareWithId: "", // grupo T1 para a comparação T1 × T3
      chartMode: "classe", // "classe" | "elemento"
      notes: "",
    };
  }

  function normalizeGroup(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Conteúdo não é um objeto JSON válido" };
    if (raw.schema !== SCHEMA_ID) return { ok: false, error: "Arquivo não é um grupo Yamazumi deste aplicativo" };
    const version = Number(raw.schemaVersion);
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Versão do arquivo inválida" };
    if (version > SCHEMA_VERSION) return { ok: false, error: `Grupo criado por uma versão mais nova do aplicativo (v${version}).` };
    if (typeof raw.id !== "string" || !raw.id) return { ok: false, error: "Grupo sem identificador (id)" };
    const str = (v) => (v == null ? "" : String(v));
    const fin = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    const doc = {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id: raw.id,
      fileName:
        typeof raw.fileName === "string" && FILE_PATTERN.test(raw.fileName)
          ? raw.fileName
          : buildFileName(raw.clientName, raw.name, raw.createdAt, raw.id),
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      createdAt: str(raw.createdAt) || new Date().toISOString(),
      updatedAt: str(raw.updatedAt) || str(raw.createdAt) || new Date().toISOString(),
      clientName: str(raw.clientName),
      name: str(raw.name),
      kind: KINDS[raw.kind] ? raw.kind : "posto",
      situation: SITUATIONS[raw.situation] ? raw.situation : "T1",
      timeUnit: Calc.TIME_UNITS[raw.timeUnit] ? raw.timeUnit : "s",
      members: (Array.isArray(raw.members) ? raw.members : [])
        .filter((m) => m && typeof m === "object" && typeof m.studyId === "string" && m.studyId)
        .map((m) =>
          createMember({
            id: typeof m.id === "string" && m.id ? m.id : Calc.generateId(),
            studyId: m.studyId,
            product: str(m.product),
            label: str(m.label),
          })
        ),
      taktMin: fin(raw.taktMin),
      netTimeMin: fin(raw.netTimeMin),
      compareWithId: str(raw.compareWithId),
      chartMode: raw.chartMode === "elemento" ? "elemento" : "classe",
      notes: str(raw.notes),
    };
    return { ok: true, doc, study: doc }; // "study": nome esperado pela camada de armazenamento
  }

  /* ==========================================================================
     CÁLCULO
     ========================================================================== */

  /** Classe do elemento no Yamazumi: a Espera tem prioridade sobre o valor agregado. */
  function classOf(g) {
    if (g.waste === "espera") return "ESP";
    return Calc.VALUES[g.value] ? g.value : "SC";
  }

  /**
   * Tempos de um estudo (produto) por classe. Tudo em minutos por peça.
   *  - TN por classe = Σ TN dos elementos da classe.
   *  - Tolerância = TP − ΣTN (segmento próprio no gráfico).
   *  - Espera (parcela no TP) = TN da espera × (1 + tolerância).
   *  - Conteúdo de trabalho = TP − espera.
   *  - Movimentação + transporte = Σ TN dos elementos com esses desperdícios.
   */
  function memberMetrics(study, productKey) {
    const r = Calc.computeStudy(study);
    const p = (productKey != null && r.products.find((x) => x.key === productKey)) || (productKey ? null : r.product);
    if (!p) return { found: false, productMissing: true };
    const tolRaw = num(study.shiftParams && study.shiftParams.tolerancePct);
    const tolOk = tolRaw != null && tolRaw >= 0 && tolRaw < 100;
    const tol = tolOk ? tolRaw : 0;
    const tn = p.summary.cycleNormal;
    const tp = tn * (1 + tol / 100);
    const classes = { AG: 0, IN: 0, NA: 0, ESP: 0, SC: 0 };
    let motion = 0;
    const elements = p.summary.elements.map((g) => {
      const cls = classOf(g);
      classes[cls] += g.cycleTime;
      if (g.waste === "movimentacao" || g.waste === "transporte") motion += g.cycleTime;
      return { name: g.name, value: g.value, waste: g.waste, cls, tn: g.cycleTime };
    });
    const wait = classes.ESP * (1 + tol / 100);
    return {
      found: true,
      processName: study.processName || "",
      clientName: study.clientName || "",
      productKey: p.key,
      productName: p.name || "",
      multiProduct: r.multiProduct,
      tn,
      tp,
      tolPct: tolOk ? tolRaw : null,
      tolerance: tp - tn,
      classes,
      wait,
      content: tp - wait,
      motion,
      elements,
      unclassified: elements.filter((e) => e.cls === "SC").length,
      acyclic: p.films ? p.films.acyclic : "total",
      netTime: p.kpis.netTime,
      takt: p.kpis.taktTime,
      errorCount: r.errorCount,
    };
  }

  /**
   * Indicadores do grupo. studiesById: Map ou objeto id → estudo (formato do calc.js).
   * Retorna { members, n, cycle, content, balancePct, takt, taktPct, opsIdeal, capacityDay,
   *           hhPerPiece, pcPerHH, naPct, motion, tpSum, warnings, status }.
   */
  function computeGroup(group, studiesById) {
    const get = (id) => (studiesById instanceof Map ? studiesById.get(id) : studiesById && studiesById[id]);
    const warnings = [];
    const members = group.members.map((m, i) => {
      const study = get(m.studyId);
      const label = m.label || (group.kind === "linha" ? `Etapa ${i + 1}` : `Op. ${i + 1}`);
      if (!study) return { id: m.id, label, studyId: m.studyId, found: false };
      const mm = memberMetrics(study, m.product || "");
      if (!mm.found) return { id: m.id, label, studyId: m.studyId, found: false, productMissing: true, processName: study.processName || "" };
      return Object.assign({ id: m.id, label, studyId: m.studyId }, mm);
    });
    const ok = members.filter((m) => m.found && m.tp > EPS);
    members.forEach((m) => {
      if (!m.found) warnings.push(m.productMissing ? `${m.label}: produto não encontrado no estudo "${m.processName}"` : `${m.label}: estudo não encontrado (abra a pasta ou importe o estudo)`);
      else if (!(m.tp > EPS)) warnings.push(`${m.label}: estudo sem tempo padrão`);
    });

    const n = ok.length;
    const cycleMember = ok.reduce((a, m) => (!a || m.tp > a.tp ? m : a), null);
    const cycle = cycleMember ? cycleMember.tp : null;
    const content = ok.reduce((a, m) => a + m.content, 0);
    const tpSum = ok.reduce((a, m) => a + m.tp, 0);
    const tnSum = ok.reduce((a, m) => a + m.tn, 0);
    const naTn = ok.reduce((a, m) => a + m.classes.NA + m.classes.ESP, 0);
    const motion = ok.reduce((a, m) => a + m.motion, 0);

    // Avisos de consistência
    const clients = new Set(ok.map((m) => Calc.elementKey(m.clientName)).filter(Boolean));
    if (clients.size > 1) warnings.push("Estudos de empresas diferentes no mesmo grupo");
    const tols = new Set(ok.map((m) => (m.tolPct == null ? "?" : String(m.tolPct))));
    if (tols.size > 1) warnings.push("Estudos com tolerâncias diferentes: confira os parâmetros");
    ok.filter((m) => m.tolPct == null).forEach((m) => warnings.push(`${m.label}: tolerância inválida no estudo (usado 0%)`));
    ok.filter((m) => m.acyclic === "incompleto").forEach((m) => warnings.push(`${m.label}: peças das filmagens incompletas (acíclicos como tempo total)`));
    ok.filter((m) => m.unclassified).forEach((m) => warnings.push(`${m.label}: ${m.unclassified} elemento(s) sem classificação de valor`));
    ok.filter((m) => m.errorCount).forEach((m) => warnings.push(`${m.label}: ${m.errorCount} linha(s) com erro no estudo (fora do cálculo)`));
    if (group.kind === "posto") {
      const prods = new Set(ok.map((m) => Calc.elementKey(m.productName)));
      if (prods.size > 1) warnings.push("Estudos de produtos diferentes no mesmo posto: o ciclo só vale para o mesmo produto");
    }

    // Takt e tempo líquido do grupo; vazios = os do 1º estudo
    const first = ok[0] || null;
    const taktTyped = Number.isFinite(group.taktMin) && group.taktMin > 0;
    const takt = taktTyped ? group.taktMin : first && first.takt > 0 ? first.takt : null;
    const netTyped = Number.isFinite(group.netTimeMin) && group.netTimeMin > 0;
    const netTime = netTyped ? group.netTimeMin : first && first.netTime > 0 ? first.netTime : null;
    if (!takt) warnings.push("Informe o takt do grupo");

    const balancePct = n && cycle > EPS ? (content / (n * cycle)) * 100 : null;
    const hhPerPiece = n && cycle > EPS ? (n * cycle) / 60 : null; // horas-homem por peça
    let status = "incompleto";
    if (cycle != null && takt) status = cycle > takt + EPS ? "acima" : "atende";
    return {
      kind: group.kind,
      members,
      n,
      cycle,
      cycleLabel: cycleMember ? cycleMember.label : "",
      content,
      tpSum,
      tnSum,
      balancePct,
      takt,
      taktTyped,
      taktPct: takt && cycle != null ? (cycle / takt) * 100 : null,
      netTime,
      netTyped,
      opsIdeal: takt && n ? content / takt : null,
      capacityDay: netTime && cycle > EPS ? netTime / cycle : null,
      hhPerPiece,
      pcPerHH: hhPerPiece > EPS ? 1 / hhPerPiece : null,
      naPct: tnSum > EPS ? (naTn / tnSum) * 100 : null,
      motion: n ? motion : null,
      warnings,
      status,
    };
  }

  /** Segmentos empilhados de um membro: por classe (com tolerância) ou por elemento. */
  function segments(member, mode) {
    if (!member || !member.found) return [];
    if (mode === "elemento") {
      const list = member.elements.filter((e) => e.tn > EPS).map((e) => ({ key: e.cls, label: e.name, value: e.tn, cls: e.cls }));
      if (member.tolerance > EPS) list.push({ key: "TOL", label: CLASSES.TOL.label, value: member.tolerance, cls: "TOL" });
      return list;
    }
    return CLASS_ORDER.map((k) => ({
      key: k,
      label: CLASSES[k].label,
      value: k === "TOL" ? member.tolerance : member.classes[k],
      cls: k,
    })).filter((s) => s.value > EPS);
  }

  /**
   * Comparação T1 × T3 (antes × depois). Variação = (T3 − T1) ÷ T1 × 100.
   * better: "menor" (reduzir é melhoria) ou "maior".
   */
  function compareGroups(t1, t3) {
    const rows = [
      { key: "cycle", label: "Ciclo (maior TP)", unit: "tempo", better: "menor" },
      { key: "content", label: "Conteúdo de trabalho", unit: "tempo", better: "menor" },
      { key: "n", label: "Nº de operadores (estudos)", unit: "n", better: "menor" },
      { key: "hhPerPiece", label: "HH por peça", unit: "hh", better: "menor" },
      { key: "pcPerHH", label: "pç/HH (teórico)", unit: "pchh", better: "maior" },
      { key: "balancePct", label: "Balanceamento", unit: "pct", better: "maior" },
      { key: "naPct", label: "% Não agrega (inclui espera)", unit: "pct", better: "menor" },
      { key: "motion", label: "Movimentação + transporte (TN)", unit: "tempo", better: "menor" },
    ];
    return rows.map((row) => {
      const a = t1 ? t1[row.key] : null;
      const b = t3 ? t3[row.key] : null;
      const ok = Number.isFinite(a) && Number.isFinite(b);
      const deltaPct = ok && Math.abs(a) > EPS ? ((b - a) / a) * 100 : null;
      let verdict = null;
      if (ok) {
        if (Math.abs(b - a) <= EPS) verdict = "igual";
        else verdict = (row.better === "menor" ? b < a : b > a) ? "melhora" : "piora";
      }
      return Object.assign({}, row, { t1: Number.isFinite(a) ? a : null, t3: Number.isFinite(b) ? b : null, deltaPct, verdict });
    });
  }

  /**
   * Planilhas do Excel simples (gerador do xlsx.js): Yamazumi • Elementos • T1 x T3.
   * Tempos em SEGUNDOS, como na planilha de cronoanálise.
   */
  function buildGroupSheets(group, r, compareRows) {
    const sec = (m) => (m == null || !Number.isFinite(m) ? null : Math.round(m * 60 * 1000) / 1000);
    const pct = (v) => (v == null || !Number.isFinite(v) ? null : v / 100);
    const t = (v) => ({ v: sec(v), s: "num3" });
    const linha = group.kind === "linha";
    const ok = r.members.filter((m) => m.found && m.tp > EPS);
    const rows = [
      [{ v: `YAMAZUMI — ${group.name || "Grupo"}`, s: "title" }],
      [{ v: "Empresa", s: "label" }, group.clientName || ""],
      [{ v: "Tipo", s: "label" }, KINDS[group.kind] || ""],
      [{ v: "Situação", s: "label" }, SITUATIONS[group.situation] || ""],
      [{ v: "Takt (s/pç)", s: "label" }, t(r.takt), r.taktTyped ? "digitado no grupo" : "do 1º estudo"],
      [],
      [{ v: "INDICADORES", s: "subtitle" }],
      [{ v: linha ? "Gargalo — maior TP (s)" : "Ciclo do posto — maior TP (s)", s: "label" }, t(r.cycle), r.cycleLabel],
      [{ v: "Conteúdo de trabalho Σ(TP − espera) (s)", s: "label" }, t(r.content)],
      [{ v: "Nº de estudos (operadores)", s: "label" }, { v: r.n, s: "int" }],
      [{ v: "Balanceamento", s: "label" }, { v: pct(r.balancePct), s: "pct" }],
      [{ v: "% do takt", s: "label" }, { v: pct(r.taktPct), s: "pct" }],
      [{ v: "Operadores ideais (conteúdo ÷ takt)", s: "label" }, { v: r.opsIdeal, s: "num3" }],
      [{ v: "Capacidade (pç/dia)", s: "label" }, { v: r.capacityDay, s: "num1" }],
      [{ v: "HH por peça", s: "label" }, { v: r.hhPerPiece, s: "num3" }],
      [{ v: "% Não agrega (inclui espera)", s: "label" }, { v: pct(r.naPct), s: "pct" }],
      [],
      [{ v: "ESTUDOS DO GRUPO (tempos em segundos)", s: "subtitle" }],
      [linha ? "Etapa" : "Operador", "Posto", "Produto", "TN", "Tolerância", "TP", "Agrega", "Incidental", "Não agrega", "Espera", "Sem classe", "Conteúdo", "% do takt"].map((h) => ({ v: h, s: "header" })),
    ];
    ok.forEach((m) =>
      rows.push([
        m.label,
        m.processName,
        m.productName,
        t(m.tn),
        t(m.tolerance),
        t(m.tp),
        t(m.classes.AG),
        t(m.classes.IN),
        t(m.classes.NA),
        t(m.classes.ESP),
        t(m.classes.SC),
        t(m.content),
        { v: r.takt ? m.tp / r.takt : null, s: "pct" },
      ])
    );
    if (r.warnings.length) {
      rows.push([], [{ v: "AVISOS", s: "subtitle" }]);
      r.warnings.forEach((w) => rows.push([w]));
    }
    if (group.notes) rows.push([], [{ v: "PREMISSAS E OBSERVAÇÕES", s: "subtitle" }], [{ v: group.notes, s: "notes" }]);
    const sheets = [{ name: "Yamazumi", cols: [38, 22, 18, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11], rows }];

    const er = [[linha ? "Etapa" : "Operador", "Posto", "Elemento", "Classe", "Desperdício", "TN (s)"].map((h) => ({ v: h, s: "header" }))];
    ok.forEach((m) => m.elements.forEach((e) => er.push([m.label, m.processName, e.name, CLASSES[e.cls].label, e.waste ? Calc.WASTES[e.waste] : "", t(e.tn)])));
    sheets.push({ name: "Elementos", cols: [16, 22, 40, 18, 24, 11], rows: er, autoFilter: `A1:F${er.length}` });

    if (compareRows) {
      const cr = [["Indicador", "T1", "T3", "Variação", "Resultado"].map((h) => ({ v: h, s: "header" }))];
      const val = (row, v) => (row.unit === "tempo" ? t(v) : row.unit === "pct" ? { v: pct(v), s: "pct" } : { v, s: "num3" });
      compareRows.forEach((row) =>
        cr.push([row.label + (row.unit === "tempo" ? " (s)" : ""), val(row, row.t1), val(row, row.t3), { v: pct(row.deltaPct), s: "pct" }, row.verdict || ""])
      );
      sheets.push({ name: "T1 x T3", cols: [36, 12, 12, 12, 12], rows: cr });
    }
    return sheets;
  }

  /** JSON gravado: dados de entrada + resumo (ignorado ao carregar). */
  function serializeGroup(group, computed) {
    const round = (v, d) => (v == null || !Number.isFinite(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
    const out = Object.assign({}, group);
    if (computed) {
      out.results = {
        calculatedAt: new Date().toISOString(),
        unit: "minutos",
        operators: computed.n,
        cycleMin: round(computed.cycle, 4),
        workContentMin: round(computed.content, 4),
        balancePct: round(computed.balancePct, 2),
        taktMin: round(computed.takt, 4),
        operatorsIdeal: round(computed.opsIdeal, 3),
        capacityDay: round(computed.capacityDay, 2),
        hhPerPiece: round(computed.hhPerPiece, 5),
        nonValuePct: round(computed.naPct, 2),
        status: computed.status,
      };
    }
    return JSON.stringify(out, null, 2);
  }

  return {
    SCHEMA_ID,
    SCHEMA_VERSION,
    FILE_PATTERN,
    KINDS,
    SITUATIONS,
    CLASSES,
    CLASS_ORDER,
    buildFileName,
    createMember,
    createGroup,
    normalizeGroup,
    classOf,
    memberMetrics,
    computeGroup,
    segments,
    compareGroups,
    buildGroupSheets,
    serializeGroup,
  };
});
