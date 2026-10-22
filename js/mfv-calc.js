/**
 * ============================================================================
 * LEAN CHRONO & MFV — MOTOR DE CÁLCULO DO MAPA DE FLUXO DE VALOR (ESTADO PRESENTE)
 * ----------------------------------------------------------------------------
 * Reproduz a aba "EP" da planilha "MFV Simplificado" (B+P):
 *   horário por dia da semana → tempo disponível → demanda → takt →
 *   GBO (etapas, TC, operadores, uptime) → capacidade, produtividade →
 *   atravessamento (estoques ÷ demanda diária).
 * Funções puras. Script clássico (window.LeanMfv) e CommonJS (testes).
 * Depende de: LeanCalc (calc.js).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"));
  } else {
    root.LeanMfv = factory(root.LeanCalc);
  }
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";

  const SCHEMA_ID = "lean-chrono-mfv";
  const SCHEMA_VERSION = 5; // v2: pç/HH e payback • v3: produto do estudo vinculado • v4: payback no padrão B+P • v5: etapa de grupo Posto (Yamazumi)
  const FILE_PATTERN = /^MFV_.+\.json$/i;
  const DAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];
  const EPS = 1e-9;
  const MIX_KEY = "__mix__"; // etapa vinculada ao "Mix (TC ponderado)" de um estudo com vários produtos

  /* ==========================================================================
     ENTRADAS
     ========================================================================== */

  /**
   * Hora do relógio → minutos. Aceita "07:30", "7:30", "730", "0730", "7".
   * Vazio = null (dia sem expediente / sem parada). Retorna { minutes, error }.
   */
  function parseClock(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) return { minutes: null, error: null };
    let h;
    let m;
    if (s.includes(":")) {
      const parts = s.split(":");
      if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) {
        return { minutes: null, error: "Use HH:MM" };
      }
      h = Number(parts[0]);
      m = Number(parts[1]);
    } else {
      if (!/^\d{1,4}$/.test(s)) return { minutes: null, error: "Use HH:MM" };
      if (s.length <= 2) {
        h = Number(s);
        m = 0;
      } else {
        h = Number(s.slice(0, -2));
        m = Number(s.slice(-2));
      }
    }
    if (h > 24 || m > 59 || (h === 24 && m > 0)) return { minutes: null, error: "Horário inválido" };
    return { minutes: h * 60 + m, error: null };
  }

  function formatClock(minutes) {
    if (minutes == null || !Number.isFinite(minutes)) return "";
    const t = Math.round(minutes);
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }

  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Calc.parseNumber(v);
    return Number.isFinite(n) ? n : null;
  };

  /* ==========================================================================
     MODELO DO DOCUMENTO (ARQUIVO MFV_*.json)
     ========================================================================== */

  function buildFileName(clientName, family, isoDate, id) {
    const date = String(isoDate || new Date().toISOString()).slice(0, 10);
    const shortId = String(id || Calc.generateId()).replace(/-/g, "").slice(0, 8);
    return `MFV_${Calc.slugify(clientName, "Cliente")}_${Calc.slugify(family, "Familia")}_${date}_${shortId}.json`;
  }

  function defaultSchedule() {
    return DAYS.map((day, i) => ({
      day,
      start: i < 5 ? "07:30" : "",
      end: i < 5 ? "17:30" : "",
      breaks: i < 5 ? "00:20" : "",
      meal: i < 5 ? "01:00" : "",
    }));
  }

  /**
   * Etapa do GBO. O TC vem do estudo de cronoanálise vinculado (tcStudyMin, atualizado
   * pelo app), de um grupo Posto do Yamazumi (tcGroupMin = ciclo do posto) ou é digitado
   * (tcManualMin). source: "study" | "group" | "manual".
   * Grupo Posto: contentGroupMin = conteúdo de trabalho Σ(TP − espera); contentManualMin =
   * conteúdo digitado (prevalece).
   */
  function createStep(overrides) {
    return Object.assign(
      {
        id: Calc.generateId(),
        name: "",
        source: "manual",
        studyId: "",
        studyProduct: "", // chave do produto quando o estudo tem vários produtos
        studyOperator: 0, // REV 1.14: operador do estudo (tipo LINHA); 0 = o estudo inteiro (posto)
        contentStudyMin: null, // REV 1.14: conteúdo do posto quando o estudo tem 2+ operadores (tipo POSTO)
        studyOperators: null, // nº de operadores do estudo na última atualização
        studyFileName: "",
        tcStudyMin: null,
        tcManualMin: null,
        groupId: "",
        groupFileName: "",
        tcGroupMin: null,
        contentGroupMin: null,
        contentManualMin: null,
        groupOperators: null, // nº de estudos do grupo na última atualização
        operators: "1",
        uptimePct: "",
        kaizen: false,
      },
      overrides || {}
    );
  }

  function createInventory(overrides) {
    return Object.assign({ id: Calc.generateId(), name: "", quantity: "" }, overrides || {});
  }

  /**
   * Registro diário de produtividade real. period: "base" (linha de base, T1) ou
   * "acomp" (acompanhamento após as melhorias, T3).
   */
  function createProductivityRecord(overrides) {
    return Object.assign({ id: Calc.generateId(), date: "", period: "base", pieces: "", operators: "", hours: "" }, overrides || {});
  }

  function createMfv(opts) {
    const o = opts || {};
    const now = o.now || new Date().toISOString();
    const id = o.id || Calc.generateId();
    return {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id,
      fileName: buildFileName(o.clientName, o.family, now, id),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      clientName: String(o.clientName || "").trim(),
      family: String(o.family || "").trim(),
      productUnit: "pç",
      timeUnit: "min",
      schedule: defaultSchedule(),
      availabilityPct: "100",
      demandMonthly: "",
      workDaysMonth: "22",
      operatorsTotal: "", // vazio = soma dos operadores das etapas
      steps: [],
      inventories: [
        createInventory({ name: "Matéria-prima" }),
        createInventory({ name: "Produto acabado" }),
      ],
      notes: "",
      productivity: [],
      productivityTargetPct: "20",
      productivityProjected: "", // pç/HH esperado (estimativa até haver acompanhamento)
      paybackMethod: "bp", // "bp" (padrão do programa) | "hh" (mão de obra)
      paybackProgramCost: "", // custo do programa B+P (digitado pelo consultor)
      paybackInvestment: "", // investimentos do cliente (se houver)
      paybackProdT3: "", // produção mensal após as melhorias (vazio = estimada pelo ganho de pç/HH)
      paybackPrice: "", // preço de venda por unidade (R$)
      hhCost: "",
      paybackMonthlyProd: "", // vazio = demanda mensal
      paybackOtherGains: "",
    };
  }

  function normalizeMfv(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Conteúdo não é um objeto JSON válido" };
    if (raw.schema !== SCHEMA_ID) return { ok: false, error: "Arquivo não é um MFV deste aplicativo" };
    const version = Number(raw.schemaVersion);
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: "Versão do arquivo inválida" };
    if (version > SCHEMA_VERSION) return { ok: false, error: `MFV criado por uma versão mais nova do aplicativo (v${version}).` };
    if (typeof raw.id !== "string" || !raw.id) return { ok: false, error: "MFV sem identificador (id)" };
    const str = (v) => (v == null ? "" : String(v));
    const schedule = defaultSchedule().map((d, i) => {
      const r = (Array.isArray(raw.schedule) && raw.schedule[i]) || {};
      return { day: d.day, start: str(r.start), end: str(r.end), breaks: str(r.breaks), meal: str(r.meal) };
    });
    const doc = {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id: raw.id,
      fileName:
        typeof raw.fileName === "string" && FILE_PATTERN.test(raw.fileName)
          ? raw.fileName
          : buildFileName(raw.clientName, raw.family, raw.createdAt, raw.id),
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      createdAt: str(raw.createdAt) || new Date().toISOString(),
      updatedAt: str(raw.updatedAt) || str(raw.createdAt) || new Date().toISOString(),
      clientName: str(raw.clientName),
      family: str(raw.family),
      productUnit: str(raw.productUnit) || "pç",
      timeUnit: Calc.TIME_UNITS[raw.timeUnit] ? raw.timeUnit : "min",
      schedule,
      availabilityPct: raw.availabilityPct == null ? "100" : str(raw.availabilityPct),
      demandMonthly: str(raw.demandMonthly),
      workDaysMonth: raw.workDaysMonth == null ? "22" : str(raw.workDaysMonth),
      operatorsTotal: str(raw.operatorsTotal),
      steps: (Array.isArray(raw.steps) ? raw.steps : [])
        .filter((s) => s && typeof s === "object")
        .map((s) =>
          createStep({
            id: typeof s.id === "string" && s.id ? s.id : Calc.generateId(),
            name: str(s.name),
            source: s.source === "study" || s.source === "group" ? s.source : "manual",
            studyId: str(s.studyId),
            studyProduct: str(s.studyProduct),
            studyOperator: Number.isInteger(s.studyOperator) && s.studyOperator > 0 ? s.studyOperator : 0,
            contentStudyMin: Number.isFinite(s.contentStudyMin) ? s.contentStudyMin : null,
            studyOperators: Number.isFinite(s.studyOperators) ? s.studyOperators : null,
            studyFileName: str(s.studyFileName),
            tcStudyMin: Number.isFinite(s.tcStudyMin) ? s.tcStudyMin : null,
            tcManualMin: Number.isFinite(s.tcManualMin) ? s.tcManualMin : null,
            groupId: str(s.groupId),
            groupFileName: str(s.groupFileName),
            tcGroupMin: Number.isFinite(s.tcGroupMin) ? s.tcGroupMin : null,
            contentGroupMin: Number.isFinite(s.contentGroupMin) ? s.contentGroupMin : null,
            contentManualMin: Number.isFinite(s.contentManualMin) && s.contentManualMin > 0 ? s.contentManualMin : null,
            groupOperators: Number.isFinite(s.groupOperators) ? s.groupOperators : null,
            operators: s.operators == null ? "1" : str(s.operators),
            uptimePct: str(s.uptimePct),
            kaizen: s.kaizen === true,
          })
        ),
      inventories: (Array.isArray(raw.inventories) ? raw.inventories : [])
        .filter((s) => s && typeof s === "object")
        .map((s) => createInventory({ id: typeof s.id === "string" && s.id ? s.id : Calc.generateId(), name: str(s.name), quantity: str(s.quantity) })),
      notes: str(raw.notes),
      productivity: (Array.isArray(raw.productivity) ? raw.productivity : [])
        .filter((p) => p && typeof p === "object")
        .map((p) =>
          createProductivityRecord({
            id: typeof p.id === "string" && p.id ? p.id : Calc.generateId(),
            date: str(p.date),
            period: p.period === "acomp" ? "acomp" : "base",
            pieces: str(p.pieces),
            operators: str(p.operators),
            hours: str(p.hours),
          })
        ),
      productivityTargetPct: raw.productivityTargetPct == null ? "20" : str(raw.productivityTargetPct),
      productivityProjected: str(raw.productivityProjected),
      // Arquivos anteriores: payback pelo método das HH (o único que existia)
      paybackMethod: raw.paybackMethod === "bp" || raw.paybackMethod === "hh" ? raw.paybackMethod : raw.paybackInvestment || raw.hhCost ? "hh" : "bp",
      paybackProgramCost: str(raw.paybackProgramCost),
      paybackInvestment: str(raw.paybackInvestment),
      paybackProdT3: str(raw.paybackProdT3),
      paybackPrice: str(raw.paybackPrice),
      hhCost: str(raw.hhCost),
      paybackMonthlyProd: str(raw.paybackMonthlyProd),
      paybackOtherGains: str(raw.paybackOtherGains),
    };
    return { ok: true, doc, study: doc }; // "study": nome esperado pela camada de armazenamento
  }

  /* ==========================================================================
     CÁLCULO (ABA EP)
     ========================================================================== */

  /**
   * Regras (todas as durações em minutos):
   *  - Horas efetivas do dia = Saída − Entrada − Pausas − Refeição.
   *  - Tempo disponível/dia = média dos dias trabalhados × Disponibilidade (%).
   *  - Demanda diária = Demanda mensal ÷ Dias úteis.
   *  - Takt = Tempo disponível/dia ÷ Demanda diária.
   *  - Operadores efetivos da etapa = Nº ops × Uptime (%) [se informado].
   *  - Nº total de operadores = valor digitado (equipe compartilhada) ou soma das etapas.
   *  - Conteúdo de trabalho da etapa = TC (etapa comum) ou, no grupo Posto, Σ(TP − espera)
   *    dos estudos. TC do posto editado à mão: conteúdo × TC editado ÷ ciclo (proporcional),
   *    salvo se o conteúdo também for digitado.
   *  - Nº ideal de operadores = Σ conteúdo ÷ Takt (sem grupos, = ΣTC ÷ Takt).
   *  - Balanceamento da linha = Σ conteúdo ÷ (Nº de operadores × TC do gargalo).
   *  - Tempo de processamento = ΣTC (no posto, o ciclo).
   *  - Capacidade da linha = Tempo disponível/dia ÷ maior TC (gargalo).
   *  - Produtividade = Capacidade ÷ Nº de operadores (por dia e por hora).
   *  - Atravessamento = Σ (estoque ÷ demanda diária), em dias.
   */
  function computeMfv(doc) {
    const issues = [];

    const days = doc.schedule.map((d) => {
      const st = parseClock(d.start);
      const en = parseClock(d.end);
      const br = parseClock(d.breaks);
      const me = parseClock(d.meal);
      const errors = [st, en, br, me].filter((x) => x.error).map((x) => x.error);
      let gross = 0;
      let net = 0;
      if (!errors.length && st.minutes != null && en.minutes != null) {
        gross = en.minutes - st.minutes;
        if (gross <= 0) errors.push("Saída deve ser depois da entrada");
        net = gross - (br.minutes || 0) - (me.minutes || 0);
        if (net < 0) errors.push("Paradas maiores que o expediente");
      }
      const worked = !errors.length && net > 0;
      return { day: d.day, gross: worked ? gross : 0, net: worked ? net : 0, worked, errors };
    });

    const weekMin = days.reduce((a, d) => a + d.net, 0);
    const workedDays = days.filter((d) => d.worked).length;
    const avgDayMin = workedDays ? weekMin / workedDays : 0;
    const availPct = num(doc.availabilityPct);
    if (availPct == null || availPct <= 0 || availPct > 100) issues.push("Disponibilidade deve estar entre 1% e 100%");
    const availDayMin = availPct > 0 && availPct <= 100 ? avgDayMin * (availPct / 100) : 0;
    if (!workedDays) issues.push("Informe o horário de trabalho");

    const demandMonthly = num(doc.demandMonthly);
    const workDays = num(doc.workDaysMonth);
    const demandDaily = demandMonthly > 0 && workDays > 0 ? demandMonthly / workDays : null;
    if (demandDaily == null) issues.push("Informe a demanda mensal e os dias úteis");
    const takt = demandDaily && availDayMin > 0 ? availDayMin / demandDaily : null;

    const steps = doc.steps.map((s, i) => {
      const fromStudy = s.source === "study" && Number.isFinite(s.tcStudyMin);
      const fromGroup = s.source === "group" && Number.isFinite(s.tcGroupMin);
      const tc = fromStudy ? s.tcStudyMin : fromGroup ? s.tcGroupMin : Number.isFinite(s.tcManualMin) ? s.tcManualMin : null;
      const ops = num(s.operators);
      const uptime = num(s.uptimePct);
      const errors = [];
      if (tc == null || tc <= 0) errors.push(s.source === "study" ? "Estudo sem tempo padrão" : s.source === "group" ? "Grupo sem ciclo" : "Informe o TC");
      if (ops == null || ops < 0) errors.push("Nº de operadores inválido");
      if (uptime != null && (uptime <= 0 || uptime > 100)) errors.push("Uptime deve estar entre 1% e 100%");
      const opsEff = ops == null ? 0 : uptime > 0 && uptime <= 100 ? ops * (uptime / 100) : ops;
      // Conteúdo de trabalho (operadores ideais e balanceamento da linha)
      let content = errors.length ? null : tc;
      let contentSource = "tc";
      const warnings = [];
      // Conteúdo do posto: grupo Posto do Yamazumi ou estudo com 2+ operadores tipo POSTO (REV 1.14)
      const baseContent = s.groupId ? s.contentGroupMin : s.contentStudyMin;
      const baseTc = s.groupId ? s.tcGroupMin : s.tcStudyMin;
      const fromBase = s.groupId ? fromGroup : fromStudy;
      if ((s.groupId || Number.isFinite(s.contentStudyMin)) && !errors.length) {
        if (Number.isFinite(s.contentManualMin) && s.contentManualMin > 0) {
          content = s.contentManualMin;
          contentSource = "manual";
          warnings.push("Conteúdo de trabalho digitado à mão");
        } else if (fromBase && Number.isFinite(baseContent)) {
          content = baseContent;
          contentSource = s.groupId ? "group" : "study";
        } else if (Number.isFinite(baseContent) && baseTc > EPS) {
          content = (baseContent * tc) / baseTc;
          contentSource = "proporcional";
          warnings.push("TC do posto editado: conteúdo ajustado na mesma proporção");
        }
        if (ops > 0 && content > ops * tc + EPS) warnings.push("Conteúdo maior que Nº ops × TC: confira");
      }
      return {
        id: s.id,
        seq: i + 1,
        name: s.name || `Etapa ${i + 1}`,
        tc: errors.length ? null : tc,
        fromStudy,
        operators: ops,
        opsEff,
        content,
        contentSource,
        isGroup: !!s.groupId || Number.isFinite(s.contentStudyMin),
        warnings,
        kaizen: !!s.kaizen,
        taktPct: takt && tc ? (tc / takt) * 100 : null,
        overTakt: !!(takt && tc && tc > takt + EPS),
        errors,
      };
    });

    const valid = steps.filter((s) => s.tc != null);
    const tcTotal = valid.reduce((a, s) => a + s.tc, 0);
    const contentTotal = valid.reduce((a, s) => a + s.content, 0);
    const bottleneck = valid.reduce((m, s) => (!m || s.tc > m.tc ? s : m), null);
    // Nº total de operadores da linha: digitado (equipe compartilhada entre etapas, como na
    // planilha K37) ou, se vazio, a soma dos operadores efetivos das etapas.
    const opsSum = steps.reduce((a, s) => a + s.opsEff, 0);
    const opsTyped = num(doc.operatorsTotal);
    const opsTotal = opsTyped > 0 ? opsTyped : opsSum;
    const line = lineResults(availDayMin, bottleneck ? bottleneck.tc : null, opsTotal);
    const kaizenStep = steps.find((s) => s.kaizen) || null;
    const kaizen = kaizenStep
      ? Object.assign({ name: kaizenStep.name, tc: kaizenStep.tc, operators: kaizenStep.opsEff }, lineResults(availDayMin, kaizenStep.tc, kaizenStep.opsEff))
      : null;

    const inventories = doc.inventories.map((inv) => {
      const q = num(inv.quantity);
      return { id: inv.id, name: inv.name, quantity: q, days: q != null && demandDaily ? q / demandDaily : null };
    });
    const leadTimeDays = inventories.reduce((a, inv) => a + (inv.days || 0), 0);

    const productivity = computeProductivity(doc);
    const payback = computePayback(doc, productivity, demandMonthly);

    return {
      days,
      weekMin,
      workedDays,
      avgDayMin,
      availDayMin,
      demandDaily,
      takt,
      steps,
      tcTotal,
      bottleneck: bottleneck ? { seq: bottleneck.seq, name: bottleneck.name, tc: bottleneck.tc } : null,
      opsTotal,
      opsSum,
      opsTyped: opsTyped > 0,
      contentTotal,
      hasGroups: steps.some((s) => s.isGroup),
      opsIdeal: takt && contentTotal ? contentTotal / takt : null,
      lineBalancePct: bottleneck && opsTotal > 0 ? (contentTotal / (opsTotal * bottleneck.tc)) * 100 : null,
      line,
      kaizen,
      inventories,
      leadTimeDays,
      productivity,
      payback,
      issues,
      status: !takt || !bottleneck ? "incompleto" : bottleneck.tc > takt + EPS ? "gargalo" : "atende",
    };
  }

  /* ==========================================================================
     PRODUTIVIDADE REAL (pç/HH) E PAYBACK — comprovação da meta B+P
     ========================================================================== */

  /**
   * Produtividade real medida no chão de fábrica (não é a capacidade teórica do GBO):
   *  - HH do dia = Nº de operadores × Horas trabalhadas.
   *  - pç/HH do dia = Produção ÷ HH.
   *  - pç/HH do período = Σ produção ÷ Σ HH (média ponderada pelas horas, não média das médias).
   *  - Ganho (%) = (pç/HH acompanhamento ÷ pç/HH linha de base − 1) × 100, comparado à meta (20%).
   * Linhas incompletas não entram nas médias (sinalizadas como erro).
   */
  function computeProductivity(doc) {
    const records = (doc.productivity || []).map((p) => {
      const pieces = num(p.pieces);
      const ops = num(p.operators);
      const hours = num(p.hours);
      const blank = pieces == null && ops == null && hours == null;
      const errors = [];
      if (!blank) {
        if (pieces == null || pieces < 0) errors.push("Informe a produção do dia");
        if (ops == null || ops <= 0) errors.push("Informe o nº de operadores");
        if (hours == null || hours <= 0 || hours > 24) errors.push("Horas trabalhadas entre 0 e 24");
      }
      const valid = !blank && !errors.length;
      const hh = valid ? ops * hours : null;
      return { id: p.id, period: p.period === "acomp" ? "acomp" : "base", pieces, hh, pcHH: valid && hh > 0 ? pieces / hh : null, valid, blank, errors };
    });
    const group = (period) => {
      const list = records.filter((x) => x.valid && x.period === period);
      const pieces = list.reduce((a, x) => a + x.pieces, 0);
      const hh = list.reduce((a, x) => a + x.hh, 0);
      return { days: list.length, pieces, hh, pcHH: hh > 0 ? pieces / hh : null };
    };
    const base = group("base");
    const acomp = group("acomp");
    const projected = num(doc.productivityProjected);
    const targetRaw = num(doc.productivityTargetPct);
    const targetPct = targetRaw != null && targetRaw > 0 ? targetRaw : 20;
    // Comparação: acompanhamento real; sem ele, o pç/HH projetado (só como estimativa).
    let compare = null;
    let source = null;
    if (acomp.pcHH != null) {
      compare = acomp.pcHH;
      source = "real";
    } else if (projected != null && projected > 0) {
      compare = projected;
      source = "projetado";
    }
    const gainPct = base.pcHH > 0 && compare != null ? (compare / base.pcHH - 1) * 100 : null;
    let status = "incompleto";
    if (gainPct != null) status = gainPct + EPS >= targetPct ? "meta" : gainPct >= 0 ? "abaixo" : "queda";
    return {
      records,
      base,
      acomp,
      projected: projected > 0 ? projected : null,
      compare,
      source,
      gainPct,
      targetPct,
      targetPcHH: base.pcHH != null ? base.pcHH * (1 + targetPct / 100) : null,
      status,
      errorCount: records.filter((x) => x.errors.length).length,
    };
  }

  /**
   * Payback simples (meses) = Investimento total ÷ Ganho mensal.
   * Investimento total = custo do programa B+P (digitado; varia por porte) + investimentos do cliente.
   * Dois métodos para o ganho mensal:
   *  - "bp" (padrão do programa, Módulo T1.4 Indicadores): ganho = (produção mensal T3 − T1) × preço
   *    de venda por unidade. Sem a produção T3 medida, estima T3 = T1 × (1 + ganho de pç/HH),
   *    mantidas as HH (sempre identificado como estimativa). Ganho em faturamento, não em lucro.
   *  - "hh" (mão de obra): HH economizadas/mês = produção × (1/pç/HH base − 1/pç/HH atual);
   *    ganho = HH economizadas × custo da HH.
   *  Em ambos, somam-se os outros ganhos mensais informados.
   * Produção mensal T1: valor digitado ou, se vazio, a demanda mensal do MFV.
   */
  function computePayback(doc, prod, demandMonthly) {
    const method = doc.paybackMethod === "hh" ? "hh" : "bp";
    const programCost = num(doc.paybackProgramCost);
    const clientInv = num(doc.paybackInvestment);
    const investment = programCost == null && clientInv == null ? null : (programCost || 0) + (clientInv || 0);
    const hhCost = num(doc.hhCost);
    const typedProd = num(doc.paybackMonthlyProd);
    const monthlyProd = typedProd > 0 ? typedProd : demandMonthly > 0 ? demandMonthly : null;
    const prodT3Typed = num(doc.paybackProdT3);
    const price = num(doc.paybackPrice);
    const other = num(doc.paybackOtherGains);
    const issues = [];
    if ((programCost != null && programCost < 0) || (clientInv != null && clientInv < 0)) issues.push("Investimento não pode ser negativo");
    if (method === "hh" && hhCost != null && hhCost < 0) issues.push("Custo da HH não pode ser negativo");
    if (method === "bp" && price != null && price < 0) issues.push("Preço de venda não pode ser negativo");

    const hhSavedMonth =
      prod.base.pcHH > 0 && prod.compare > 0 && monthlyProd != null ? monthlyProd * (1 / prod.base.pcHH - 1 / prod.compare) : null;
    // Método B+P: produção T3 medida ou estimada pelo ganho de pç/HH (mesmas HH)
    let prodT3 = null;
    let prodT3Estimated = false;
    if (prodT3Typed != null && prodT3Typed >= 0) prodT3 = prodT3Typed;
    else if (monthlyProd != null && prod.gainPct != null) {
      prodT3 = monthlyProd * (1 + prod.gainPct / 100);
      prodT3Estimated = true;
    }
    const prodIncrease = monthlyProd != null && prodT3 != null ? prodT3 - monthlyProd : null;
    const salesGain = method === "bp" && prodIncrease != null && price != null && price >= 0 ? prodIncrease * price : null;
    const laborGain = method === "hh" && hhSavedMonth != null && hhCost != null && hhCost >= 0 ? hhSavedMonth * hhCost : null;
    const mainGain = method === "bp" ? salesGain : laborGain;
    const hasOther = other != null && other !== 0;
    const monthlyGain = mainGain == null && !hasOther ? null : (mainGain || 0) + (hasOther ? other : 0);

    let months = null;
    let status = "incompleto";
    if (investment == null) {
      status = "incompleto";
    } else if (issues.length) {
      status = "invalido";
    } else if (monthlyGain == null) {
      status = "incompleto";
    } else if (!(monthlyGain > EPS)) {
      status = "sem-retorno";
    } else {
      months = investment / monthlyGain;
      status = "ok";
    }
    return {
      method,
      investment,
      programCost,
      clientInvestment: clientInv,
      hhCost,
      monthlyProd,
      monthlyProdFromDemand: !(typedProd > 0) && monthlyProd != null,
      prodT3,
      prodT3Estimated,
      prodIncrease,
      price,
      salesGain,
      otherGains: hasOther ? other : 0,
      hhSavedMonth,
      laborGain,
      monthlyGain,
      annualGain: monthlyGain != null ? monthlyGain * 12 : null,
      months,
      source: method === "bp" ? (prodT3Estimated ? "estimado" : prodT3 != null ? "medido" : null) : prod.source,
      status,
      issues,
    };
  }


  /* ==========================================================================
     CONFERÊNCIA DOS VÍNCULOS (REV 1.11) — só avisos, não altera nenhum cálculo
     ========================================================================== */

  /**
   * Qualidade do tempo que um estudo entrega ao MFV. r = Calc.computeStudy(estudo);
   * productKey = "" (produto único), chave do produto ou MIX_KEY.
   * Retorna { warnings: [texto], demand: demanda diária usada no estudo (ou null) }.
   */
  function studyQuality(r, productKey) {
    const warnings = [];
    const isMix = productKey === MIX_KEY;
    const one = r.products.find((p) => p.key === productKey) || r.product;
    const products = isMix ? r.products : [one];
    products.forEach((p) => {
      const tag = r.multiProduct && p.name ? `${p.name}: ` : "";
      const els = p.summary.elements;
      if (r.mode === "quantidade" && els.some((g) => g.type === "A") && p.films.acyclic !== "por-unidade") {
        warnings.push(`${tag}acíclicos (tipo A) entram como tempo total — informe as peças de todas as filmagens`);
      }
      const unclassified = els.filter((g) => !g.value).length;
      if (unclassified) warnings.push(`${tag}${unclassified} elemento(s) sem classificação de valor`);
      if (p.summary.conflictCount) warnings.push(`${tag}${p.summary.conflictCount} elemento(s) com tipo ou valor divergente`);
    });
    if (r.errorCount) warnings.push(`${r.errorCount} linha(s) com erro, fora do cálculo`);
    // REV 1.12: produto fora do mix e mix parcial (o produto sem demanda própria não herda mais a geral)
    if (isMix && r.mix && r.mix.partial) warnings.push(`mix parcial: ${r.mix.excluded.join(", ")} fora da carga na Cronoanálise (ocupação subestimada)`);
    if (!isMix && r.multiProduct && one && one.inMix === false) warnings.push("produto fora do mix na Cronoanálise");
    const demand = isMix ? (r.mix && r.mix.demand > 0 ? r.mix.demand : null) : one && one.demand > 0 ? one.demand : null;
    return { warnings, demand };
  }

  /**
   * Avisos dos vínculos das etapas: contagem dupla do mesmo estudo, qualidade dos estudos e
   * demanda dos estudos diferente da demanda diária do MFV (o takt é da família inteira, Módulo 6).
   * lookup(step) → { label, warnings, demand, studyIds } | null  (studyIds: estudos de um grupo).
   */
  function linkChecks(doc, computed, lookup) {
    const out = [];
    const uses = new Map(); // estudo → [{ seq, name, product, via, op }]
    const mismatch = [];
    const netMismatch = []; // REV 1.14 (8.4): tempo líquido do estudo × tempo disponível do MFV
    doc.steps.forEach((s, i) => {
      const seq = i + 1;
      const name = s.name || `Etapa ${seq}`;
      const info = lookup(s);
      const add = (id, product, via, op) => {
        if (!uses.has(id)) uses.set(id, []);
        uses.get(id).push({ seq, name, product, via, op: op || 0 });
      };
      if (s.studyId) add(s.studyId, s.studyProduct || "", "etapa", s.studyOperator);
      if (s.groupId && info && info.studyIds) info.studyIds.forEach((id) => add(id, null, "grupo"));
      if (!info) return;
      info.warnings.forEach((w) => out.push({ kind: "estudo", seq, text: `${seq}. ${name}: ${w}` }));
      const dd = computed.demandDaily;
      if (s.studyId && dd > 0 && info.demand > 0 && Math.abs(info.demand - dd) / dd > 0.01) {
        mismatch.push(`${seq}. ${name} (${Calc.formatNumber(info.demand, 1)}/dia)`);
      }
      const av = computed.availDayMin;
      if (s.studyId && av > 0 && info.netTime > 0 && Math.abs(info.netTime - av) > 0.5) {
        netMismatch.push(`${seq}. ${name} (${Calc.formatNumber(info.netTime, 0)} min)`);
      }
    });
    uses.forEach((all) => {
      if (all.length < 2) return;
      // Tipo LINHA: etapas de operadores diferentes do mesmo estudo são válidas
      const whole = all.filter((u) => !u.op);
      const byOp = {};
      all.filter((u) => u.op).forEach((u) => (byOp[u.op] = (byOp[u.op] || []).concat([u])));
      const repeatedOp = Object.values(byOp).find((l) => l.length > 1);
      if (whole.length < 2 && !(whole.length && Object.keys(byOp).length) && !repeatedOp) return;
      const list = repeatedOp && whole.length < 2 && !(whole.length && Object.keys(byOp).length) ? repeatedOp : all;
      const steps = list.map((u) => `${u.seq}. ${u.name}`).join(" e ");
      const viaGroup = list.some((u) => u.via === "grupo");
      const mix = list.some((u) => u.product === MIX_KEY) && list.some((u) => u.product != null && u.product !== MIX_KEY);
      const text = viaGroup
        ? `Contagem dupla: o mesmo estudo está no grupo e em outra etapa (${steps})`
        : mix
          ? `Contagem dupla: Mix e produto(s) do mesmo estudo como etapas separadas (${steps}) — use só o Mix ou só os produtos`
          : `Contagem dupla: o mesmo posto em mais de uma etapa (${steps}) — para o posto que faz vários produtos, use o Mix`;
      out.unshift({ kind: "duplo", text });
    });
    if (netMismatch.length) {
      out.push({
        kind: "tempo",
        text:
          `Tempo disponível do MFV (${Calc.formatNumber(computed.availDayMin, 0)} min/dia) diferente do tempo líquido dos estudos: ${netMismatch.join(", ")}. ` +
          "O takt do estudo e o do MFV não são comparáveis: confira a jornada e as paradas.",
      });
    }
    if (mismatch.length) {
      out.push({
        kind: "demanda",
        text:
          `Demanda diária do MFV (${Calc.formatNumber(computed.demandDaily, 1)}/dia) diferente da usada nos estudos: ${mismatch.join(", ")}. ` +
          "O takt do MFV usa a demanda da família inteira (Módulo 6): confira a demanda mensal e os dias úteis.",
      });
    }
    return out;
  }

  /** Capacidade e produtividade para um TC limitante e um nº de operadores. */
  function lineResults(availDayMin, tcLimit, operators) {
    const capDay = availDayMin > 0 && tcLimit > 0 ? availDayMin / tcLimit : null;
    const hours = availDayMin / 60;
    return {
      capacityDay: capDay,
      capacityHour: capDay != null && hours > 0 ? capDay / hours : null,
      productivityDay: capDay != null && operators > 0 ? capDay / operators : null,
      productivityHour: capDay != null && operators > 0 && hours > 0 ? capDay / operators / hours : null,
    };
  }

  /** JSON gravado: dados de entrada + resumo (ignorado ao carregar). */
  function serializeMfv(doc) {
    const r = computeMfv(doc);
    const round = (n, d) => (n == null || !Number.isFinite(n) ? null : Math.round(n * Math.pow(10, d)) / Math.pow(10, d));
    return JSON.stringify(
      Object.assign({}, doc, {
        results: {
          calculatedAt: new Date().toISOString(),
          unit: "minutos",
          availableMinDay: round(r.availDayMin, 3),
          demandDaily: round(r.demandDaily, 3),
          taktMin: round(r.takt, 4),
          cycleTimeTotalMin: round(r.tcTotal, 4),
          workContentMin: round(r.contentTotal, 4),
          lineBalancePct: round(r.lineBalancePct, 2),
          bottleneck: r.bottleneck,
          operatorsTotal: round(r.opsTotal, 3),
          operatorsIdeal: round(r.opsIdeal, 3),
          capacityDay: round(r.line.capacityDay, 2),
          productivityHourOperator: round(r.line.productivityHour, 3),
          leadTimeDays: round(r.leadTimeDays, 2),
          status: r.status,
          productivity: {
            basePcHH: round(r.productivity.base.pcHH, 4),
            followUpPcHH: round(r.productivity.acomp.pcHH, 4),
            comparedWith: r.productivity.source,
            gainPct: round(r.productivity.gainPct, 2),
            targetPct: r.productivity.targetPct,
            status: r.productivity.status,
          },
          payback: {
            method: r.payback.method,
            investment: round(r.payback.investment, 2),
            productionIncreaseMonth: round(r.payback.prodIncrease, 2),
            productionT3Estimated: r.payback.prodT3Estimated,
            hhSavedMonth: round(r.payback.hhSavedMonth, 2),
            monthlyGain: round(r.payback.monthlyGain, 2),
            months: round(r.payback.months, 2),
            status: r.payback.status,
          },
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
    MIX_KEY,
    DAYS,
    parseClock,
    formatClock,
    buildFileName,
    createMfv,
    createStep,
    createInventory,
    createProductivityRecord,
    normalizeMfv,
    computeProductivity,
    computePayback,
    computeMfv,
    studyQuality,
    linkChecks,
    serializeMfv,
  };
});
