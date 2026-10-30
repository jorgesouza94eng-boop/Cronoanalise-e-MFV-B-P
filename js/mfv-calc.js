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
  const SCHEMA_VERSION = 6; // v2: pç/HH e payback • v3: produto do estudo vinculado • v4: payback no padrão B+P • v5: etapa de grupo Posto (Yamazumi) • v6: ponderação, operador compartilhado e etapa não medida (REV 1.14)
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
        studyEtapa: "", // REV 1.15: chave da etapa do processo no estudo ("" = o produto inteiro)
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
        weighted: false, // REV 1.14: TC = TP × demanda própria do produto ÷ demanda diária da família
        studyDemand: null, // demanda própria do produto (pç/dia) na última atualização; null = sem demanda própria
        operatorTag: "", // REV 1.14: operador compartilhado entre etapas (ex.: "Op1")
        unmeasured: false, // REV 1.14: etapa não medida (só nome e posição no fluxo; fora dos cálculos)
      },
      overrides || {}
    );
  }

  // Posição do estoque no fluxograma (REV 1.24): id da etapa seguinte, início ou fim do fluxo
  const FLOW_START = "__start";
  const FLOW_END = "__end";

  function createInventory(overrides) {
    // beforeStepId: "" = sem posição no fluxograma (o app não adivinha)
    return Object.assign({ id: Calc.generateId(), name: "", quantity: "", beforeStepId: "" }, overrides || {});
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
        createInventory({ name: "Matéria-prima", beforeStepId: FLOW_START }),
        createInventory({ name: "Produto acabado", beforeStepId: FLOW_END }),
      ],
      flowShowData: true, // REV 1.24: fluxograma com os dados das etapas e dos estoques
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
            studyEtapa: str(s.studyEtapa),
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
            kaizen: s.kaizen === true && s.unmeasured !== true,
            weighted: s.weighted === true,
            studyDemand: Number.isFinite(s.studyDemand) && s.studyDemand > 0 ? s.studyDemand : null,
            operatorTag: str(s.operatorTag).trim(),
            unmeasured: s.unmeasured === true,
          })
        ),
      inventories: (Array.isArray(raw.inventories) ? raw.inventories : [])
        .filter((s) => s && typeof s === "object")
        .map((s) =>
          createInventory({ id: typeof s.id === "string" && s.id ? s.id : Calc.generateId(), name: str(s.name), quantity: str(s.quantity), beforeStepId: str(s.beforeStepId) })
        ),
      flowShowData: raw.flowShowData !== false,
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
      // Etapa não medida (REV 1.14): só nome e posição no fluxo, fora de todos os cálculos
      if (s.unmeasured) {
        return {
          id: s.id, seq: i + 1, name: s.name || `Etapa ${i + 1}`, unmeasured: true, tc: null, tcOriginal: null, weight: null,
          fromStudy: false, operators: null, opsEff: 0, content: null, contentSource: "", isGroup: false, operatorTag: "",
          warnings: [], kaizen: false, taktPct: null, overTakt: false, errors: [],
        };
      }
      const fromStudy = s.source === "study" && Number.isFinite(s.tcStudyMin);
      const fromGroup = s.source === "group" && Number.isFinite(s.tcGroupMin);
      const tcRaw = fromStudy ? s.tcStudyMin : fromGroup ? s.tcGroupMin : Number.isFinite(s.tcManualMin) ? s.tcManualMin : null;
      const ops = num(s.operators);
      const uptime = num(s.uptimePct);
      const errors = [];
      const warnings = [];
      if (tcRaw == null || tcRaw <= 0) errors.push(s.source === "study" ? "Estudo sem tempo padrão" : s.source === "group" ? "Grupo sem ciclo" : "Informe o TC");
      // TC ponderado pela demanda do produto (REV 1.14): TP × demanda própria ÷ demanda diária da família.
      // Não se aplica ao Mix (já ponderado) nem ao TC digitado. Sem demanda própria: "--" (não herda a geral).
      let weight = null;
      if (s.weighted && fromStudy && s.studyProduct !== MIX_KEY && !errors.length) {
        if (!(s.studyDemand > 0)) errors.push("Informe a demanda do produto na Cronoanálise (ponderação pela demanda)");
        else if (!(demandDaily > 0)) errors.push("Informe a demanda do MFV (ponderação pela demanda do produto)");
        else {
          weight = { demand: s.studyDemand, family: demandDaily, factor: s.studyDemand / demandDaily };
          if (weight.factor > 1 + EPS) warnings.push("Demanda do produto maior que a da família: confira a demanda do MFV");
        }
      }
      const tc = tcRaw == null ? null : weight ? tcRaw * weight.factor : tcRaw;
      if (ops == null || ops < 0) errors.push("Nº de operadores inválido");
      if (uptime != null && (uptime <= 0 || uptime > 100)) errors.push("Uptime deve estar entre 1% e 100%");
      const opsEff = ops == null ? 0 : uptime > 0 && uptime <= 100 ? ops * (uptime / 100) : ops;
      // Conteúdo de trabalho (operadores ideais e balanceamento da linha)
      let content = errors.length ? null : tc;
      let contentSource = "tc";
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
          content = weight ? baseContent * weight.factor : baseContent;
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
        tcOriginal: errors.length ? null : tcRaw, // TP original (tempo de processamento do lead time)
        weight,
        unmeasured: false,
        operatorTag: String(s.operatorTag || "").trim(),
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
    // Tempo de processamento (lead time): Σ TP original, mesmo com a ponderação pela demanda
    const processTotal = valid.reduce((a, s) => a + s.tcOriginal, 0);
    const contentTotal = valid.reduce((a, s) => a + s.content, 0);

    // Operador compartilhado entre etapas (REV 1.14): carga = Σ TC das etapas dele; conta 1 pessoa
    const sharedMap = new Map();
    steps.forEach((s) => {
      if (s.unmeasured || !s.operatorTag) return;
      const key = s.operatorTag.toLowerCase();
      if (!sharedMap.has(key)) sharedMap.set(key, { label: s.operatorTag, all: [], steps: [] });
      const o = sharedMap.get(key);
      o.all.push(s);
      if (s.tc != null) o.steps.push(s);
      if (s.operators != null && Math.abs(s.operators - 1) > EPS) s.warnings.push(`Etapa do operador ${s.operatorTag}: o Nº ops da linha não entra (o operador conta 1 pessoa)`);
    });
    const sharedOperators = Array.from(sharedMap.values()).map((o) => {
      const load = o.steps.reduce((a, s) => a + s.tc, 0);
      const uptimes = Array.from(new Set(o.all.map((s) => String(doc.steps[s.seq - 1].uptimePct || "").trim())));
      const up = uptimes.length === 1 ? num(uptimes[0]) : null;
      const issues = [];
      if (uptimes.length > 1) issues.push("uptime diferente entre as etapas: não aplicado");
      if (o.steps.length < o.all.length) issues.push(`${o.all.length - o.steps.length} etapa(s) sem TC fora da carga`);
      return {
        label: o.label,
        seqs: o.all.map((s) => s.seq),
        load: o.steps.length ? load : null,
        taktPct: takt && o.steps.length ? (load / takt) * 100 : null,
        overTakt: !!(takt && o.steps.length && load > takt + EPS),
        capacityDay: availDayMin > 0 && load > EPS ? availDayMin / load : null,
        opsEff: up > 0 && up <= 100 ? up / 100 : 1,
        issues,
      };
    });
    const sharedBy = (s) => (s.operatorTag ? sharedOperators.find((o) => o.label.toLowerCase() === s.operatorTag.toLowerCase()) : null);

    // Gargalo = maior entre o maior TC de etapa e a maior carga de operador (informa qual dos dois)
    const stepMax = valid.reduce((m, s) => (!m || s.tc > m.tc ? s : m), null);
    const opMax = sharedOperators.filter((o) => o.load != null).reduce((m, o) => (!m || o.load > m.load ? o : m), null);
    const bottleneck =
      opMax && (!stepMax || opMax.load > stepMax.tc + EPS)
        ? { kind: "operador", seq: null, name: `Carga do operador ${opMax.label}`, operator: opMax.label, tc: opMax.load }
        : stepMax
          ? { kind: "etapa", seq: stepMax.seq, name: stepMax.name, tc: stepMax.tc }
          : null;
    // Nº total de operadores da linha: digitado (equipe compartilhada entre etapas, como na
    // planilha K37) ou, se vazio, a soma dos operadores efetivos das etapas (o operador
    // compartilhado conta uma vez).
    const opsSum =
      steps.filter((s) => !s.operatorTag).reduce((a, s) => a + s.opsEff, 0) + sharedOperators.reduce((a, o) => a + o.opsEff, 0);
    const opsTyped = num(doc.operatorsTotal);
    const opsTotal = opsTyped > 0 ? opsTyped : opsSum;
    const line = lineResults(availDayMin, bottleneck ? bottleneck.tc : null, opsTotal);
    const kaizenStep = steps.find((s) => s.kaizen) || null;
    // Kaizen em etapa de operador compartilhado: a produção usa a capacidade do operador (carga)
    const kzOp = kaizenStep ? sharedBy(kaizenStep) : null;
    const kzLimit = kzOp && kzOp.load != null ? kzOp.load : kaizenStep ? kaizenStep.tc : null;
    const kzOps = kzOp ? kzOp.opsEff : kaizenStep ? kaizenStep.opsEff : 0;
    const kaizen = kaizenStep
      ? Object.assign(
          { name: kaizenStep.name, tc: kaizenStep.tc, limit: kzLimit, operator: kzOp ? kzOp.label : "", operators: kzOps },
          lineResults(availDayMin, kzLimit, kzOps)
        )
      : null;
    const unmeasured = steps.filter((s) => s.unmeasured).map((s) => ({ seq: s.seq, name: s.name }));

    const inventories = doc.inventories.map((inv) => {
      const q = num(inv.quantity);
      return { id: inv.id, name: inv.name, quantity: q, days: q != null && demandDaily ? q / demandDaily : null, beforeStepId: inv.beforeStepId || "" };
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
      processTotal,
      bottleneck,
      sharedOperators,
      unmeasured,
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
        uses.get(id).push({ seq, name, product, via, op: op || 0, etapa: s.studyEtapa || "", weighted: !!s.weighted, tag: String(s.operatorTag || "").trim() });
      };
      if (s.studyId) add(s.studyId, s.studyProduct || "", "etapa", s.studyOperator);
      if (s.groupId && info && info.studyIds) info.studyIds.forEach((id) => add(id, null, "grupo"));
      if (!info) return;
      info.warnings.forEach((w) => out.push({ kind: "estudo", seq, text: `${seq}. ${name}: ${w}` }));
      const dd = computed.demandDaily;
      // Etapa ponderada: a demanda do produto difere da família por definição (REV 1.14)
      if (s.studyId && !s.weighted && dd > 0 && info.demand > 0 && Math.abs(info.demand - dd) / dd > 0.01) {
        mismatch.push(`${seq}. ${name} (${Calc.formatNumber(info.demand, 1)}/dia)`);
      }
      const av = computed.availDayMin;
      if (s.studyId && av > 0 && info.netTime > 0 && Math.abs(info.netTime - av) > 0.5) {
        netMismatch.push(`${seq}. ${name} (${Calc.formatNumber(info.netTime, 0)} min)`);
      }
    });
    uses.forEach((all) => {
      if (all.length < 2) return;
      // Partes válidas do mesmo estudo: operadores diferentes (tipo LINHA, REV 1.14) e etapas do
      // processo diferentes (REV 1.15). Contagem dupla: a mesma parte duas vezes, o produto inteiro
      // junto com uma parte dele, o Mix junto com outra etapa, ou produtos diferentes do mesmo posto
      // sem a ponderação pela demanda (com ponderação e operador/etapa, a carga é somada corretamente).
      let list = null;
      const mixUses = all.filter((u) => u.product === MIX_KEY);
      const others = all.filter((u) => u.product !== MIX_KEY);
      if (all.some((u) => u.via === "grupo") || mixUses.length > 1 || (mixUses.length && others.length)) list = all;
      else {
        const byPart = new Map();
        others.forEach((u) => {
          const k = `${u.product}|${u.etapa}|${u.op}`;
          byPart.set(k, (byPart.get(k) || []).concat([u]));
        });
        const repeated = Array.from(byPart.values()).find((l) => l.length > 1);
        const products = Array.from(new Set(others.map((u) => u.product)));
        const wholeAndPart = products
          .map((p) => others.filter((u) => u.product === p))
          .find((l) => l.some((u) => !u.etapa && !u.op) && l.some((u) => u.etapa || u.op));
        if (repeated) list = repeated;
        else if (wholeAndPart) list = wholeAndPart;
        else if (products.length > 1 && !others.every((u) => u.weighted && (u.tag || u.etapa || u.op))) list = others;
      }
      if (!list) return;
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
    // Operadores compartilhados e etapas não medidas (REV 1.14)
    const tu = Calc.TIME_UNITS[doc.timeUnit] ? doc.timeUnit : "min";
    const ft = (m) => `${Calc.formatTime(m, tu, tu === "s" ? 2 : undefined)} ${Calc.TIME_UNITS[tu].label}`;
    const seqText = (list) => (list.length > 1 ? `etapas ${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}` : `etapa ${list[0]}`);
    (computed.sharedOperators || []).forEach((o) => {
      if (o.seqs.length < 2) return; // operador numa etapa só: nada a conferir
      const isBn = computed.bottleneck && computed.bottleneck.kind === "operador" && computed.bottleneck.operator === o.label;
      const parts = [
        `Operador ${o.label}: ${seqText(o.seqs)}`,
        `carga ${o.load != null ? ft(o.load) : "--"}`,
        `${o.taktPct != null ? Calc.formatNumber(o.taktPct, 1) + "%" : "--"} do takt`,
        `capacidade ${o.capacityDay != null ? Calc.formatNumber(o.capacityDay, 0) : "--"}/dia`,
      ];
      out.push({ kind: o.overTakt ? "operador-over" : "operador", icon: o.overTakt ? "⚠" : "✔", text: parts.join(" • ") + (o.issues.length ? ` (${o.issues.join("; ")})` : "") });
      if (isBn) {
        const stepMax = (computed.steps || []).filter((x) => x.tc != null).reduce((m, x) => (!m || x.tc > m.tc ? x : m), null);
        out.push({
          kind: "gargalo",
          text: `Gargalo = carga do operador ${o.label} (${ft(o.load)}), não a maior etapa${stepMax ? ` (${stepMax.seq}. ${stepMax.name}, ${ft(stepMax.tc)})` : ""}`,
        });
      }
    });
    const nm = computed.unmeasured || [];
    if (nm.length) {
      out.push({
        kind: "fluxo",
        text: `Fluxo incompleto: ${nm.length} etapa(s) sem TC (${nm.map((x) => `${x.seq}. ${x.name}`).join(", ")}). Gargalo e capacidade valem só para as etapas medidas.`,
      });
    }
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
          processingTimeMin: round(r.processTotal, 4), // REV 1.14: Σ TP original (lead time)
          sharedOperators: r.sharedOperators.map((o) => ({ operator: o.label, steps: o.seqs, loadMin: round(o.load, 4), taktPct: round(o.taktPct, 2), capacityDay: round(o.capacityDay, 2) })),
          unmeasuredSteps: r.unmeasured,
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

  /**
   * Fluxograma do estado presente (REV 1.24): sequência para o desenho, sem cálculo novo.
   * nodes = estoques posicionados (△) e etapas, na ordem do fluxo; unplaced = estoques sem
   * posição (ou cuja etapa saiu do MFV). bottleneck: etapa gargalo, ou as etapas do operador
   * compartilhado quando o gargalo é a carga dele. r = computeMfv(doc).
   */
  function flowchartModel(r) {
    const ids = new Set(r.steps.map((s) => s.id));
    const at = (pos) => r.inventories.filter((i) => i.beforeStepId === pos).map((inv) => ({ kind: "inventory", inv }));
    const bn = r.bottleneck;
    const isBn = (s) =>
      !!bn && !s.unmeasured && (bn.kind === "etapa" ? bn.seq === s.seq : !!s.operatorTag && s.operatorTag.toLowerCase() === String(bn.operator).toLowerCase());
    const nodes = at(FLOW_START);
    r.steps.forEach((s) => {
      nodes.push(...at(s.id));
      nodes.push({ kind: "step", step: s, bottleneck: isBn(s) });
    });
    nodes.push(...at(FLOW_END));
    const unplaced = r.inventories.filter((i) => i.beforeStepId !== FLOW_START && i.beforeStepId !== FLOW_END && !ids.has(i.beforeStepId));
    return {
      nodes,
      unplaced: unplaced.map((inv) => Object.assign({ orphan: !!inv.beforeStepId }, inv)),
      leadTimeDays: r.demandDaily ? r.leadTimeDays : null,
      processTotal: r.processTotal > 0 ? r.processTotal : null,
      bottleneckKind: bn ? bn.kind : "",
    };
  }

  return {
    SCHEMA_ID,
    SCHEMA_VERSION,
    FILE_PATTERN,
    FLOW_START,
    FLOW_END,
    flowchartModel,
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
