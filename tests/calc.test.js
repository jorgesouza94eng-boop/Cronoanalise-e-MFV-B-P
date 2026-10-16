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

function study(elements, overrides) {
  const s = C.createStudy({ clientName: "Cliente Teste", processName: "Posto 01", id: "abcd1234-0000-4000-8000-000000000000" });
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
      { videoTime: "03:00", pace: "100", frequency: "1/50" }, // 2,0 × 1,00 × 0,02 = 0,04 (troca de caixa)
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
  assert.equal(out.results.sumNormalTimeMin, 1);
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
