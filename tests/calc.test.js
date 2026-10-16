/**
 * Testes do motor de cálculo (js/calc.js).
 * Executar: npm test   (ou: node --test tests/calc.test.js)
 * Sem dependências externas: usa o executor de testes nativo do Node.js (18+).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");

const close = (actual, expected, msg) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg || ""} esperado ${expected}, obtido ${actual}`);

/** Estudo de teste no modo clássico (frequência, minutos, tolerância 5%). */
function study(elements, overrides) {
  const s = C.createStudy({
    clientName: "Cliente Teste",
    processName: "Posto 01",
    id: "abcd1234-0000-4000-8000-000000000000",
    settings: { entryMode: "frequencia", timeUnit: "min" },
    shiftParams: { tolerancePct: 5 },
  });
  s.elements = elements.map((e) => C.createElement(e));
  return Object.assign(s, overrides || {});
}

/* ==========================================================================
   CONVERSÃO DE TEMPO (MÁSCARA RÁPIDA → MINUTOS CENTESIMAIS)
   ========================================================================== */

test("tempo: '132' vira 01:32 = 1,5333 min", () => {
  const r = C.parseTimeInput("132");
  assert.equal(r.formatted, "01:32");
  close(r.minutes, 1 + 32 / 60);
  assert.equal(r.error, null);
});

test("tempo: '01:30' = 1,500 min (exemplo da especificação)", () => {
  const r = C.parseTimeInput("01:30");
  assert.equal(r.formatted, "01:30");
  close(r.minutes, 1.5);
});

test("tempo: até 2 dígitos são segundos corridos ('90' → 01:30, '5' → 00:05)", () => {
  assert.equal(C.parseTimeInput("90").formatted, "01:30");
  assert.equal(C.parseTimeInput("5").formatted, "00:05");
  close(C.parseTimeInput("5").minutes, 5 / 60);
});

test("tempo: HMMSS e H:MM:SS para vídeos acima de 1 hora", () => {
  const a = C.parseTimeInput("10532");
  const b = C.parseTimeInput("1:05:32");
  assert.equal(a.formatted, "1:05:32");
  assert.equal(b.formatted, "1:05:32");
  close(a.minutes, 65 + 32 / 60);
  close(b.minutes, 65 + 32 / 60);
});

test("tempo: MMSS com minutos ≥ 60 é aceito e exibido como H:MM:SS ('6532')", () => {
  const r = C.parseTimeInput("6532");
  close(r.minutes, 65 + 32 / 60);
  assert.equal(r.formatted, "1:05:32");
});

test("tempo: erros de digitação são recusados (não 'corrigidos' em silêncio)", () => {
  for (const s of ["199", "05:75", "1.5", "12,5", "1:2:3:4", "abc", "1:65:00", "16500"]) {
    const r = C.parseTimeInput(s);
    assert.equal(r.minutes, null, `"${s}" deveria ser inválido`);
    assert.ok(r.error, `"${s}" deveria ter mensagem de erro`);
  }
});

test("tempo: vazio não é erro", () => {
  assert.deepEqual(C.parseTimeInput(""), { formatted: "", minutes: null, error: null });
  assert.deepEqual(C.parseTimeInput("   "), { formatted: "", minutes: null, error: null });
});

test("tempo: formatVideoTime arredonda para o segundo", () => {
  assert.equal(C.formatVideoTime(1.5), "01:30");
  assert.equal(C.formatVideoTime(0), "00:00");
  assert.equal(C.formatVideoTime(59 + 59 / 60), "59:59");
  assert.equal(C.formatVideoTime(60), "1:00:00");
});

/* ==========================================================================
   FREQUÊNCIA, RITMO E NÚMEROS
   ========================================================================== */

test("frequência: '1/50' = 0,02; '0,02' = 0,02; vazio = 1; '2' = 2", () => {
  close(C.parseFrequency("1/50").value, 0.02);
  close(C.parseFrequency("0,02").value, 0.02);
  close(C.parseFrequency(" 1 / 50 ").value, 0.02);
  assert.equal(C.parseFrequency("").value, 1);
  assert.equal(C.parseFrequency("2").value, 2);
});

test("frequência: inválida ou zero gera erro (não vira 1 em silêncio)", () => {
  for (const s of ["0", "1/0", "abc", "-1", "1/", "/50"]) {
    const r = C.parseFrequency(s);
    assert.equal(r.value, null, `"${s}" deveria ser inválido`);
    assert.ok(r.error);
  }
});

test("ritmo: aceita 50–150%, com vírgula e símbolo %", () => {
  assert.equal(C.parsePace("100").value, 100);
  assert.equal(C.parsePace("95%").value, 95);
  assert.equal(C.parsePace("97,5").value, 97.5);
  assert.equal(C.parsePace("50").value, 50);
  assert.equal(C.parsePace("150").value, 150);
});

test("ritmo: fora da faixa ou inválido gera erro", () => {
  for (const s of ["9", "49", "151", "900", "", "abc", "1,05"]) {
    assert.equal(C.parsePace(s).value, null, `"${s}" deveria ser inválido`);
  }
});

test("números: formato brasileiro e internacional", () => {
  assert.equal(C.parseNumber("480"), 480);
  assert.equal(C.parseNumber("480,5"), 480.5);
  assert.equal(C.parseNumber("1.234,5"), 1234.5);
  assert.equal(C.parseNumber("480.5"), 480.5);
  assert.equal(C.parseNumber(""), null);
  assert.equal(C.parseNumber("12a"), null);
});

/* ==========================================================================
   LEITURA CONTÍNUA E TEMPO NORMAL
   ========================================================================== */

test("leitura contínua: TS = tempo final − tempo final anterior", () => {
  const r = C.computeStudy(
    study([
      { videoTime: "30", pace: "100" },
      { videoTime: "01:15", pace: "100" },
      { videoTime: "02:00", pace: "100" },
    ])
  );
  close(r.rows[0].subtractedTime, 0.5);
  close(r.rows[1].subtractedTime, 0.75);
  close(r.rows[2].subtractedTime, 0.75);
  close(r.totals.sumSubtracted, 2);
});

test("leitura contínua: primeira linha usa a leitura inicial do vídeo", () => {
  const r = C.computeStudy(study([{ videoTime: "01:30", pace: "100" }], { videoStart: "01:00" }));
  close(r.rows[0].subtractedTime, 0.5);
});

test("leitura contínua: linha sem tempo é ignorada e não quebra a sequência", () => {
  const r = C.computeStudy(
    study([
      { videoTime: "30", pace: "100" },
      { description: "em digitação", videoTime: "", pace: "100" },
      { videoTime: "01:00", pace: "100" },
    ])
  );
  close(r.rows[1].subtractedTime, 0);
  close(r.rows[2].subtractedTime, 0.5);
  assert.equal(r.errorCount, 0);
});

test("leitura contínua: tempo menor que o anterior é erro e a linha seguinte usa a última leitura válida", () => {
  const r = C.computeStudy(
    study([
      { videoTime: "01:00", pace: "100" },
      { videoTime: "00:40", pace: "100" }, // erro de digitação
      { videoTime: "01:30", pace: "100" },
    ])
  );
  assert.equal(r.rows[1].valid, false);
  assert.match(r.rows[1].errors[0], /leitura anterior/);
  close(r.rows[2].subtractedTime, 0.5, "deveria calcular a partir de 01:00");
  assert.equal(r.errorCount, 1);
  close(r.totals.sumSubtracted, 1.5, "linha com erro fica fora do total");
});

test("nova filmagem: a leitura reinicia em 00:00 (célula amarela da planilha REV2)", () => {
  // Reproduz o trecho da planilha: ...00:17:13 → 00:17:57 | nova filmagem: 00:00 → 00:40 → 01:09
  const r = C.computeStudy(
    study([
      { videoTime: "17:13", pace: "100" },
      { videoTime: "17:57", pace: "100" },
      { videoTime: "00:40", pace: "100", newVideo: true },
      { videoTime: "01:09", pace: "100" },
    ])
  );
  assert.equal(r.errorCount, 0);
  close(r.rows[1].subtractedTime, 44 / 60);
  close(r.rows[2].subtractedTime, 40 / 60, "1ª linha do novo vídeo conta a partir de 00:00");
  close(r.rows[3].subtractedTime, 29 / 60);
  assert.deepEqual(r.rows.map((x) => x.film), [1, 1, 2, 2]);
  assert.equal(r.rows[2].newVideo, true);
  assert.equal(r.filmCount, 2);
});

test("nova filmagem: sem a marcação, o tempo menor continua sendo erro", () => {
  const r = C.computeStudy(study([{ videoTime: "17:57", pace: "100" }, { videoTime: "00:40", pace: "100" }]));
  assert.equal(r.rows[1].valid, false);
  assert.equal(r.filmCount, 1);
});

test("nova filmagem: vale mesmo quando o 1º tempo do novo vídeo é maior que o anterior", () => {
  const r = C.computeStudy(
    study([
      { videoTime: "00:30", pace: "100" },
      { videoTime: "02:39", pace: "100", newVideo: true }, // vídeo novo: 02:39 desde 00:00
    ])
  );
  close(r.rows[1].subtractedTime, 2 + 39 / 60);
});

test("nova filmagem: marcação na 1ª linha é ignorada (ela já inicia a filmagem 1) e a leitura inicial vale só para a 1ª", () => {
  const r = C.computeStudy(
    study(
      [
        { videoTime: "01:30", pace: "100", newVideo: true },
        { videoTime: "00:20", pace: "100", newVideo: true },
      ],
      { videoStart: "01:00" }
    )
  );
  close(r.rows[0].subtractedTime, 0.5, "1ª linha usa a leitura inicial");
  close(r.rows[1].subtractedTime, 20 / 60, "2ª filmagem começa em 00:00");
  assert.equal(r.rows[0].newVideo, false);
  assert.equal(r.filmCount, 2);
});

test("nova filmagem: 9 filmagens somam o tempo total observado", () => {
  const els = [];
  for (let f = 0; f < 9; f++) {
    els.push({ videoTime: "01:00", pace: "100", newVideo: f > 0 });
    els.push({ videoTime: "02:30", pace: "100" });
  }
  const r = C.computeStudy(study(els));
  assert.equal(r.filmCount, 9);
  close(r.totals.sumSubtracted, 9 * 2.5);
});

test("tempo normal: TN = TS × (ritmo/100) × frequência", () => {
  const r = C.computeStudy(
    study([
      { videoTime: "01:00", pace: "110", frequency: "1" }, // 1,0 × 1,10 × 1 = 1,10
      { videoTime: "03:00", pace: "100", frequency: "1/50", type: "A" }, // 2,0 × 1,00 × 0,02 = 0,04 (troca de caixa)
      { videoTime: "03:30", pace: "90", frequency: "2" }, // 0,5 × 0,90 × 2 = 0,90
    ])
  );
  close(r.rows[0].normalTime, 1.1);
  close(r.rows[1].normalTime, 0.04, "frequência 1/50 deve MULTIPLICAR por 0,02 (não dividir)");
  close(r.rows[2].normalTime, 0.9);
  assert.equal(r.rows[1].type, "A");
  assert.equal(r.rows[0].type, "C");
  assert.equal(r.rows[2].type, "C");
  close(r.totals.sumNormal, 2.04);
});

test("tempo normal: ritmo inválido em linha com leitura marca erro e fica fora do total", () => {
  const r = C.computeStudy(study([{ videoTime: "01:00", pace: "900" }]));
  assert.equal(r.rows[0].valid, false);
  close(r.totals.sumNormal, 0);
});

/* ==========================================================================
   INDICADORES LEAN (TLD, TAKT, TP, CAPACIDADE, GARGALO)
   ========================================================================== */

test("indicadores: TLD, takt e TP = ΣTN × (1 + tolerância) — exemplo do painel", () => {
  // Jornada 528, paradas 48 → TLD 480; demanda 240 → takt 2,00 min/pç
  const k = C.computeKpis({ shiftTimeMin: 528, plannedStopsMin: 48, dailyDemandPcs: 240, tolerancePct: 5 }, 1.8);
  close(k.netTime, 480);
  close(k.taktTime, 2);
  close(k.standardTime, 1.89); // 1,8 × 1,05
  assert.equal(k.capacity, 253); // ⌊480 / 1,89⌋
  assert.equal(k.status, "balanceado");
  close(k.slackPct, 5.5);
});

test("indicadores: TP acima do takt = GARGALO, com diferença em minutos", () => {
  const k = C.computeKpis({ shiftTimeMin: 528, plannedStopsMin: 48, dailyDemandPcs: 240, tolerancePct: 10 }, 2);
  close(k.standardTime, 2.2);
  assert.equal(k.status, "gargalo");
  close(k.diffMin, 0.2);
  assert.equal(k.capacity, 218);
});

test("indicadores: TP exatamente igual ao takt = balanceado (sem erro de arredondamento)", () => {
  const k = C.computeKpis({ shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 240, tolerancePct: 0 }, 2);
  assert.equal(k.status, "balanceado");
  assert.equal(k.capacity, 240);
});

test("indicadores: demanda zero NÃO mostra gargalo (parâmetros inválidos)", () => {
  const k = C.computeKpis({ shiftTimeMin: 528, plannedStopsMin: 48, dailyDemandPcs: 0, tolerancePct: 5 }, 1.5);
  assert.equal(k.status, "parametros-invalidos");
  assert.equal(k.taktTime, null);
  assert.ok(k.issues.some((m) => /demanda/i.test(m)));
});

test("indicadores: paradas maiores que a jornada são sinalizadas", () => {
  const k = C.computeKpis({ shiftTimeMin: 100, plannedStopsMin: 120, dailyDemandPcs: 10, tolerancePct: 5 }, 1);
  assert.equal(k.netTime, 0);
  assert.equal(k.status, "parametros-invalidos");
});

test("indicadores: sem apontamentos = aguardando", () => {
  const k = C.computeKpis({ shiftTimeMin: 528, plannedStopsMin: 48, dailyDemandPcs: 240, tolerancePct: 5 }, 0);
  assert.equal(k.status, "aguardando");
  assert.equal(k.capacity, null);
});

test("indicadores: estudo completo de ponta a ponta", () => {
  const s = study([
    { description: "Pegar peça", videoTime: "12", pace: "100" }, // 0,2
    { description: "Soldar", videoTime: "1:12", pace: "110" }, // 1,0 × 1,1 = 1,1
    { description: "Trocar caixa", videoTime: "2:12", pace: "100", frequency: "1/50" }, // 1,0 × 0,02 = 0,02
  ]);
  const r = C.computeStudy(s);
  close(r.kpis.sumNormal, 1.32);
  close(r.kpis.standardTime, 1.32 * 1.05);
  assert.equal(r.kpis.status, "balanceado");
  assert.equal(r.kpis.capacity, Math.floor(480 / (1.32 * 1.05)));
});

/* ==========================================================================
   FORMATAÇÃO, NOME DE ARQUIVO E MODELO JSON
   ========================================================================== */

test("formatação pt-BR usa vírgula decimal", () => {
  assert.equal(C.formatNumber(1.5333, 3), "1,533");
  assert.equal(C.formatNumber(1234.5, 1), "1.234,5");
  assert.equal(C.formatNumber(null, 2), "--");
});

test("nome do arquivo: sem acentos, com data e ID curto", () => {
  const name = C.buildFileName("Indústria Metalúrgica Alfa", "Montagem Final - Posto 01", "2026-10-15T10:00:00Z", "a1b2c3d4-0000-4000-8000-000000000000");
  assert.equal(name, "Crono_Industria_Metalurgica_Alfa_Montagem_Final_Posto_01_2026-10-15_a1b2c3d4.json");
});

test("nome do arquivo: fixo após a criação (renomear cliente não altera)", () => {
  const s = C.createStudy({ clientName: "Alfa", processName: "Posto 1" });
  const original = s.fileName;
  s.clientName = "Beta";
  const r = C.normalizeStudy(JSON.parse(C.serializeStudy(s)));
  assert.equal(r.study.fileName, original);
});

test("IDs gerados são únicos (formato UUID)", () => {
  const ids = new Set(Array.from({ length: 200 }, () => C.generateId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("JSON: ida e volta preserva os dados de entrada", () => {
  const s = study([{ description: "Soldar \"peça\"", videoTime: "01:12", pace: "105", frequency: "1/20", kaizen: "Eliminar" }], {
    videoStart: "00:10",
  });
  const r = C.normalizeStudy(JSON.parse(C.serializeStudy(s)));
  assert.ok(r.ok);
  assert.equal(r.study.elements[0].description, 'Soldar "peça"');
  assert.equal(r.study.elements[0].frequency, "1/20");
  assert.equal(r.study.elements[0].newVideo, false);
  assert.equal(r.study.videoStart, "00:10");
  assert.equal(r.study.results, undefined, "resultados calculados não são reimportados");
});

test("JSON: marcação de nova filmagem é preservada e o resumo informa as filmagens", () => {
  const s = study([{ videoTime: "01:00" }, { videoTime: "00:30", newVideo: true }]);
  const out = JSON.parse(C.serializeStudy(s));
  assert.equal(out.results.filmCount, 2);
  assert.equal(out.results.elements[1].film, 2);
  const r = C.normalizeStudy(out);
  assert.equal(r.study.elements[1].newVideo, true);
  assert.equal(r.study.elements[0].newVideo, false);
});

test("CSV: coluna Filmagem e total de filmagens", () => {
  const csv = C.buildCSV(study([{ videoTime: "01:00" }, { videoTime: "00:30", newVideo: true }]));
  const lines = csv.split("\r\n");
  assert.ok(lines.some((l) => l.startsWith("Nº;Filmagem;")));
  assert.ok(lines.some((l) => l.startsWith("2;2;")));
  assert.ok(lines.includes("Filmagens;2"));
});

test("JSON: resumo de resultados é gravado para leitura externa", () => {
  const s = study([{ videoTime: "01:00", pace: "100" }]);
  const out = JSON.parse(C.serializeStudy(s));
  assert.equal(out.results.unit, "minutos centesimais");
  assert.equal(out.results.cycleNormalTimeMin, 1);
  assert.equal(out.results.observedTimeMin, 1);
  assert.equal(out.results.standardTimeMin, 1.05);
});

test("JSON: arquivos inválidos ou de versão futura são recusados", () => {
  assert.equal(C.normalizeStudy(null).ok, false);
  assert.equal(C.normalizeStudy([]).ok, false);
  assert.equal(C.normalizeStudy({ foo: 1 }).ok, false);
  assert.equal(C.normalizeStudy({ schema: C.SCHEMA_ID, schemaVersion: 1 }).ok, false, "sem id");
  const future = C.normalizeStudy({ schema: C.SCHEMA_ID, schemaVersion: 99, id: "x" });
  assert.equal(future.ok, false);
  assert.match(future.error, /versão mais nova/);
});

test("JSON: campos ausentes recebem valores padrão", () => {
  const r = C.normalizeStudy({ schema: C.SCHEMA_ID, schemaVersion: 1, id: "abc", elements: [{ description: "x" }] });
  assert.ok(r.ok);
  assert.equal(r.study.elements[0].pace, "100");
  assert.equal(r.study.elements[0].frequency, "1");
  assert.equal(r.study.revision, 0);
  assert.match(r.study.fileName, /^Crono_.+\.json$/);
});

/* ==========================================================================
   CSV
   ========================================================================== */

test("CSV: BOM UTF-8, separador ';', vírgula decimal e fração protegida contra conversão em data", () => {
  const csv = C.buildCSV(study([{ description: "Troca; caixa", videoTime: "02:00", pace: "100", frequency: "1/5" }]));
  assert.ok(csv.startsWith("﻿"));
  const line = csv.split("\r\n").find((l) => l.startsWith("1;"));
  assert.ok(line.includes('"Troca; caixa"'));
  assert.ok(line.includes('"=""1/5"""'));
  assert.ok(line.includes("2,000"));
  assert.ok(line.includes("0,400")); // 2,0 × 1,0 × 0,2
});

/* ==========================================================================
   SINCRONIZAÇÃO COM A PASTA (PROTEÇÃO CONTRA CONFLITO NO ONEDRIVE)
   ========================================================================== */

test("conciliação: tabela de decisão ao abrir um estudo", () => {
  const disk = { revision: 5 };
  assert.equal(C.reconcile(null, null), "none");
  assert.equal(C.reconcile({ dirty: false }, null), "use-local");
  assert.equal(C.reconcile(null, disk), "use-disk");
  assert.equal(C.reconcile({ dirty: false, diskRevision: 3 }, disk), "use-disk", "sem alterações locais: pasta prevalece");
  assert.equal(C.reconcile({ dirty: true, diskRevision: 5 }, disk), "use-local", "alteração local sobre a mesma base");
  assert.equal(C.reconcile({ dirty: true, diskRevision: 4 }, disk), "conflict", "ambos alteraram");
  assert.equal(C.reconcile({ dirty: true, diskRevision: null }, disk), "conflict");
});

test("conflito: só grava se a pasta ainda estiver na revisão conhecida", () => {
  assert.equal(C.canWriteOver(null, null), true, "arquivo novo");
  assert.equal(C.canWriteOver(3, null), true, "arquivo removido da pasta: recria");
  assert.equal(C.canWriteOver(3, { revision: 3 }), true);
  assert.equal(C.canWriteOver(3, { revision: 4 }), false, "outro notebook gravou antes");
  assert.equal(C.canWriteOver(null, { revision: 1 }), false, "arquivo desconhecido não é sobrescrito");
});

/* ==========================================================================
   PADRÃO DA PLANILHA B+P: QUANTIDADE, TIPO C/A MANUAL E RESUMO POR ELEMENTO
   ========================================================================== */

/** Estudo no padrão da planilha REV2 (quantidade, segundos, tolerância 0%). */
function studyQty(rows) {
  const s = C.createStudy({ clientName: "Cliente", processName: "Posto" });
  s.elements = rows.map((e) => C.createElement(e));
  return s;
}

test("novo estudo segue a planilha: quantidade, segundos, tolerância 0% e ritmo 100%", () => {
  const s = C.createStudy({ clientName: "A", processName: "B" });
  assert.equal(C.entryMode(s), "quantidade");
  assert.equal(C.timeUnit(s), "s");
  assert.equal(s.shiftParams.tolerancePct, 0);
  assert.equal(s.elements[0].pace, "100");
  assert.equal(s.elements[0].type, "C");
  assert.equal(s.elements[0].quantity, "1");
});

test("resumo (quantidade): Tipo C = Σtempo ÷ Σquantidade, como a coluna 'tempo de ciclo' da planilha", () => {
  const r = C.computeStudy(
    studyQty([
      { description: "Preencher bandeja", videoTime: "32", quantity: "2", type: "C" }, // 32 s / 2 un
      { description: "Transporte", videoTime: "37", type: "A" }, // 5 s
      { description: "Preencher bandeja", videoTime: "1:35", quantity: "3", type: "C" }, // 58 s / 3 un
    ])
  );
  const g = r.summary.elements;
  assert.equal(g.length, 2, "agrupa as 2 linhas de mesmo nome");
  assert.equal(g[0].occurrences, 2);
  assert.equal(g[0].sumQuantity, 5);
  close(g[0].cycleTime * 60, 90 / 5, "(32 + 58) ÷ (2 + 3) = 18 s/un");
  close(g[1].cycleTime * 60, 5);
  close(r.kpis.sumNormal * 60, 23, "ciclo = 18 + 5");
  close(r.totals.sumSubtracted * 60, 95, "tempo observado continua sendo a soma de tudo");
});

test("resumo (quantidade): Tipo A soma os tempos e ignora a quantidade (planilha REV2)", () => {
  const r = C.computeStudy(
    studyQty([
      { description: "Corte das treliças", videoTime: "32", quantity: "2", type: "A" },
      { description: "Movimentação", videoTime: "37", type: "A" },
      { description: "Corte das treliças", videoTime: "1:41", quantity: "3", type: "A" },
    ])
  );
  close(r.summary.elements[0].cycleTime * 60, 32 + 64);
  close(r.summary.elements[0].sumQuantity, 5);
});

test("resumo: agrupa ignorando maiúsculas e espaços extras; linhas sem descrição ficam separadas", () => {
  const r = C.computeStudy(
    studyQty([
      { description: "Transporte de material", videoTime: "10" },
      { description: "  transporte   DE material ", videoTime: "20" },
      { description: "", videoTime: "30" },
      { description: "", videoTime: "40" },
    ])
  );
  assert.equal(r.summary.elements.length, 3);
  assert.equal(r.summary.elements[0].occurrences, 2);
  assert.equal(r.summary.elements[0].name, "Transporte de material");
});

test("resumo (frequência): média das ocorrências; a frequência rateia o acíclico", () => {
  const s = studyQty([
    { description: "Soldar", videoTime: "1:00", frequency: "1" },
    { description: "Soldar", videoTime: "3:00", frequency: "1" },
    { description: "Trocar caixa", videoTime: "4:00", frequency: "1/50", type: "A" },
  ]);
  s.settings.entryMode = "frequencia";
  const r = C.computeStudy(s);
  close(r.summary.elements[0].cycleTime, 1.5, "(1 + 2) ÷ 2 ocorrências");
  close(r.summary.elements[1].cycleTime, 0.02);
  close(r.kpis.sumNormal, 1.52);
});

test("resumo: ritmo e tolerância continuam valendo quando informados", () => {
  const s = studyQty([{ description: "Montar", videoTime: "1:00", pace: "110" }]);
  s.shiftParams.tolerancePct = 10;
  const r = C.computeStudy(s);
  close(r.summary.elements[0].cycleTime, 1.1);
  close(r.kpis.standardTime, 1.21);
});

test("resumo: valor, desperdício e ação automática (Manter / Eliminar / Reduzir)", () => {
  const r = C.computeStudy(
    studyQty([
      { description: "Corte", videoTime: "10", value: "AG" },
      { description: "Procurar peças", videoTime: "20", value: "NA", waste: "movimentacao" },
      { description: "Anotar OP", videoTime: "30", value: "IN", waste: "processamento" },
      { description: "Limpeza", videoTime: "40" },
    ])
  );
  assert.deepEqual(
    r.summary.elements.map((g) => g.action),
    ["Manter atividade", "Eliminar atividade", "Reduzir atividade", "Classificar valor"]
  );
  assert.equal(r.summary.elements[1].waste, "movimentacao");
  close(r.summary.elements.reduce((a, g) => a + g.sharePct, 0), 100);
});

test("resumo: classificação divergente no mesmo elemento é sinalizada", () => {
  const r = C.computeStudy(
    studyQty([
      { description: "Transporte", videoTime: "10", value: "NA", type: "A" },
      { description: "Transporte", videoTime: "20", value: "IN", type: "C" },
    ])
  );
  assert.deepEqual(r.summary.elements[0].conflicts.sort(), ["tipo", "valor"]);
  assert.equal(r.summary.elements[0].value, "NA", "prevalece a 1ª ocorrência");
  assert.equal(r.summary.conflictCount, 1);
});

test("resumo: linhas com erro ou sem tempo ficam fora", () => {
  const r = C.computeStudy(
    studyQty([
      { description: "A", videoTime: "30" },
      { description: "B", videoTime: "" },
      { description: "C", videoTime: "20" }, // menor que a anterior → erro
      { description: "D", videoTime: "40", quantity: "0" }, // quantidade inválida
    ])
  );
  assert.deepEqual(r.summary.elements.map((g) => g.name), ["A"]);
  assert.equal(r.errorCount, 2);
});

test("unidades: segundos, minutos e horas", () => {
  assert.equal(C.formatTime(1.5, "s"), "90,0");
  assert.equal(C.formatTime(1.5, "min"), "1,500");
  assert.equal(C.formatTime(90, "h"), "1,5000");
  close(C.toUnit(2, "s"), 120);
});

test("quantidade: aceita vírgula; zero ou texto é erro", () => {
  assert.equal(C.parseQuantity("").value, 1);
  assert.equal(C.parseQuantity("2,5").value, 2.5);
  assert.equal(C.parseQuantity("0").value, null);
  assert.equal(C.parseQuantity("abc").value, null);
});

test("JSON de versão anterior (sem settings): mantém frequência, minutos e deduz o tipo pela frequência", () => {
  const r = C.normalizeStudy({
    schema: C.SCHEMA_ID,
    schemaVersion: 1,
    id: "x",
    elements: [{ description: "a", frequency: "1/50" }, { description: "b" }],
  });
  assert.equal(C.entryMode(r.study), "frequencia");
  assert.equal(C.timeUnit(r.study), "min");
  assert.equal(r.study.elements[0].type, "A");
  assert.equal(r.study.elements[1].type, "C");
});

test("JSON: valor/desperdício inválidos são descartados; classificação e resumo são gravados", () => {
  const r = C.normalizeStudy({
    schema: C.SCHEMA_ID,
    schemaVersion: 1,
    id: "x",
    settings: { entryMode: "quantidade", timeUnit: "h" },
    elements: [{ description: "a", value: "XX", waste: "nada" }, { description: "b", value: "NA", waste: "espera" }],
  });
  assert.equal(r.study.elements[0].value, "");
  assert.equal(r.study.elements[0].waste, "");
  assert.equal(r.study.elements[1].waste, "espera");
  assert.equal(C.timeUnit(r.study), "h");
  const s = studyQty([{ description: "Corte", videoTime: "30", value: "AG" }]);
  const out = JSON.parse(C.serializeStudy(s));
  assert.equal(out.results.summary[0].element, "Corte");
  assert.equal(out.results.summary[0].action, "Manter atividade");
  assert.equal(out.results.entryMode, "quantidade");
});

test("CSV: unidade escolhida e seção 'Resumo por elemento'", () => {
  const csv = C.buildCSV(
    studyQty([
      { description: "Corte", videoTime: "30", quantity: "2", value: "AG" },
      { description: "Corte", videoTime: "1:00", quantity: "1", value: "AG" },
    ])
  );
  const lines = csv.split("\r\n");
  assert.ok(lines.some((l) => l.includes("Tempo subtraído (s)")));
  assert.ok(lines.includes("RESUMO POR ELEMENTO (Listagem de Elementos)"));
  assert.ok(lines.some((l) => l.startsWith('1;"Corte";Cíclico;2;3,0000;60,0;20,0;100,0;"Agrega"')));
});

/* ==========================================================================
   PEÇAS POR FILMAGEM (REV 1.2): acíclicos convertidos em tempo por unidade
   ========================================================================== */

function twoFilms() {
  const s = C.createStudy({ clientName: "Cliente", processName: "Posto" });
  s.settings.entryMode = "quantidade";
  s.elements = [
    C.createElement({ description: "Pegar peça", type: "C", quantity: "1", videoTime: "10" }),
    C.createElement({ description: "Set-up", type: "A", videoTime: "40" }),
    C.createElement({ description: "Pegar peça", type: "C", quantity: "1", videoTime: "10", newVideo: true }),
    C.createElement({ description: "Limpar bancada", type: "A", videoTime: "30" }),
  ];
  return s;
}
const sec = (min) => min * 60;
const byName = (r, name) => r.summary.elements.find((g) => g.name === name);

test("filmagens: sem peças, o tipo A continua Σtempo (padrão da planilha)", () => {
  const r = C.computeStudy(twoFilms());
  assert.equal(r.films.list.length, 2);
  assert.equal(r.films.list[0].key, C.FIRST_FILM_KEY);
  close(sec(r.films.list[0].observed), 40, "F1 observada");
  close(sec(r.films.list[1].observed), 30, "F2 observada");
  assert.equal(r.summary.acyclic, "total");
  close(sec(byName(r, "Set-up").cycleTime), 30);
  close(sec(byName(r, "Pegar peça").cycleTime), 10);
  close(sec(r.summary.cycleNormal), 60);
});

test("filmagens: com as peças de todas as filmagens, tipo A = Σtempo ÷ Σpeças", () => {
  const s = twoFilms();
  s.filmPieces = { [C.FIRST_FILM_KEY]: "5", [s.elements[2].id]: "5" };
  const r = C.computeStudy(s);
  assert.equal(r.summary.acyclic, "por-unidade");
  assert.equal(r.films.piecesTotal, 10);
  close(sec(byName(r, "Set-up").cycleTime), 3, "30 s ÷ 10 peças");
  close(sec(byName(r, "Limpar bancada").cycleTime), 2, "20 s ÷ 10 peças");
  assert.equal(byName(r, "Set-up").perUnit, true);
  close(sec(byName(r, "Pegar peça").cycleTime), 10, "o cíclico não muda");
  close(sec(r.summary.cycleNormal), 15);
  close(sec(r.films.observedPerPiece), 7, "ciclo real observado = 70 s ÷ 10");
  // O tempo padrão (e o TC levado ao MFV) passa a ser por unidade.
  close(sec(r.kpis.standardTime), 15);
});

test("filmagens: peças incompletas ou inválidas mantêm o tipo A como Σtempo e avisam", () => {
  const s = twoFilms();
  s.filmPieces = { [C.FIRST_FILM_KEY]: "5" };
  let r = C.computeStudy(s);
  assert.equal(r.summary.acyclic, "incompleto");
  close(sec(byName(r, "Set-up").cycleTime), 30);
  s.filmPieces = { [C.FIRST_FILM_KEY]: "5", [s.elements[2].id]: "0" };
  r = C.computeStudy(s);
  assert.equal(r.summary.acyclic, "incompleto");
  assert.ok(r.films.list[1].error);
  // No modo frequência as peças são ignoradas (a frequência já rateia o acíclico).
  s.settings.entryMode = "frequencia";
  s.filmPieces = { [C.FIRST_FILM_KEY]: "5", [s.elements[2].id]: "5" };
  assert.equal(C.computeStudy(s).summary.acyclic, "total");
});

test("filmagens: peças gravadas no arquivo, normalizadas e resumidas no JSON", () => {
  const s = twoFilms();
  s.filmPieces = { [C.FIRST_FILM_KEY]: " 5 ", [s.elements[2].id]: 5, lixo: { x: 1 }, vazio: "" };
  const json = JSON.parse(C.serializeStudy(s));
  assert.equal(json.schemaVersion, C.SCHEMA_VERSION);
  assert.equal(json.results.acyclicTime, "por-unidade");
  assert.equal(json.results.films.length, 2);
  const back = C.normalizeStudy(json).study;
  assert.deepEqual(back.filmPieces, { [C.FIRST_FILM_KEY]: "5", [s.elements[2].id]: "5" });
  // Arquivo da versão anterior (sem filmPieces) abre normalmente.
  const old = C.normalizeStudy({ schema: C.SCHEMA_ID, schemaVersion: 1, id: "x", elements: [] }).study;
  assert.deepEqual(old.filmPieces, {});
});

/* ==========================================================================
   REV 1.3: INÍCIO POR FILMAGEM E PRODUTO POR LINHA
   ========================================================================== */

test("início por filmagem: a 1ª linha da filmagem desconta o início digitado", () => {
  const s = twoFilms();
  // F2 começa em 00:00 (padrão): 1ª linha = 10 s
  close(sec(C.computeStudy(s).rows[2].subtractedTime), 10);
  // F2 começa em 00:04: 1ª linha = 10 − 4 = 6 s; a linha seguinte não muda (30 − 10 = 20 s)
  s.filmStarts = { [s.elements[2].id]: "04" };
  const r = C.computeStudy(s);
  close(sec(r.rows[2].subtractedTime), 6);
  close(sec(r.rows[3].subtractedTime), 20);
  close(sec(r.filmList[1].start), 4);
  close(sec(r.filmList[1].observed), 26, "observado da F2 conta só o trecho analisado");
  // Tempo menor que o início da filmagem é erro (não é "corrigido")
  s.filmStarts = { [s.elements[2].id]: "15" };
  const bad = C.computeStudy(s);
  assert.equal(bad.rows[2].valid, false);
  assert.match(bad.rows[2].errors[0], /00:15/);
  // A 1ª filmagem continua usando a Leitura inicial
  s.filmStarts = {};
  s.videoStart = "05";
  const f1 = C.computeStudy(s);
  close(sec(f1.rows[0].subtractedTime), 5);
  assert.equal(f1.filmList[0].startRaw, "05");
});

function twoProducts() {
  const s = C.createStudy({ clientName: "Cliente", processName: "Posto" });
  s.settings.entryMode = "quantidade";
  s.elements = [
    C.createElement({ product: "Produto A", description: "Furar", type: "C", videoTime: "12" }),
    C.createElement({ product: "Produto A", description: "Furar", type: "C", videoTime: "24" }),
    C.createElement({ product: "Produto B", description: "Setup", type: "A", videoTime: "54" }),
    C.createElement({ product: "produto b", description: "Furar", type: "C", videoTime: "1:14" }),
    C.createElement({ product: "Produto B", description: "Furar", type: "C", videoTime: "1:34" }),
  ];
  return s;
}

test("produtos: resumo, ciclo e tempo padrão separados por produto", () => {
  const s = twoProducts();
  const r = C.computeStudy(s);
  assert.equal(r.multiProduct, true);
  assert.deepEqual(r.products.map((p) => p.name), ["Produto A", "Produto B"], "maiúsculas não criam produto novo");
  const [a, b] = r.products;
  close(sec(a.summary.cycleNormal), 12, "A: Furar = 12 s");
  close(sec(b.summary.cycleNormal), 30 + 20, "B: Setup 30 s (total) + Furar 20 s");
  assert.equal(r.product.key, a.key, "sem escolha, mostra o 1º produto");
  s.settings.product = b.key;
  assert.equal(C.computeStudy(s).kpis.sumNormal, b.kpis.sumNormal);
  // Sem produto em nenhuma linha: estudo de produto único (como antes)
  s.elements.forEach((e) => (e.product = ""));
  const one = C.computeStudy(s);
  assert.equal(one.multiProduct, false);
  assert.equal(one.products.length, 1);
});

test("produtos: peças por filmagem informadas por produto quando a filmagem tem os dois", () => {
  const s = twoProducts();
  const r = C.computeStudy(s);
  const segs = r.filmList[0].segments;
  assert.equal(segs.length, 2);
  assert.notEqual(segs[0].key, segs[1].key);
  close(sec(segs[1].observed), 70, "B observado = 94 − 24 s");
  s.filmPieces = { [segs[0].key]: "2", [segs[1].key]: "2" };
  const b = C.computeStudy(s).products[1];
  assert.equal(b.summary.acyclic, "por-unidade");
  close(sec(b.summary.cycleNormal), 30 / 2 + 20, "setup rateado só pelas peças de B");
});

test("produtos e início: gravados, normalizados e resumidos no JSON", () => {
  const s = twoProducts();
  s.elements[2].newVideo = true;
  s.filmStarts = { [s.elements[2].id]: "00:10" };
  s.settings.multiProduct = true;
  const json = JSON.parse(C.serializeStudy(s));
  assert.equal(json.results.products.length, 2);
  assert.equal(json.results.films[1].startMin, 0.1667, "arredondado a 4 casas");
  const back = C.normalizeStudy(json).study;
  assert.equal(back.elements[0].product, "Produto A");
  assert.deepEqual(back.filmStarts, { [s.elements[2].id]: "00:10" });
  assert.equal(back.settings.multiProduct, true);
  // Arquivo da REV 1.2 (v2) abre sem produtos nem início por filmagem
  const old = C.normalizeStudy({ schema: C.SCHEMA_ID, schemaVersion: 2, id: "x", elements: [{ description: "y" }] }).study;
  assert.deepEqual(old.filmStarts, {});
  assert.equal(old.elements[0].product, "");
});
