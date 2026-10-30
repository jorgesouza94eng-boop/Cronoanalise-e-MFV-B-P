/**
 * ============================================================================
 * LEAN CHRONO & MFV — MOTOR DE CÁLCULO E MODELO DE DADOS
 * ----------------------------------------------------------------------------
 * Funções puras (sem acesso ao DOM, ao disco ou ao navegador).
 * Carregado como script clássico (window.LeanCalc) para funcionar também
 * aberto direto do disco (file://), e como módulo CommonJS nos testes (Node).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LeanCalc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SCHEMA_ID = "lean-chrono-estudo";
  const SCHEMA_VERSION = 7; // v2: peças por filmagem • v3: início por filmagem e produto • v4: demanda por produto • v5: produto no mix e nome do vídeo • v6: vários operadores no mesmo estudo • v7: etapa do processo por linha

  /** Faixa aceita para o fator de ritmo (%). */
  const PACE_MIN = 50;
  const PACE_MAX = 150;

  /** Tolerância numérica para comparações em ponto flutuante. */
  const EPS = 1e-9;

  /* ==========================================================================
     CONVERSÕES DE ENTRADA
     ========================================================================== */

  /**
   * Converte a digitação rápida do tempo do vídeo em minutos centesimais.
   *   "90"      → 01:30   (até 2 dígitos = segundos corridos)
   *   "132"     → 01:32   (MMSS)
   *   "6532"    → 65:32   (MMSS)
   *   "10532"   → 1:05:32 (HMMSS — formato exibido pelo VLC/YouTube)
   *   "1:30"    → 01:30   | "1:05:32" → 1:05:32
   * Entradas inválidas (ex.: "199" = 99 s) retornam erro, nunca são "corrigidas".
   * @returns {{formatted: string, minutes: number|null, error: string|null}}
   */
  function parseTimeInput(rawStr) {
    const s = String(rawStr == null ? "" : rawStr).trim();
    if (!s) return { formatted: "", minutes: null, error: null };
    const bad = (msg) => ({ formatted: s, minutes: null, error: msg });

    let h = 0;
    let m = 0;
    let sec = 0;

    if (s.includes(":")) {
      const parts = s.split(":");
      if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
        return bad("Formato inválido. Use MMSS, MM:SS ou H:MM:SS");
      }
      const nums = parts.map(Number).reverse();
      sec = nums[0];
      m = nums[1] || 0;
      h = nums[2] || 0;
      if (parts.length === 3 && m >= 60) return bad("Minutos ≥ 60 no formato H:MM:SS");
    } else {
      if (!/^\d+$/.test(s)) return bad("Use apenas números (MMSS) ou MM:SS");
      if (s.length <= 2) {
        sec = Number(s);
        m = Math.floor(sec / 60);
        sec %= 60;
      } else if (s.length <= 4) {
        m = Number(s.slice(0, -2));
        sec = Number(s.slice(-2));
      } else {
        h = Number(s.slice(0, -4));
        m = Number(s.slice(-4, -2));
        sec = Number(s.slice(-2));
        if (m >= 60) return bad("Minutos ≥ 60 no formato HMMSS");
      }
    }

    if (sec >= 60) return bad("Segundos ≥ 60: verifique a digitação");

    const minutes = h * 60 + m + sec / 60;
    return { formatted: formatVideoTime(minutes), minutes, error: null };
  }

  /**
   * Formata minutos centesimais como tempo de vídeo: "MM:SS" ou "H:MM:SS".
   * Abaixo de 1 hora mantém MM:SS (até 59:59).
   */
  function formatVideoTime(minutes) {
    if (minutes == null || !Number.isFinite(minutes)) return "";
    const totalSec = Math.round(minutes * 60);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  /**
   * Interpreta a frequência do elemento: "1", "2", "0,02" ou "1/50".
   * Vazio equivale a 1 (elemento cíclico, uma vez por peça).
   * @returns {{value: number|null, error: string|null}}
   */
  function parseFrequency(raw) {
    const s = String(raw == null ? "" : raw).trim().replace(",", ".");
    if (s === "") return { value: 1, error: null };
    const match = s.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/);
    if (!match) return { value: null, error: "Frequência inválida. Use 1, 0,02 ou 1/50" };
    const value = match[2] !== undefined ? Number(match[1]) / Number(match[2]) : Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) {
      return { value: null, error: "Frequência deve ser maior que zero" };
    }
    return { value, error: null };
  }

  /**
   * Interpreta o fator de ritmo em % (aceita "95", "95%", "97,5").
   * Valores fora de 50–150% são recusados com alerta (não são ajustados).
   * @returns {{value: number|null, error: string|null}}
   */
  function parsePace(raw) {
    const s = String(raw == null ? "" : raw).trim().replace("%", "").replace(",", ".").trim();
    if (s === "") return { value: null, error: "Informe o fator de ritmo (%)" };
    if (!/^\d+(?:\.\d+)?$/.test(s)) return { value: null, error: "Ritmo inválido. Use um número em %, ex.: 95" };
    const value = Number(s);
    if (value < PACE_MIN || value > PACE_MAX) {
      return { value: null, error: `Ritmo fora da faixa aceita (${PACE_MIN}% a ${PACE_MAX}%)` };
    }
    return { value, error: null };
  }

  /**
   * Converte texto numérico em formato brasileiro ("1.234,5" ou "480,5") ou
   * internacional ("480.5") em número. Retorna null se inválido.
   */
  function parseNumber(raw) {
    let s = String(raw == null ? "" : raw).trim();
    if (s === "") return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  /* ==========================================================================
     CÁLCULO DO ESTUDO (LEITURA CONTÍNUA + INDICADORES LEAN)
     ========================================================================== */

  /* ==========================================================================
     CLASSIFICAÇÕES (PADRÃO DA PLANILHA B+P) E UNIDADES
     ========================================================================== */

  /** Valor agregado e ação sugerida (aba "Listagem de Elementos"). */
  const VALUES = {
    AG: { label: "Agrega", action: "Manter atividade" },
    NA: { label: "Não agrega", action: "Eliminar atividade" },
    IN: { label: "Incidental", action: "Reduzir atividade" },
  };

  /** Os 8 desperdícios do Lean. */
  const WASTES = {
    superproducao: "Superprodução",
    espera: "Espera",
    transporte: "Transporte",
    processamento: "Processamento excessivo",
    estoque: "Estoque",
    movimentacao: "Movimentação",
    defeitos: "Defeitos / retrabalho",
    intelecto: "Intelecto (talento não utilizado)",
  };

  /** Unidades de exibição (o cálculo interno é sempre em minutos centesimais). */
  const TIME_UNITS = {
    s: { factor: 60, label: "s", name: "segundos", decimals: 1 },
    min: { factor: 1, label: "min", name: "minutos", decimals: 3 },
    h: { factor: 1 / 60, label: "h", name: "horas", decimals: 4 },
  };

  /** Modos de lançamento: "quantidade" (planilha REV2) ou "frequencia" (cronoanálise clássica). */
  const ENTRY_MODES = ["quantidade", "frequencia"];

  /** Chave da 1ª filmagem em study.filmPieces (as demais usam o id da linha "nova filmagem"). */
  const FIRST_FILM_KEY = "inicio";

  function timeUnit(study) {
    const u = study && study.settings && study.settings.timeUnit;
    return TIME_UNITS[u] ? u : "min";
  }

  function entryMode(study) {
    const m = study && study.settings && study.settings.entryMode;
    return ENTRY_MODES.includes(m) ? m : "frequencia";
  }

  /** Converte minutos centesimais para a unidade escolhida. */
  function toUnit(minutes, unit) {
    if (minutes == null || !Number.isFinite(minutes)) return null;
    return minutes * TIME_UNITS[TIME_UNITS[unit] ? unit : "min"].factor;
  }

  /** Formata minutos na unidade escolhida (pt-BR). */
  function formatTime(minutes, unit, decimals) {
    const u = TIME_UNITS[unit] ? unit : "min";
    return formatNumber(toUnit(minutes, u), decimals == null ? TIME_UNITS[u].decimals : decimals);
  }

  /** Quantidade produzida no trecho (vazio = 1). */
  function parseQuantity(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (s === "") return { value: 1, error: null };
    const v = parseNumber(s);
    if (v == null || !(v > 0)) return { value: null, error: "Quantidade deve ser um número maior que zero" };
    return { value: v, error: null };
  }

  /** Chave de agrupamento: mesmo nome = mesmo elemento (ignora maiúsculas e espaços extras). */
  function elementKey(description) {
    return String(description || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
  }

  /**
   * Chave do elemento no resumo (mesma etapa + mesmo nome). Com etapas (REV 1.15), o mesmo
   * nome em etapas diferentes é outro elemento. row = linha calculada; el = elemento do estudo.
   */
  function elementGroupKey(row, el) {
    const name = String(el.description || "").trim().replace(/\s+/g, " ");
    return (row.etapaKey ? `${row.etapaKey}|` : "") + (name ? elementKey(name) : `#${el.id}`);
  }

  /** Ferramentas Lean (REV 1.19: Plano 5W2H; REV 1.20: sugestão Kaizen da IA). */
  const LEAN_TOOLS = {
    "5s": "5S",
    smed: "TRF / SMED",
    pokayoke: "Qualidade na fonte / Poka-Yoke",
    padronizado: "Trabalho padronizado",
    fluxo: "Fluxo contínuo",
    kanban: "Kanban",
    gd: "Gerenciamento diário (GD)",
    layout: "Layout",
    outra: "Outra",
  };

  /* ==========================================================================
     CÁLCULO DO ESTUDO (LEITURA CONTÍNUA + RESUMO POR ELEMENTO + INDICADORES)
     ========================================================================== */

  /**
   * Calcula todas as linhas, o resumo por elemento e os indicadores do estudo.
   *
   * Linhas (aba GERAL):
   *  - Tempo Subtraído (TS) = Tempo Final − última leitura válida
   *    (1ª linha usa a leitura inicial; linha de "nova filmagem" usa 00:00).
   *  - Tempo Normal da linha (TN) = TS × (Ritmo/100) [× Frequência no modo frequência].
   *  - Modo quantidade: tempo/un = TN ÷ Quantidade.
   *
   * Resumo por elemento (aba Listagem de Elementos) — agrupa pelo nome:
   *  - Modo quantidade (planilha REV2): Tipo C → ΣTN ÷ ΣQtd (média por unidade);
   *                                     Tipo A → ΣTN (soma dos tempos) ou, com as peças
   *                                     de todas as filmagens, ΣTN ÷ Σpeças (por unidade).
   *  - Modo frequência: média do TN das ocorrências (a frequência já rateia o acíclico).
   *  - Tempo normal do ciclo = Σ tempos dos elementos.
   *
   * Indicadores: TP = Tempo do ciclo × (1 + Tolerância/100) [OIT]; TLD, Takt, Capacidade.
   * Linha com erro não entra no resumo nem nos totais (e é sinalizada na interface).
   */
  function computeStudy(study) {
    const params = (study && study.shiftParams) || {};
    const mode = entryMode(study);
    const elements = (study && study.elements) || [];
    const multi = elements.some((e) => String(e.product || "").trim());
    // Etapa do processo (REV 1.15): cada linha pode indicar a etapa do produto (ex.: Moldagem)
    const withEtapas = elements.some((e) => String(e.etapa || "").trim());
    const starts = (study && study.filmStarts) || {};
    const demands = (study && study.productDemand) || {};
    const inMix = (study && study.produtoNoMix) || {}; // { chave: false } = fora da carga do posto
    const videos = (study && study.filmVideos) || {}; // { chave da filmagem: nome do vídeo }
    const start = parseTimeInput(study && study.videoStart);
    // Vários operadores (REV 1.14): cada um tem a sua leitura contínua dentro da filmagem
    const settings = (study && study.settings) || {};
    const opOf = (el) => (Number.isInteger(el && el.operador) && el.operador >= 1 ? el.operador : 1);
    const declaredOps = Number.isInteger(settings.numOperadores) && settings.numOperadores >= 1 ? settings.numOperadores : 1;
    const opCount = Math.max(declaredOps, elements.reduce((m, el) => Math.max(m, opOf(el)), 1));
    const multiOp = opCount > 1;
    const opNames = settings.nomesOperadores || {};
    const opLabel = (n) => `Op${n}${String(opNames[n] || "").trim() ? ` (${String(opNames[n]).trim()})` : ""}`;
    let filmStartMin = start.minutes != null ? start.minutes : 0;
    let prevByOp = {}; // última leitura de cada operador na filmagem atual
    let film = 1;
    // Filmagens: chave estável = "inicio" (1ª) ou id da linha que marca a nova filmagem.
    // Início da 1ª = Leitura inicial; das demais = study.filmStarts[id] (vazio = 00:00).
    const films = [
      { film: 1, key: FIRST_FILM_KEY, startSeq: 1, startRaw: String((study && study.videoStart) || ""), start: start.minutes || 0, startError: start.error, observed: 0, video: String(videos[FIRST_FILM_KEY] || ""), obsByOp: {}, lastByOp: {} },
    ];

    let sumSubtracted = 0;
    let sumNormal = 0;
    let errorCount = 0;

    const rows = elements.map((el, index) => {
      const errors = [];
      // A primeira linha já inicia a filmagem 1; a marcação só vale a partir da 2ª.
      const newVideo = !!el.newVideo && index > 0;
      if (newVideo) {
        film += 1;
        const raw = String(starts[el.id] == null ? "" : starts[el.id]).trim();
        const st = parseTimeInput(raw);
        filmStartMin = st.minutes != null ? st.minutes : 0;
        prevByOp = {};
        films.push({ film, key: el.id, startSeq: index + 1, startRaw: raw, start: filmStartMin, startError: st.error, observed: 0, video: String(videos[el.id] || ""), obsByOp: {}, lastByOp: {} });
      }
      const op = multiOp ? opOf(el) : 1;
      const previous = prevByOp[op] != null ? prevByOp[op] : filmStartMin;
      const time = parseTimeInput(el.videoTime);
      const freq = parseFrequency(el.frequency);
      const qty = parseQuantity(el.quantity);
      const pace = parsePace(el.pace);

      if (time.error) errors.push(time.error);

      let subtractedTime = 0;
      let hasReading = false;
      if (time.minutes != null) {
        const diff = time.minutes - previous;
        if (diff < -EPS) {
          errors.push(`Tempo final menor que a leitura anterior${multiOp ? ` do Op${op}` : ""} (${formatVideoTime(previous)})`);
        } else {
          subtractedTime = Math.max(0, diff);
          prevByOp[op] = time.minutes;
          hasReading = true;
        }
      }

      // Ritmo e quantidade/frequência só são exigidos quando a linha tem leitura de tempo.
      if (mode === "frequencia" && freq.error) errors.push(freq.error);
      if (hasReading && mode === "quantidade" && qty.error) errors.push(qty.error);
      if (hasReading && pace.error) errors.push(pace.error);

      const valid = errors.length === 0;
      const factor = mode === "frequencia" ? freq.value : 1;
      const normalTime = valid && hasReading ? subtractedTime * (pace.value / 100) * factor : 0;
      const unitTime = mode === "quantidade" && valid && hasReading ? normalTime / qty.value : normalTime;

      if (valid) {
        sumSubtracted += subtractedTime;
        sumNormal += normalTime;
        if (hasReading) {
          const f = films[film - 1];
          f.obsByOp[op] = (f.obsByOp[op] || 0) + subtractedTime;
          f.lastByOp[op] = time.minutes;
          // Tempo observado da filmagem = o do operador com mais tempo (não soma operadores em paralelo)
          f.observed = Math.max(...Object.values(f.obsByOp));
        }
      } else {
        errorCount += 1;
      }

      const productName = multi ? String(el.product || "").trim().replace(/\s+/g, " ") : "";
      const etapaName = withEtapas ? String(el.etapa || "").trim().replace(/\s+/g, " ") : "";
      return {
        id: el.id,
        seq: index + 1,
        type: el.type === "A" ? "A" : "C",
        film,
        newVideo,
        operator: op,
        product: productName,
        productKey: productName ? elementKey(productName) : "",
        etapa: etapaName,
        etapaKey: etapaName ? elementKey(etapaName) : withEtapas ? "#sem-etapa" : "",
        frequency: freq.value,
        quantity: qty.value,
        timeMinutes: time.minutes,
        hasReading,
        subtractedTime,
        normalTime,
        unitTime,
        errors,
        valid,
      };
    });

    // ---- Produtos: cada produto tem resumo, ciclo, TP e capacidade próprios
    const productMap = new Map();
    const addProduct = (row) => {
      if (!productMap.has(row.productKey)) {
        productMap.set(row.productKey, { key: row.productKey, name: row.product || (multi ? "(sem produto)" : "") });
      }
    };
    // Só linhas com leitura criam produto (linha nova ainda vazia não aparece na lista).
    rows.filter((r) => r.hasReading).forEach(addProduct);
    if (!productMap.size) rows.slice(0, 1).forEach(addProduct);
    if (!productMap.size) productMap.set("", { key: "", name: "" });

    // Tempo observado de um conjunto de linhas: o do operador com mais tempo (operadores em paralelo)
    const maxByOp = (list) => {
      const by = {};
      list.forEach((r) => (by[r.operator] = (by[r.operator] || 0) + r.subtractedTime));
      const v = Object.values(by);
      return v.length ? Math.max(...v) : 0;
    };
    // Filmagem × produto: as peças são informadas por produto quando a filmagem tem mais de um
    const filmList = films.map((f) => {
      const inFilm = rows.filter((r) => r.film === f.film && r.hasReading);
      const keys = [];
      inFilm.forEach((r) => {
        if (!keys.includes(r.productKey)) keys.push(r.productKey);
      });
      if (!keys.length) keys.push(rows.find((r) => r.film === f.film) ? rows.find((r) => r.film === f.film).productKey : "");
      const segments = keys.map((pk) => ({
        productKey: pk,
        productName: (productMap.get(pk) || { name: "" }).name,
        key: keys.length > 1 ? `${f.key}|${pk}` : f.key,
        observed: maxByOp(inFilm.filter((r) => r.productKey === pk && r.valid)),
      }));
      return Object.assign({}, f, { segments });
    });

    const products = Array.from(productMap.values()).map((p) => {
      const segs = [];
      filmList.forEach((f) =>
        f.segments.filter((s) => s.productKey === p.key).forEach((s) => segs.push({ film: f.film, startSeq: f.startSeq, key: s.key, observed: s.observed }))
      );
      const filmInfo = filmPieces(study, segs, mode);
      // Demanda própria do produto (vazio = demanda geral dos parâmetros)
      const own = multi ? toFiniteOrNull(demands[p.key]) : null;
      const pParams = own != null ? Object.assign({}, params, { dailyDemandPcs: own }) : params;
      let summary;
      let kpis;
      let operators = null;
      let posto = null;
      if (!multiOp) {
        summary = summarize(elements, rows, mode, filmInfo, p.key);
        kpis = computeKpis(pParams, summary.cycleNormal);
      } else {
        // Por operador: resumo, TP, espera e conteúdo; posto: ciclo = maior TP (regra do grupo Posto)
        const opsHere = [];
        rows.forEach((r) => r.hasReading && r.productKey === p.key && !opsHere.includes(r.operator) && opsHere.push(r.operator));
        opsHere.sort((a, b) => a - b);
        operators = opsHere.map((n) => {
          const sm = summarize(elements, rows, mode, filmInfo, p.key, n);
          const k = computeKpis(pParams, sm.cycleNormal);
          const factor = k.standardTime != null && sm.cycleNormal > EPS ? k.standardTime / sm.cycleNormal : 1;
          const tp = k.standardTime != null ? k.standardTime : sm.cycleNormal;
          const wait = sm.elements.filter((g) => g.waste === "espera").reduce((a, g) => a + g.cycleTime, 0) * factor;
          return { op: n, label: opLabel(n), summary: sm, compilation: compile(sm), kpis: k, tn: sm.cycleNormal, tp, wait, content: tp - wait };
        });
        const cycleOp = operators.reduce((m, o) => (!m || o.tn > m.tn ? o : m), null);
        const combined = [];
        operators.forEach((o) => o.summary.elements.forEach((g) => combined.push(Object.assign({}, g, { op: o.op, opLabel: o.label }))));
        combined.forEach((g, i) => (g.seq = i + 1));
        summary = {
          elements: combined,
          cycleNormal: cycleOp ? cycleOp.tn : 0,
          acyclic: filmInfo.acyclic,
          conflictCount: combined.filter((g) => g.conflicts.length).length,
        };
        kpis = computeKpis(pParams, summary.cycleNormal);
        const n = operators.length;
        const cycle = kpis.standardTime != null ? kpis.standardTime : summary.cycleNormal;
        const content = operators.reduce((a, o) => a + o.content, 0);
        posto = {
          n,
          cycle,
          cycleOp: cycleOp ? cycleOp.op : null,
          cycleLabel: cycleOp ? cycleOp.label : "",
          wait: operators.reduce((a, o) => a + o.wait, 0),
          content,
          balancePct: n && cycle > EPS ? (content / (n * cycle)) * 100 : null,
          opsIdeal: kpis.taktTime > 0 && n ? content / kpis.taktTime : null,
        };
      }
      const etapas = withEtapas ? etapaResults(elements, rows, mode, filmInfo, p.key, pParams, multiOp, opLabel) : null;
      return Object.assign({}, p, {
        films: filmInfo,
        summary,
        operators,
        posto,
        etapas,
        checks: studyChecks(rows, mode, filmInfo, p, operators ? operators.map((o) => ({ label: o.label, op: o.op, summary: o.summary })) : [{ label: "", op: null, summary }], multi),
        compilation: compile(summary, operators ? operators.reduce((a, o) => a + o.tn, 0) : null),
        demand: toFiniteOrNull(pParams.dailyDemandPcs),
        demandRaw: multi && demands[p.key] != null ? String(demands[p.key]) : "",
        demandOwn: own != null,
        inMix: !multi || inMix[p.key] !== false,
        kpis,
      });
    });
    const wanted = study && study.settings && study.settings.product;
    const current = products.find((p) => p.key === wanted) || products[0];
    const mix = multi ? computeMix(products, computeKpis(params, 0).netTime) : null;
    // Operador exibido no resumo (0 = todos = posto)
    const wantOp = Number.isInteger(settings.operadorExibido) ? settings.operadorExibido : 0;
    const view = multiOp && current.operators ? current.operators.find((o) => o.op === wantOp) || null : null;
    // Avisos da linha do tempo (2.4) e de muitos operadores (1.5)
    const warnings = [];
    if (multiOp) {
      films.forEach((f) => {
        const lasts = Object.entries(f.lastByOp);
        if (lasts.length < 2) return;
        const end = Math.max(...lasts.map(([, t]) => t));
        lasts
          .filter(([, t]) => t < end - EPS)
          .forEach(([n, t]) => warnings.push(`Op${n} termina em ${formatVideoTime(t)}; a filmagem${filmCountLabel(film, f.film)} termina em ${formatVideoTime(end)}`));
      });
      if (opCount >= 5) warnings.push("Muitos operadores no mesmo vídeo: confira a linha do tempo de cada um.");
    }
    const checks = [];
    products.forEach((p) => p.checks.forEach((t) => checks.push(multi && p.name ? `${p.name}: ${t}` : t)));

    return {
      mode,
      unit: timeUnit(study),
      rows,
      multiProduct: multi,
      withEtapas,
      multiOperator: multiOp,
      operatorCount: opCount,
      operatorKind: settings.tipoOperadores === "linha" ? "linha" : "posto",
      operatorLabel: opLabel,
      operatorView: view ? view.op : 0,
      products,
      product: current,
      summary: view ? view.summary : current.summary,
      compilation: view ? view.compilation : current.compilation,
      totals: { sumSubtracted, sumNormal },
      kpis: view ? view.kpis : current.kpis,
      warnings,
      checks,
      mix,
      errorCount,
      filmCount: film,
      filmList,
      films: current.films,
      startError: start.error,
    };
  }

  /**
   * Carga do posto com vários produtos (o posto divide o tempo entre eles):
   *  - Carga do produto = TP × demanda diária PRÓPRIA do produto (min/dia).
   *  - Ocupação = Σ cargas ÷ tempo líquido disponível. Acima de 100% o posto não atende o mix.
   *  - Takt misto = tempo líquido ÷ Σ demandas.
   *  - TC ponderado pelo mix = Σ (TP × demanda) ÷ Σ demandas.
   * Só entram os produtos com "Considerar no mix" marcado (REV 1.12). Desde a REV 1.12 o produto
   * sem demanda própria NÃO herda a demanda geral no mix: a demanda geral é a do posto e seria
   * contada uma vez por produto. Produto incluído sem demanda própria (ou sem TP) deixa o mix
   * "incompleto", com os indicadores em "--" (o app não estima a demanda ausente).
   * status: "atende" | "sobrecarga" | "incompleto" | "vazio" (nenhum produto no mix)
   * partial: há produto fora do mix (ocupação subestimada).
   */
  function computeMix(products, netTime) {
    const items = products.map((p) => {
      const tp = p.kpis.standardTime > EPS ? p.kpis.standardTime : null;
      const included = p.inMix !== false;
      const demand = included && p.demandOwn && p.demand > 0 ? p.demand : null;
      return { key: p.key, name: p.name, tp, demand, demandOwn: p.demandOwn, inMix: included, load: tp != null && demand != null ? tp * demand : null };
    });
    const included = items.filter((i) => i.inMix);
    const excluded = items.filter((i) => !i.inMix);
    const noDemand = included.filter((i) => i.demand == null);
    const noTp = included.filter((i) => i.demand != null && i.tp == null);
    const missing = noDemand.length + noTp.length;
    const names = (list) => list.map((i) => i.name).join(", ");
    const issues = [];
    let status;
    if (!included.length) {
      status = "vazio";
      issues.push("Informe a demanda ou inclua um produto no mix");
    } else {
      if (noDemand.length) issues.push(`${noDemand.length > 1 ? "Produtos" : "Produto"} ${names(noDemand)} sem demanda própria: informe a demanda ou desmarque "Considerar no mix"`);
      if (noTp.length) issues.push(`${noTp.length > 1 ? "Produtos" : "Produto"} ${names(noTp)} sem tempo padrão`);
    }
    if (excluded.length && included.length) issues.push(`Mix parcial: ocupação do posto subestimada, ${excluded.length > 1 ? "produtos" : "produto"} ${names(excluded)} fora da carga`);
    const complete = included.length > 0 && !missing;
    const load = complete ? included.reduce((a, i) => a + i.load, 0) : null;
    const demand = complete ? included.reduce((a, i) => a + i.demand, 0) : null;
    const occupancyPct = complete && netTime > 0 ? (load / netTime) * 100 : null;
    if (status !== "vazio") status = !complete || occupancyPct == null ? "incompleto" : occupancyPct > 100 + EPS ? "sobrecarga" : "atende";
    return {
      items,
      netTime,
      load,
      demand,
      occupancyPct,
      taktMix: complete && netTime > 0 && demand > 0 ? netTime / demand : null,
      weightedTP: complete && demand > 0 ? load / demand : null,
      missing,
      excluded: excluded.map((i) => i.name),
      partial: excluded.length > 0 && included.length > 0,
      issues,
      status,
    };
  }

  /**
   * "Preencher para baixo" da coluna Produto, depois que a linha idx recebeu um produto
   * (o valor anterior era oldProduct). Não altera nada: devolve o plano para a tela.
   *  - "preencher": antes vazia → as linhas vazias logo abaixo recebem o produto
   *                 (para na 1ª linha que já tem produto). Não precisa de confirmação.
   *  - "trocar":    antes "A" → as linhas seguidas abaixo que também eram "A" podem
   *                 receber o novo valor (pede confirmação na tela).
   * Segue a ordem da grade (atravessa filmagens). Retorna null quando não há o que fazer.
   */
  function productFillPlan(elements, idx, oldProduct, field) {
    const f = field || "product"; // REV 1.15: o mesmo preenchimento vale para a coluna Etapa
    const list = elements || [];
    const row = list[idx];
    if (!row) return null;
    const value = String(row[f] || "").trim().replace(/\s+/g, " ");
    const oldKey = elementKey(oldProduct);
    if (elementKey(value) === oldKey) return null;
    const ids = [];
    let mode;
    if (!oldKey) {
      if (!value) return null;
      mode = "preencher";
      for (let i = idx + 1; i < list.length && !elementKey(list[i][f]); i++) ids.push(list[i].id);
    } else {
      mode = "trocar";
      for (let i = idx + 1; i < list.length && elementKey(list[i][f]) === oldKey; i++) ids.push(list[i].id);
    }
    if (!ids.length) return null;
    return { mode, value, oldValue: String(oldProduct || "").trim(), ids, from: idx + 2, to: idx + 1 + ids.length };
  }

  /**
   * Classificação copiada para as linhas do mesmo elemento (REV 1.18): ao mudar o tipo, o valor
   * ou o desperdício de uma linha, as outras linhas com o mesmo nome (no mesmo produto e na mesma
   * etapa) recebem a mesma classificação. fill = linhas sem classificação (preenchidas direto);
   * conflict = linhas já classificadas com outro valor (o app pergunta antes de trocar).
   * Valor vazio ("—") não é copiado. Retorna null quando não há o que fazer.
   */
  function classificationPlan(elements, idx, field) {
    const list = elements || [];
    const row = list[idx];
    if (!row || !["type", "value", "waste"].includes(field)) return null;
    const value = row[field] || "";
    const key = elementKey(row.description);
    if (!value || !key) return null;
    const same = (e) => e !== row && elementKey(e.description) === key && elementKey(e.product) === elementKey(row.product) && elementKey(e.etapa) === elementKey(row.etapa);
    const fill = [];
    const conflict = [];
    list.forEach((e, i) => {
      if (!same(e)) return;
      const cur = e[field] || "";
      if (cur === value) return;
      (cur ? conflict : fill).push({ id: e.id, seq: i + 1, value: cur });
    });
    if (!fill.length && !conflict.length) return null;
    return { field, value, name: String(row.description || "").trim(), fill, conflict };
  }

  /** Agrupa as linhas válidas pelo nome do elemento (equivale à aba "Listagem de Elementos"). */
  /**
   * Compilação (aba "Compilação e Soluções"): por valor agregado e por desperdício,
   * contando elementos do resumo e somando o tempo no ciclo.
   */
  function compile(summary, totalOverride) {
    // Posto com vários operadores: a % é sobre a soma dos tempos de todos os operadores (o ciclo do posto é só o maior)
    const total = totalOverride != null ? totalOverride : summary.cycleNormal;
    const pct = (t) => (total > EPS ? (t / total) * 100 : 0);
    const byValue = ["AG", "NA", "IN", ""]
      .map((key) => {
        const list = summary.elements.filter((g) => g.value === key);
        const time = list.reduce((a, g) => a + g.cycleTime, 0);
        return { key, label: key ? VALUES[key].label : "Sem classificação", count: list.length, time, pct: pct(time) };
      })
      .filter((v) => v.key || v.count > 0);
    const byWaste = Object.keys(WASTES)
      .map((key) => {
        const list = summary.elements.filter((g) => g.waste === key);
        const time = list.reduce((a, g) => a + g.cycleTime, 0);
        return { key, label: WASTES[key], count: list.length, time, pct: pct(time) };
      })
      .filter((w) => w.count > 0)
      .sort((a, b) => b.time - a.time); // Pareto: maior desperdício primeiro
    return { total, elementCount: summary.elements.length, byValue, byWaste };
  }

  /**
   * Peças produzidas por filmagem (modo quantidade). Quando TODAS as filmagens do produto
   * têm peças, os elementos acíclicos (tipo A) viram tempo por unidade: ΣTN do elemento ÷
   * Σpeças produzidas no período observado. Sem isso, o tipo A fica como Σtempo (padrão da
   * planilha), que é o tempo total observado e não pode ser comparado com o takt.
   * segments: [{ film, startSeq, key, observed }] — key é a chave em study.filmPieces.
   */
  function filmPieces(study, segments, mode) {
    const raw = (study && study.filmPieces) || {};
    let piecesTotal = 0;
    let filled = 0;
    let errors = 0;
    const list = segments.map((f) => {
      const s = String(raw[f.key] == null ? "" : raw[f.key]).trim();
      let pieces = null;
      let error = null;
      if (s) {
        const v = parseNumber(s);
        if (v == null || !(v > 0)) error = "Peças devem ser um número maior que zero";
        else pieces = v;
      }
      if (error) errors += 1;
      if (pieces != null) {
        filled += 1;
        piecesTotal += pieces;
      }
      return Object.assign({}, f, {
        raw: s,
        pieces,
        error,
        observedPerPiece: pieces != null && f.observed > EPS ? f.observed / pieces : null,
      });
    });
    const observedTotal = list.reduce((a, f) => a + f.observed, 0);
    let acyclic = "total"; // "total" | "por-unidade" | "incompleto"
    if (mode === "quantidade" && filled > 0) acyclic = filled === list.length && !errors ? "por-unidade" : "incompleto";
    return {
      list,
      filled,
      piecesTotal: filled ? piecesTotal : null,
      observedTotal,
      observedPerPiece: acyclic === "por-unidade" && piecesTotal > EPS ? observedTotal / piecesTotal : null,
      acyclic,
    };
  }

  /**
   * Etapas do processo de um produto (REV 1.15), na ordem em que aparecem na grade.
   * Por etapa: TN, TP (= TN × (1 + tolerância)), espera e conteúdo (TP − espera). Com vários
   * operadores, por operador da etapa: 1 operador → a etapa é dele; 2+ → posto da etapa
   * (ciclo = maior TP, conteúdo = Σ). Nunca soma tempos de operadores diferentes.
   */
  function etapaResults(elements, rows, mode, filmInfo, productKey, pParams, multiOp, opLabel) {
    const order = [];
    rows.forEach((r) => {
      if (!r.valid || !r.hasReading || r.productKey !== productKey) return;
      if (!order.some((e) => e.key === r.etapaKey)) order.push({ key: r.etapaKey, name: r.etapa || "(sem etapa)" });
    });
    const tolOk = (() => {
      const t = toFiniteOrNull(pParams.tolerancePct);
      return t != null && t >= 0 && t < 100 ? t : null;
    })();
    const tpOf = (tn) => (tolOk != null ? tn * (1 + tolOk / 100) : null);
    const part = (op, ek) => {
      const sm = summarize(elements, rows, mode, filmInfo, productKey, op, ek);
      const tp = tpOf(sm.cycleNormal);
      const factor = tp != null && sm.cycleNormal > EPS ? tp / sm.cycleNormal : 1;
      const wait = sm.elements.filter((g) => g.waste === "espera").reduce((a, g) => a + g.cycleTime, 0) * factor;
      const base = tp != null ? tp : sm.cycleNormal;
      return { summary: sm, tn: sm.cycleNormal, tp, wait, content: base - wait, elementCount: sm.elements.length };
    };
    return order.map((e, i) => {
      if (!multiOp) return Object.assign({ key: e.key, name: e.name, order: i + 1, operators: null, n: 1, operator: 0, cycle: null }, part(null, e.key), { cycleOp: 0 });
      const ops = [];
      rows.forEach((r) => r.valid && r.hasReading && r.productKey === productKey && r.etapaKey === e.key && !ops.includes(r.operator) && ops.push(r.operator));
      ops.sort((a, b) => a - b);
      const list = ops.map((op) => Object.assign({ op, label: opLabel(op) }, part(op, e.key)));
      const top = list.reduce((m, o) => (!m || o.tn > m.tn ? o : m), null);
      const tn = top ? top.tn : 0;
      return {
        key: e.key,
        name: e.name,
        order: i + 1,
        operators: list,
        n: list.length,
        operator: list.length === 1 ? list[0].op : 0, // etapa feita por um só operador
        cycleOp: top ? top.op : 0,
        tn,
        tp: tpOf(tn),
        wait: list.reduce((a, o) => a + o.wait, 0),
        content: list.reduce((a, o) => a + o.content, 0),
        elementCount: list.reduce((a, o) => a + o.elementCount, 0),
        summary: null,
      };
    });
  }

  function summarize(elements, rows, mode, filmInfo, productKey, op, etapaKey) {
    const perUnitA = !!(filmInfo && filmInfo.acyclic === "por-unidade");
    const groups = new Map();
    rows.forEach((row, i) => {
      if (!row.valid || !row.hasReading) return;
      if (productKey != null && row.productKey !== productKey) return;
      if (op != null && row.operator !== op) return;
      if (etapaKey != null && row.etapaKey !== etapaKey) return;
      const el = elements[i];
      const name = String(el.description || "").trim().replace(/\s+/g, " ");
      // Com etapas (REV 1.15), o mesmo nome em etapas diferentes é outro elemento: TP do produto = Σ etapas
      const key = elementGroupKey(row, el);
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          name: name || `(sem descrição — linha ${row.seq})`,
          type: row.type,
          value: "",
          waste: "",
          firstSeq: row.seq,
          etapa: row.etapa || (row.etapaKey ? "(sem etapa)" : ""),
          unnamed: !name,
          occurrences: 0,
          sumSubtracted: 0,
          sumNormal: 0,
          sumQuantity: 0,
          conflicts: [],
          films: [],
        };
        groups.set(key, g);
      } else if (g.type !== row.type && !g.conflicts.includes("tipo")) {
        g.conflicts.push("tipo");
      }
      const value = VALUES[el.value] ? el.value : "";
      if (value) {
        if (!g.value) g.value = value;
        else if (g.value !== value && !g.conflicts.includes("valor")) g.conflicts.push("valor");
      }
      if (WASTES[el.waste] && !g.waste) g.waste = el.waste;
      g.occurrences += 1;
      if (!g.films.includes(row.film)) g.films.push(row.film);
      g.sumSubtracted += row.subtractedTime;
      g.sumNormal += row.normalTime;
      g.sumQuantity += mode === "quantidade" ? row.quantity : 1;
    });

    const list = Array.from(groups.values());
    list.forEach((g) => {
      g.perUnit = mode === "quantidade" && g.type === "A" && perUnitA;
      if (mode === "quantidade") {
        if (g.type !== "A") g.cycleTime = g.sumNormal / g.sumQuantity;
        else g.cycleTime = g.perUnit ? g.sumNormal / filmInfo.piecesTotal : g.sumNormal;
      }
      else g.cycleTime = g.sumNormal / g.occurrences;
      g.avgQuantity = g.sumQuantity / g.occurrences;
      g.action = VALUES[g.value] ? VALUES[g.value].action : "Classificar valor";
    });
    const cycleNormal = list.reduce((acc, g) => acc + g.cycleTime, 0);
    list.forEach((g, i) => {
      g.seq = i + 1;
      g.sharePct = cycleNormal > EPS ? (g.cycleTime / cycleNormal) * 100 : 0;
    });
    return { elements: list, cycleNormal, acyclic: filmInfo ? filmInfo.acyclic : "total", conflictCount: list.filter((g) => g.conflicts.length).length };
  }

  /**
   * Cópia do estudo só com as linhas de um operador (REV 1.14), para exportar no modelo B+P
   * (o modelo é de um operador). As filmagens são mantidas: a 1ª linha do operador em cada
   * filmagem recebe a marcação de filmagem e o id da linha original que a marcava, para o
   * início e as peças da filmagem continuarem valendo. O estudo original não é alterado.
   */
  function operatorStudy(study, op) {
    const r = computeStudy(study);
    const copy = JSON.parse(JSON.stringify(study));
    const seen = new Set();
    copy.elements = [];
    study.elements.forEach((el, i) => {
      const row = r.rows[i];
      if (!row || row.operator !== op) return;
      const e = Object.assign({}, JSON.parse(JSON.stringify(el)), { operador: 1, newVideo: false });
      if (!seen.has(row.film)) {
        seen.add(row.film);
        const f = r.filmList[row.film - 1];
        if (row.film > 1) {
          e.newVideo = true;
          e.id = f.key; // mesma chave do início e das peças da filmagem
        }
      }
      copy.elements.push(e);
    });
    if (!copy.elements.length) copy.elements.push(createElement());
    copy.settings = Object.assign({}, copy.settings, { numOperadores: 1, operadorExibido: 0 });
    const name = String((study.settings && study.settings.nomesOperadores && study.settings.nomesOperadores[op]) || "").trim();
    copy.processName = `${study.processName || "Posto"} — Op${op}${name ? ` (${name})` : ""}`;
    return copy;
  }

  /** " F2" quando o estudo tem mais de uma filmagem. */
  function filmCountLabel(total, film) {
    return total > 1 ? ` F${film}` : "";
  }

  /**
   * Avisos de consistência (REV 1.14, Fase 3) — não mudam nenhum cálculo:
   *  8.1 Elemento tipo C: Σ quantidade ≠ peças do produto nas filmagens em que o elemento aparece
   *      (só quando essas filmagens têm as peças informadas) → Qtd provavelmente fora de peças.
   *  8.2 Tempo normal do ciclo × tempo observado por peça (Σ tempo normal das linhas ÷ Σ peças),
   *      com as peças de todas as filmagens: diferença acima de 10% → conferir Qtd e tipo.
   * parts: [{ label, op, summary }] — um por operador (ou um só, sem operadores).
   */
  function studyChecks(rows, mode, filmInfo, product, parts) {
    const out = [];
    if (mode !== "quantidade" || !filmInfo) return out;
    const piecesByFilm = {};
    let complete = true;
    filmInfo.list.forEach((x) => {
      if (x.pieces == null) complete = false;
      else piecesByFilm[x.film] = (piecesByFilm[x.film] || 0) + x.pieces;
    });
    parts.forEach((part) => {
      const tag = part.label ? `${part.label}: ` : "";
      part.summary.elements.forEach((g) => {
        if (g.type !== "C") return;
        if (!g.films.every((f) => piecesByFilm[f] != null)) return;
        const pieces = g.films.reduce((a, f) => a + piecesByFilm[f], 0);
        if (pieces > 0 && Math.abs(g.sumQuantity - pieces) > 1e-6) {
          out.push(
            `${tag}Elemento "${g.name}": Σ quantidade (${formatNumber(g.sumQuantity, g.sumQuantity % 1 ? 2 : 0)}) diferente das peças do produto (${formatNumber(pieces, pieces % 1 ? 2 : 0)}). Confira se a Qtd está em peças do produto final.`
          );
        }
      });
      if (complete && filmInfo.piecesTotal > 0) {
        const own = rows.filter((r) => r.valid && r.hasReading && r.productKey === product.key && (part.op == null || r.operator === part.op));
        const observed = own.reduce((a, r) => a + r.normalTime, 0) / filmInfo.piecesTotal;
        const cyc = part.summary.cycleNormal;
        if (observed > EPS && Math.abs(cyc - observed) / observed > 0.1 + EPS) {
          out.push(
            `${tag}Tempo do ciclo (${formatNumber(cyc * 60, 2)} s) diferente do tempo observado por peça (${formatNumber(observed * 60, 2)} s): confira Qtd e tipo dos elementos.`
          );
        }
      }
    });
    return out;
  }

  /**
   * Indicadores do painel. Status possíveis:
   *  "parametros-invalidos" | "aguardando" | "gargalo" | "balanceado"
   */
  function computeKpis(params, sumNormal) {
    const shift = toFiniteOrNull(params.shiftTimeMin);
    const stops = toFiniteOrNull(params.plannedStopsMin);
    const demand = toFiniteOrNull(params.dailyDemandPcs);
    const tol = toFiniteOrNull(params.tolerancePct);

    const issues = [];
    if (shift == null || shift <= 0) issues.push("Informe a jornada bruta (min)");
    if (stops == null || stops < 0) issues.push("Paradas planejadas inválidas");
    if (demand == null || demand <= 0) issues.push("Informe a demanda diária");
    if (tol == null || tol < 0 || tol >= 100) issues.push("Tolerância deve estar entre 0% e 99%");

    const netTime = shift != null && stops != null ? Math.max(0, shift - stops) : 0;
    if (shift != null && stops != null && shift > 0 && netTime <= 0) {
      issues.push("Paradas planejadas consomem toda a jornada");
    }

    const taktTime = netTime > 0 && demand != null && demand > 0 ? netTime / demand : null;
    const standardTime = tol != null && tol >= 0 ? sumNormal * (1 + tol / 100) : null;
    const capacity =
      standardTime != null && standardTime > EPS && netTime > 0
        ? Math.floor(netTime / standardTime + EPS)
        : null;

    let status;
    let diffMin = null;
    let slackPct = null;
    if (issues.length) {
      status = "parametros-invalidos";
    } else if (!(standardTime > EPS)) {
      status = "aguardando";
    } else if (standardTime > taktTime + EPS) {
      status = "gargalo";
      diffMin = standardTime - taktTime;
    } else {
      status = "balanceado";
      slackPct = ((taktTime - standardTime) / taktTime) * 100;
    }

    return {
      netTime,
      taktTime,
      sumNormal,
      standardTime,
      capacity,
      status,
      diffMin,
      slackPct,
      issues,
    };
  }

  function toFiniteOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseNumber(v);
    return Number.isFinite(n) ? n : null;
  }

  /* ==========================================================================
     FORMATAÇÃO pt-BR
     ========================================================================== */

  const formatters = {};
  function formatNumber(n, decimals) {
    if (n == null || !Number.isFinite(n)) return "--";
    const d = decimals == null ? 2 : decimals;
    if (!formatters[d]) {
      formatters[d] = new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    }
    // REV 1.15: tira o resíduo da conta binária antes de arredondar (0,7499999… → 0,75 → "0,8")
    return formatters[d].format(Number(n.toPrecision(12)));
  }

  /* ==========================================================================
     MODELO DE DADOS DO ESTUDO (ARQUIVO JSON)
     ========================================================================== */

  function generateId() {
    const c = typeof crypto !== "undefined" ? crypto : null;
    if (c && typeof c.randomUUID === "function") {
      try {
        return c.randomUUID();
      } catch (e) {
        /* contexto não seguro: usa o método abaixo */
      }
    }
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** Remove acentos e caracteres inválidos para nome de arquivo. */
  function slugify(str, fallback) {
    const slug = String(str || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    return slug || fallback || "SemNome";
  }

  /**
   * Nome do arquivo, gerado UMA única vez na criação do estudo.
   * Ex.: Crono_Industria_Alfa_Posto_01_2026-10-15_a1b2c3d4.json
   */
  function buildFileName(clientName, processName, isoDate, id) {
    const date = String(isoDate || new Date().toISOString()).slice(0, 10);
    const shortId = String(id || generateId()).replace(/-/g, "").slice(0, 8);
    return `Crono_${slugify(clientName, "Cliente")}_${slugify(processName, "Posto")}_${date}_${shortId}.json`;
  }

  function defaultShiftParams() {
    return { shiftTimeMin: 528, plannedStopsMin: 48, dailyDemandPcs: 240, tolerancePct: 0 };
  }

  function createElement(overrides) {
    return Object.assign(
      {
        id: generateId(),
        description: "",
        type: "C",
        quantity: "1",
        frequency: "1",
        videoTime: "",
        pace: "100",
        value: "",
        waste: "",
        kaizen: "",
        kaizenTool: "", // REV 1.20: ferramenta Lean sugerida com a ação (vai para o Plano 5W2H)
        newVideo: false,
        product: "",
        etapa: "", // REV 1.15: etapa do processo (opcional)
        operador: 1, // REV 1.14: operador da linha (1 = único operador)
      },
      overrides || {}
    );
  }

  /** Cria um estudo novo (1 arquivo por posto/operação). */
  function createStudy(opts) {
    const o = opts || {};
    const now = o.now || new Date().toISOString();
    const id = o.id || generateId();
    return {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id,
      fileName: buildFileName(o.clientName, o.processName, now, id),
      revision: 0,
      createdAt: now,
      updatedAt: now,
      clientName: String(o.clientName || "").trim(),
      processName: String(o.processName || "").trim(),
      videoStart: "",
      filmStarts: {},
      filmPieces: {},
      productDemand: {},
      produtoNoMix: {},
      filmVideos: {},
      notes: "",
      // Novos estudos seguem a planilha REV2: lançamento por quantidade e tempos em segundos.
      settings: Object.assign({ entryMode: "quantidade", timeUnit: "s" }, o.settings || {}),
      shiftParams: Object.assign(defaultShiftParams(), o.shiftParams || {}),
      elements: [createElement()],
    };
  }

  /**
   * Valida e normaliza um objeto lido de arquivo/armazenamento.
   * Garante tipos corretos e preenche campos ausentes (migração de versão).
   * @returns {{ok: true, study: object} | {ok: false, error: string}}
   */
  function normalizeStudy(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Conteúdo não é um objeto JSON válido" };
    }
    if (raw.schema !== SCHEMA_ID) {
      return { ok: false, error: "Arquivo não é um estudo de cronoanálise deste aplicativo" };
    }
    const version = Number(raw.schemaVersion);
    if (!Number.isInteger(version) || version < 1) {
      return { ok: false, error: "Versão do arquivo inválida" };
    }
    if (version > SCHEMA_VERSION) {
      return {
        ok: false,
        error: `Arquivo criado por uma versão mais nova do aplicativo (v${version}). Atualize o aplicativo.`,
      };
    }
    if (typeof raw.id !== "string" || !raw.id) {
      return { ok: false, error: "Estudo sem identificador (id)" };
    }

    const str = (v) => (v == null ? "" : String(v));
    const params = Object.assign(defaultShiftParams(), raw.shiftParams || {});
    const num = (v, def) => {
      const n = typeof v === "number" ? v : parseNumber(v);
      return Number.isFinite(n) ? n : def;
    };

    const elements = Array.isArray(raw.elements) ? raw.elements : [];
    const study = {
      schema: SCHEMA_ID,
      schemaVersion: SCHEMA_VERSION,
      id: raw.id,
      fileName:
        typeof raw.fileName === "string" && /^Crono_.+\.json$/.test(raw.fileName)
          ? raw.fileName
          : buildFileName(raw.clientName, raw.processName, raw.createdAt, raw.id),
      revision: Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
      createdAt: str(raw.createdAt) || new Date().toISOString(),
      updatedAt: str(raw.updatedAt) || str(raw.createdAt) || new Date().toISOString(),
      clientName: str(raw.clientName),
      processName: str(raw.processName),
      videoStart: str(raw.videoStart),
      filmStarts: normalizeFilmPieces(raw.filmStarts),
      productDemand: normalizeFilmPieces(raw.productDemand),
      produtoNoMix: normalizeInMix(raw.produtoNoMix), // ausente = todos no mix (REV 1.11 e anteriores)
      filmVideos: normalizeFilmPieces(raw.filmVideos),
      filmPieces: normalizeFilmPieces(raw.filmPieces),
      notes: str(raw.notes),
      // Arquivos anteriores a esta versão não têm "settings": mantêm frequência e minutos.
      settings: {
        entryMode: ENTRY_MODES.includes(raw.settings && raw.settings.entryMode) ? raw.settings.entryMode : "frequencia",
        timeUnit: TIME_UNITS[raw.settings && raw.settings.timeUnit] ? raw.settings.timeUnit : "min",
        multiProduct: !!(raw.settings && raw.settings.multiProduct === true),
        multiEtapa: !!(raw.settings && raw.settings.multiEtapa === true), // REV 1.15: mostra a coluna Etapa
        product: raw.settings && typeof raw.settings.product === "string" ? raw.settings.product : "",
        // Vários operadores (REV 1.14): ausente = 1 operador (como antes)
        numOperadores: raw.settings && Number.isInteger(raw.settings.numOperadores) && raw.settings.numOperadores >= 1 ? raw.settings.numOperadores : 1,
        tipoOperadores: raw.settings && raw.settings.tipoOperadores === "linha" ? "linha" : "posto",
        nomesOperadores: normalizeFilmPieces(raw.settings && raw.settings.nomesOperadores),
        operadorExibido: raw.settings && Number.isInteger(raw.settings.operadorExibido) && raw.settings.operadorExibido >= 0 ? raw.settings.operadorExibido : 0,
      },
      shiftParams: {
        shiftTimeMin: num(params.shiftTimeMin, null),
        plannedStopsMin: num(params.plannedStopsMin, null),
        dailyDemandPcs: num(params.dailyDemandPcs, null),
        tolerancePct: num(params.tolerancePct, null),
      },
      elements: elements
        .filter((e) => e && typeof e === "object")
        .map((e) =>
          createElement({
            id: typeof e.id === "string" && e.id ? e.id : generateId(),
            description: str(e.description),
            // Sem tipo gravado (versão anterior): deduz da frequência, como antes.
            type: e.type === "A" || e.type === "C" ? e.type : (parseFrequency(e.frequency).value || 1) < 1 - EPS ? "A" : "C",
            quantity: e.quantity == null || e.quantity === "" ? "1" : str(e.quantity),
            frequency: e.frequency == null || e.frequency === "" ? "1" : str(e.frequency),
            videoTime: str(e.videoTime),
            pace: e.pace == null || e.pace === "" ? "100" : str(e.pace),
            value: VALUES[e.value] ? e.value : "",
            waste: WASTES[e.waste] ? e.waste : "",
            kaizen: str(e.kaizen),
            kaizenTool: LEAN_TOOLS[e.kaizenTool] ? e.kaizenTool : "",
            newVideo: e.newVideo === true,
            product: str(e.product),
            etapa: str(e.etapa),
            operador: Number.isInteger(e.operador) && e.operador >= 1 ? e.operador : 1,
          })
        ),
    };
    if (!study.elements.length) study.elements.push(createElement());
    return { ok: true, study };
  }

  /** Só "false" é guardado: o produto fora da carga do posto. */
  function normalizeInMix(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((k) => {
      if (raw[k] === false) out[k] = false;
    });
    return out;
  }

  function normalizeFilmPieces(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((k) => {
      const v = raw[k];
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) out[k] = String(v).trim();
    });
    return out;
  }

  /**
   * Gera o conteúdo do arquivo JSON: dados de entrada + resumo dos resultados
   * (o resumo serve para leitura externa — Excel/Power BI — e é ignorado ao carregar).
   */
  function serializeStudy(study) {
    const r = computeStudy(study);
    const out = Object.assign({}, study, {
      results: {
        calculatedAt: new Date().toISOString(),
        unit: "minutos centesimais",
        entryMode: r.mode,
        netTimeMin: round(r.kpis.netTime, 4),
        taktTimeMin: round(r.kpis.taktTime, 4),
        cycleNormalTimeMin: round(r.kpis.sumNormal, 4),
        standardTimeMin: round(r.kpis.standardTime, 4),
        capacityPcsDay: r.kpis.capacity,
        status: r.kpis.status,
        observedTimeMin: round(r.totals.sumSubtracted, 4),
        rowsWithErrors: r.errorCount,
        filmCount: r.filmCount,
        films: r.filmList.map((f) => ({
          film: f.film,
          video: f.video || "",
          startMin: round(f.start, 4),
          observedTimeMin: round(f.observed, 4),
          segments: f.segments.map((sg) => {
            const it = r.products.reduce((acc, p) => acc || p.films.list.find((x) => x.key === sg.key), null);
            return { product: sg.productName, observedTimeMin: round(sg.observed, 4), pieces: it ? it.pieces : null };
          }),
        })),
        products: r.multiProduct
          ? r.products.map((p) => ({
              product: p.name,
              cycleNormalTimeMin: round(p.kpis.sumNormal, 4),
              standardTimeMin: round(p.kpis.standardTime, 4),
              capacityPcsDay: p.kpis.capacity,
              status: p.kpis.status,
              demandPcsDay: p.demand,
              considerarNoMix: p.inMix,
              acyclicTime: p.summary.acyclic,
              elements: p.summary.elements.length,
            }))
          : undefined,
        product: r.multiProduct ? r.product.name : undefined,
        mix: r.mix
          ? {
              netTimeMin: round(r.mix.netTime, 4),
              loadMin: round(r.mix.load, 4),
              occupancyPct: round(r.mix.occupancyPct, 2),
              taktMixMin: round(r.mix.taktMix, 4),
              weightedStandardTimeMin: round(r.mix.weightedTP, 4),
              status: r.mix.status,
              partial: r.mix.partial,
              note: r.mix.partial ? `Mix parcial: ${r.mix.excluded.join(", ")} fora da carga (ocupação subestimada)` : "",
              issues: r.mix.issues,
              products: r.mix.items.map((i) => ({
                product: i.name,
                considerarNoMix: i.inMix,
                demandPcsDay: i.demand,
                standardTimeMin: round(i.tp, 4),
                loadMin: round(i.load, 4),
              })),
            }
          : undefined,
        acyclicTime: r.summary.acyclic,
        // Vários operadores (REV 1.14): resultados por operador e do posto, por produto
        operadores: r.multiOperator
          ? {
              numero: r.operatorCount,
              tipo: r.operatorKind,
              porProduto: r.products.map((p) => ({
                produto: p.name,
                posto: p.posto
                  ? {
                      cicloMin: round(p.posto.cycle, 6),
                      operadorDoCiclo: p.posto.cycleLabel,
                      conteudoMin: round(p.posto.content, 6),
                      esperaMin: round(p.posto.wait, 6),
                      balanceamentoPct: round(p.posto.balancePct, 2),
                      operadoresIdeais: round(p.posto.opsIdeal, 3),
                      capacidadePcsDia: p.kpis.capacity,
                    }
                  : null,
                operadores: (p.operators || []).map((o) => ({
                  operador: o.label,
                  tempoNormalMin: round(o.tn, 6),
                  tempoPadraoMin: round(o.tp, 6),
                  esperaMin: round(o.wait, 6),
                  conteudoMin: round(o.content, 6),
                })),
              })),
            }
          : undefined,
        // Etapas do processo (REV 1.15), por produto
        etapas: r.withEtapas
          ? r.products.map((p) => ({
              produto: p.name,
              etapas: (p.etapas || []).map((e) => ({
                ordem: e.order,
                etapa: e.name,
                tempoNormalMin: round(e.tn, 6),
                tempoPadraoMin: round(e.tp, 6),
                esperaMin: round(e.wait, 6),
                conteudoMin: round(e.content, 6),
                operadores: e.operators ? e.operators.map((o) => o.label) : undefined,
              })),
            }))
          : undefined,
        avisos: r.warnings.concat(r.checks),
        summary: r.summary.elements.map((g) => ({
          seq: g.seq,
          etapa: g.etapa || undefined,
          element: g.name,
          type: g.type,
          occurrences: g.occurrences,
          quantity: round(g.sumQuantity, 4),
          totalTimeMin: round(g.sumNormal, 4),
          cycleTimeMin: round(g.cycleTime, 4),
          sharePct: round(g.sharePct, 2),
          value: g.value ? VALUES[g.value].label : "",
          waste: g.waste ? WASTES[g.waste] : "",
          action: g.action,
          conflicts: g.conflicts,
        })),
        elements: r.rows.map((row) => ({
          id: row.id,
          seq: row.seq,
          film: row.film,
          operador: row.operator,
          etapa: row.etapa || undefined,
          type: row.type,
          subtractedTimeMin: round(row.subtractedTime, 4),
          normalTimeMin: round(row.normalTime, 4),
          unitTimeMin: round(row.unitTime, 4),
          errors: row.errors,
        })),
      },
    });
    return JSON.stringify(out, null, 2);
  }

  function round(n, d) {
    if (n == null || !Number.isFinite(n)) return null;
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }

  /* ==========================================================================
     EXPORTAÇÃO CSV (EXCEL pt-BR: separador ";" e vírgula decimal)
     ========================================================================== */

  const MIX_STATUS = { atende: "Atende o mix", sobrecarga: "Sobrecarga", incompleto: "Incompleto", vazio: "Nenhum produto no mix" };

  const STATUS_LABELS = {
    "parametros-invalidos": "Parâmetros inválidos",
    aguardando: "Aguardando apontamentos",
    gargalo: "Gargalo (TP > Takt)",
    balanceado: "Balanceado (TP ≤ Takt)",
  };

  function buildCSV(study) {
    const r = computeStudy(study);
    const unit = r.unit;
    const u = TIME_UNITS[unit].label;
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const nt = (minutes) => (minutes == null ? "" : formatTime(minutes, unit).replace(/\./g, ""));
    const n4 = (v) => (v == null ? "" : formatNumber(v, 4).replace(/\./g, ""));
    const qtyMode = r.mode === "quantidade";
    const multi = r.multiProduct;
    const P = (v) => (multi ? [v] : []); // coluna Produto só com vários produtos
    const O = (v) => (r.multiOperator ? [v] : []); // coluna Operador só com 2+ operadores (REV 1.14)
    const E = (v) => (r.withEtapas ? [v] : []); // coluna Etapa só quando usada (REV 1.15)

    const lines = [];
    lines.push(["Cliente", q(study.clientName)].join(";"));
    lines.push(["Posto / Operação", q(study.processName)].join(";"));
    lines.push(["Leitura inicial (1ª filmagem)", q(study.videoStart || "00:00")].join(";"));
    lines.push(["Lançamento", qtyMode ? "Quantidade (planilha B+P)" : "Frequência"].join(";"));
    lines.push(["Unidade de tempo", TIME_UNITS[unit].name].join(";"));
    lines.push("");
    lines.push(
      [
        "Nº",
        "Filmagem",
        "Vídeo",
        ...O("Operador"),
        ...P("Produto"),
        ...E("Etapa"),
        "Elemento",
        "Tipo",
        qtyMode ? "Quantidade" : "Frequência (texto)",
        qtyMode ? "" : "Frequência (decimal)",
        "Tempo final (vídeo)",
        `Tempo subtraído (${u})`,
        "Ritmo (%)",
        `Tempo normal (${u})`,
        qtyMode ? `Tempo / un (${u})` : "",
        "Valor",
        "Desperdício",
        "Ação Kaizen (ECRS)",
        "Erros",
      ].join(";")
    );
    study.elements.forEach((el, i) => {
      const row = r.rows[i];
      lines.push(
        [
          row.seq,
          row.film,
          q(r.filmList[row.film - 1].video),
          ...O(q(r.operatorLabel(row.operator))),
          ...P(q(row.product || "(sem produto)")),
          ...E(q(row.etapa || "(sem etapa)")),
          q(el.description),
          row.type === "A" ? "Acíclico" : "Cíclico",
          // Fórmula ="1/50" impede que o Excel converta a fração em data (ex.: 1/5 → 01/mai).
          qtyMode ? q(el.quantity) : q(`="${el.frequency}"`),
          qtyMode ? "" : n4(row.frequency),
          q(el.videoTime),
          nt(row.subtractedTime),
          q(el.pace),
          nt(row.normalTime),
          qtyMode ? nt(row.unitTime) : "",
          q(VALUES[el.value] ? VALUES[el.value].label : ""),
          q(WASTES[el.waste] || ""),
          q(el.kaizen),
          q(row.errors.join(" | ")),
        ].join(";")
      );
    });

    lines.push("");
    lines.push("RESUMO POR ELEMENTO (Listagem de Elementos)");
    lines.push(
      ["Nº", ...P("Produto"), ...E("Etapa"), "Elemento", "Tipo", "Ocorrências", qtyMode ? "Qtd total" : "", `Tempo total (${u})`, `Tempo no ciclo (${u})`, "% do ciclo", "Valor", "Desperdício", "Ação"].join(";")
    );
    (multi ? r.products : [r.product]).forEach((pr) => pr.summary.elements.forEach((g) => {
      lines.push(
        [
          g.seq,
          ...P(q(pr.name)),
          ...E(q(g.etapa)),
          q(g.name),
          g.type === "A" ? "Acíclico" : "Cíclico",
          g.occurrences,
          qtyMode ? n4(g.sumQuantity) : "",
          nt(g.sumNormal),
          nt(g.cycleTime),
          formatNumber(g.sharePct, 1),
          q(g.value ? VALUES[g.value].label : ""),
          q(g.waste ? WASTES[g.waste] : ""),
          q(g.action),
        ].join(";")
      );
    }));

    lines.push("");
    const k = r.kpis;
    if (multi) lines.push(["Produto (indicadores abaixo)", q(r.product.name)].join(";"));
    lines.push(["Filmagens", r.filmCount].join(";"));
    lines.push([`Tempo observado (${u})`, nt(r.totals.sumSubtracted)].join(";"));
    lines.push([`Tempo normal do ciclo (${u})`, nt(k.sumNormal)].join(";"));
    lines.push(["Tolerância (%)", n4(toFiniteOrNull(study.shiftParams.tolerancePct))].join(";"));
    lines.push([`Tempo padrão (${u}/pç)`, nt(k.standardTime)].join(";"));
    lines.push(["Tempo líquido disponível (min/dia)", n4(k.netTime)].join(";"));
    lines.push([`Takt time (${u}/pç)`, nt(k.taktTime)].join(";"));
    lines.push(["Capacidade (pçs/dia)", k.capacity == null ? "" : k.capacity].join(";"));
    lines.push(["Status", q(STATUS_LABELS[k.status])].join(";"));
    if (multi) {
      lines.push("");
      lines.push(["Produto", `Tempo normal do ciclo (${u})`, `Tempo padrão (${u}/pç)`, "Considerar no mix", "Demanda no mix (pçs/dia)", "Carga (min/dia)"].join(";"));
      r.products.forEach((pr, i) =>
        lines.push([q(pr.name), nt(pr.kpis.sumNormal), nt(pr.kpis.standardTime), pr.inMix ? "Sim" : "Não", n4(r.mix.items[i].demand), n4(r.mix.items[i].load)].join(";"))
      );
      lines.push("");
      lines.push("CARGA DO POSTO (MIX)");
      lines.push(["Carga total (min/dia)", n4(r.mix.load)].join(";"));
      lines.push(["Ocupação do posto (%)", r.mix.occupancyPct == null ? "" : formatNumber(r.mix.occupancyPct, 1)].join(";"));
      lines.push([`Takt misto (${u}/pç)`, nt(r.mix.taktMix)].join(";"));
      lines.push([`TC ponderado pelo mix (${u}/pç)`, nt(r.mix.weightedTP)].join(";"));
      lines.push(["Status do mix", q(MIX_STATUS[r.mix.status] + (r.mix.partial ? " (mix parcial)" : ""))].join(";"));
      r.mix.issues.forEach((t) => lines.push(["Aviso", q(t)].join(";")));
    }
    if (r.withEtapas) {
      lines.push("");
      lines.push("ETAPAS DO PROCESSO");
      lines.push([...P("Produto"), "Nº", "Etapa", ...O("Operador(es)"), `Tempo normal (${u}/pç)`, `Tempo padrão (${u}/pç)`, `Espera (${u}/pç)`, `Conteúdo (${u}/pç)`].join(";"));
      r.products.forEach((pr) =>
        (pr.etapas || []).forEach((e) =>
          lines.push(
            [...P(q(pr.name)), e.order, q(e.name), ...O(q(e.operators ? e.operators.map((o) => o.label).join(", ") : "")), nt(e.tn), nt(e.tp), nt(e.wait), nt(e.content)].join(";")
          )
        )
      );
    }
    if (r.multiOperator) {
      lines.push("");
      lines.push(`OPERADORES (${r.operatorCount}) — tipo ${r.operatorKind === "linha" ? "LINHA" : "POSTO"}`);
      lines.push([...P("Produto"), "Operador", `Tempo normal (${u}/pç)`, `Tempo padrão (${u}/pç)`, `Espera (${u}/pç)`, `Conteúdo (${u}/pç)`].join(";"));
      r.products.forEach((pr) => {
        (pr.operators || []).forEach((o) => lines.push([...P(q(pr.name)), q(o.label), nt(o.tn), nt(o.tp), nt(o.wait), nt(o.content)].join(";")));
        if (pr.posto) {
          lines.push(
            [...P(q(pr.name)), q("Posto"), "", nt(pr.posto.cycle), nt(pr.posto.wait), nt(pr.posto.content)].join(";") +
              `;Balanceamento (%);${pr.posto.balancePct == null ? "" : formatNumber(pr.posto.balancePct, 1)};Operadores ideais;${pr.posto.opsIdeal == null ? "" : formatNumber(pr.posto.opsIdeal, 2)}`
          );
        }
      });
    }
    r.warnings.concat(r.checks).forEach((t) => lines.push(["Aviso", q(t)].join(";")));
    return "\uFEFF" + lines.join("\r\n");
  }

  /* ==========================================================================
     SINCRONIZAÇÃO COM A PASTA (REGRAS PURAS)
     ========================================================================== */

  /**
   * Decide qual versão usar ao abrir um estudo que existe no navegador
   * (cache local) e/ou na pasta do OneDrive.
   *
   * local = { study, diskRevision, dirty } | null
   * disk  = estudo lido da pasta | null
   *
   * Retorna "use-local" | "use-disk" | "conflict" | "none".
   */
  function reconcile(local, disk) {
    if (!disk) return local ? "use-local" : "none";
    if (!local) return "use-disk";
    if (!local.dirty) return "use-disk";
    if (local.diskRevision != null && local.diskRevision === disk.revision) return "use-local";
    return "conflict";
  }

  /**
   * Antes de gravar: a versão na pasta ainda é a que este dispositivo conhece?
   * expectedRevision = revisão que este dispositivo leu/gravou por último (null = nunca).
   * diskStudy        = conteúdo atual na pasta (null = arquivo inexistente/vazio).
   */
  function canWriteOver(expectedRevision, diskStudy) {
    if (!diskStudy) return true;
    if (expectedRevision == null) return false;
    return diskStudy.revision === expectedRevision;
  }

  return {
    SCHEMA_ID,
    SCHEMA_VERSION,
    LEAN_TOOLS,
    elementGroupKey,
    PACE_MIN,
    PACE_MAX,
    STATUS_LABELS,
    MIX_STATUS,
    VALUES,
    WASTES,
    TIME_UNITS,
    ENTRY_MODES,
    FIRST_FILM_KEY,
    compile,
    timeUnit,
    entryMode,
    toUnit,
    formatTime,
    parseQuantity,
    elementKey,
    parseTimeInput,
    formatVideoTime,
    parseFrequency,
    parsePace,
    parseNumber,
    computeStudy,
    computeKpis,
    computeMix,
    productFillPlan,
    classificationPlan,
    operatorStudy,
    formatNumber,
    generateId,
    slugify,
    buildFileName,
    createElement,
    createStudy,
    normalizeStudy,
    serializeStudy,
    buildCSV,
    reconcile,
    canWriteOver,
  };
});
