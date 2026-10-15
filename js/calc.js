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
  const SCHEMA_VERSION = 1;

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

  /**
   * Calcula todas as linhas e os indicadores do estudo.
   *
   * Regras:
   *  - Tempo Subtraído (TS) = Tempo Final da linha − última leitura válida
   *    (a primeira linha usa a leitura inicial do vídeo).
   *  - Tempo Normal (TN) = TS × (Ritmo / 100) × Frequência.
   *  - Tempo Padrão (TP) = ΣTN × (1 + Tolerância / 100)  [método multiplicativo OIT].
   *  - Tempo Líquido Disponível (TLD) = Jornada Bruta − Paradas Planejadas.
   *  - Takt Time = TLD ÷ Demanda Diária.
   *  - Capacidade = ⌊TLD ÷ TP⌋ peças/dia.
   *  - Linha com erro não entra nos totais (e é sinalizada na interface).
   */
  function computeStudy(study) {
    const params = (study && study.shiftParams) || {};
    const start = parseTimeInput(study && study.videoStart);
    let previous = start.minutes != null ? start.minutes : 0;

    let sumSubtracted = 0;
    let sumNormal = 0;
    let errorCount = 0;

    const rows = ((study && study.elements) || []).map((el, index) => {
      const errors = [];
      const time = parseTimeInput(el.videoTime);
      const freq = parseFrequency(el.frequency);
      const pace = parsePace(el.pace);

      if (time.error) errors.push(time.error);
      if (freq.error) errors.push(freq.error);

      let subtractedTime = 0;
      let hasReading = false;
      if (time.minutes != null) {
        const diff = time.minutes - previous;
        if (diff < -EPS) {
          errors.push(`Tempo final menor que a leitura anterior (${formatVideoTime(previous)})`);
        } else {
          subtractedTime = Math.max(0, diff);
          previous = time.minutes;
          hasReading = true;
        }
      }

      // Ritmo só é exigido quando a linha tem leitura de tempo.
      if (hasReading && pace.error) errors.push(pace.error);

      const valid = errors.length === 0;
      const normalTime =
        valid && hasReading ? subtractedTime * (pace.value / 100) * freq.value : 0;

      if (valid) {
        sumSubtracted += subtractedTime;
        sumNormal += normalTime;
      } else {
        errorCount += 1;
      }

      return {
        id: el.id,
        seq: index + 1,
        type: freq.value != null && freq.value < 1 - EPS ? "A" : "C",
        frequency: freq.value,
        timeMinutes: time.minutes,
        subtractedTime,
        normalTime,
        errors,
        valid,
      };
    });

    const kpis = computeKpis(params, sumNormal);
    return {
      rows,
      totals: { sumSubtracted, sumNormal },
      kpis,
      errorCount,
      startError: start.error,
    };
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
    return formatters[d].format(n);
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
    return { shiftTimeMin: 528, plannedStopsMin: 48, dailyDemandPcs: 240, tolerancePct: 5 };
  }

  function createElement(overrides) {
    return Object.assign(
      { id: generateId(), description: "", frequency: "1", videoTime: "", pace: "100", kaizen: "" },
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
            frequency: e.frequency == null || e.frequency === "" ? "1" : str(e.frequency),
            videoTime: str(e.videoTime),
            pace: e.pace == null || e.pace === "" ? "100" : str(e.pace),
            kaizen: str(e.kaizen),
          })
        ),
    };
    if (!study.elements.length) study.elements.push(createElement());
    return { ok: true, study };
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
        netTimeMin: round(r.kpis.netTime, 4),
        taktTimeMin: round(r.kpis.taktTime, 4),
        sumNormalTimeMin: round(r.kpis.sumNormal, 4),
        standardTimeMin: round(r.kpis.standardTime, 4),
        capacityPcsDay: r.kpis.capacity,
        status: r.kpis.status,
        rowsWithErrors: r.errorCount,
        elements: r.rows.map((row) => ({
          id: row.id,
          seq: row.seq,
          type: row.type,
          subtractedTimeMin: round(row.subtractedTime, 4),
          normalTimeMin: round(row.normalTime, 4),
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

  const STATUS_LABELS = {
    "parametros-invalidos": "Parâmetros inválidos",
    aguardando: "Aguardando apontamentos",
    gargalo: "Gargalo (TP > Takt)",
    balanceado: "Balanceado (TP ≤ Takt)",
  };

  function buildCSV(study) {
    const r = computeStudy(study);
    const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const n3 = (v) => formatNumber(v, 3).replace(/\./g, "");
    const n4 = (v) => (v == null ? "" : formatNumber(v, 4).replace(/\./g, ""));

    const lines = [];
    lines.push(["Cliente", q(study.clientName)].join(";"));
    lines.push(["Posto / Operação", q(study.processName)].join(";"));
    lines.push(["Leitura inicial do vídeo", q(study.videoStart || "00:00")].join(";"));
    lines.push("");
    lines.push(
      [
        "Nº",
        "Elemento",
        "Tipo",
        "Frequência (texto)",
        "Frequência (decimal)",
        "Tempo final (vídeo)",
        "Tempo subtraído (min)",
        "Ritmo (%)",
        "Tempo normal (min)",
        "Ação Kaizen (ECRS)",
        "Erros",
      ].join(";")
    );
    study.elements.forEach((el, i) => {
      const row = r.rows[i];
      lines.push(
        [
          row.seq,
          q(el.description),
          row.type === "A" ? "Acíclico" : "Cíclico",
          // Fórmula ="1/50" impede que o Excel converta a fração em data (ex.: 1/5 → 01/mai).
          q(`="${el.frequency}"`),
          n4(row.frequency),
          q(el.videoTime),
          n3(row.subtractedTime),
          q(el.pace),
          n3(row.normalTime),
          q(el.kaizen),
          q(row.errors.join(" | ")),
        ].join(";")
      );
    });
    lines.push("");
    const k = r.kpis;
    lines.push(["Total tempo subtraído (min)", n3(r.totals.sumSubtracted)].join(";"));
    lines.push(["Total tempo normal (min)", n3(k.sumNormal)].join(";"));
    lines.push(["Tolerância (%)", n4(toFiniteOrNull(study.shiftParams.tolerancePct))].join(";"));
    lines.push(["Tempo padrão (min/pç)", n3(k.standardTime)].join(";"));
    lines.push(["Tempo líquido disponível (min/dia)", n3(k.netTime)].join(";"));
    lines.push(["Takt time (min/pç)", n3(k.taktTime)].join(";"));
    lines.push(["Capacidade (pçs/dia)", k.capacity == null ? "" : k.capacity].join(";"));
    lines.push(["Status", q(STATUS_LABELS[k.status])].join(";"));
    return "﻿" + lines.join("\r\n");
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
    PACE_MIN,
    PACE_MAX,
    STATUS_LABELS,
    parseTimeInput,
    formatVideoTime,
    parseFrequency,
    parsePace,
    parseNumber,
    computeStudy,
    computeKpis,
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
