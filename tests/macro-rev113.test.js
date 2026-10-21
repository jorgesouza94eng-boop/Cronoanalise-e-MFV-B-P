/**
 * Testes da REV 1.13: macro-etapas na cronoanálise, ocupação dos recursos no MFV e
 * macro-etapas no Yamazumi. Dados sintéticos com os valores de conferência do consultor:
 * tempo líquido 520 min (31.200 s), família 800/dia (Pão 600, Enroladinho 200), tolerância 5%.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");
const Y = require("../js/yamazumi-calc.js");

const s2 = (min) => min * 60; // minutos → segundos
const near = (actual, expected, dec, msg) =>
  assert.equal(Number(actual.toFixed(dec)), expected, `${msg || ""} esperado ${expected}, obtido ${actual}`);

/** Enroladinho: 4 macros (tempo por peça 6,40 | 4,45 | 2,92 | 11,29 s); Pão: "Moldagem" 4,531 s. */
function padaria(extra) {
  const s = C.createStudy({ id: "pada0000-0000-4000-8000-000000000000", clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 520, plannedStopsMin: 0, dailyDemandPcs: 800, tolerancePct: 5 };
  s.settings.multiProduct = true;
  const E = "Enroladinho";
  const rows = [
    [E, "Preparo da massa", "Preparar massa", "32", "5"],
    [E, "Laminação e corte", "Laminar e cortar", "2:01", "20"],
    [E, "Queijo", "Colocar queijo", "3:14", "25"],
    [E, "Enrolar", "Enrolar", "22:03", "100"],
    ["Pão", "Moldagem", "Moldar pão", "1:37:34", "1000"],
  ];
  s.elements = rows.map(([product, macroEtapa, description, videoTime, quantity]) =>
    C.createElement({ product, macroEtapa, description, videoTime, quantity, value: "AG" })
  );
  s.productDemand = { "pão": "600", enroladinho: "200" };
  return Object.assign(s, extra || {});
}
const prod = (r, name) => r.products.find((p) => p.name === name);

test("T1: macro-etapas do Enroladinho — tempo normal, % e TP; soma = ciclo", () => {
  const e = prod(C.computeStudy(padaria()), "Enroladinho");
  const list = e.macros.list;
  assert.deepEqual(list.map((m) => m.name), ["Preparo da massa", "Laminação e corte", "Queijo", "Enrolar"]);
  [6.4, 4.45, 2.92, 11.29].forEach((v, i) => near(s2(list[i].tn), v, 2, list[i].name));
  [6.72, 4.67, 3.07, 11.85].forEach((v, i) => near(s2(list[i].tp), v, 2, `TP ${list[i].name}`));
  near(s2(e.macros.sumTn), 25.06, 2, "Σ tempo normal");
  near(s2(e.macros.sumTp), 26.31, 2, "Σ TP");
  assert.ok(Math.abs(e.macros.sumTn - e.summary.cycleNormal) < 1e-12, "Σ macros = tempo normal do ciclo");
  assert.ok(Math.abs(e.macros.sumTp - e.kpis.standardTime) < 1e-12, "Σ TP das macros = TP do produto");
  assert.equal(e.macros.balanced, true);
  assert.deepEqual(e.macros.issues, []);
});

test("T2: Pão com uma só macro-etapa 'Moldagem' (4,531 s; TP 4,758 s)", () => {
  const p = prod(C.computeStudy(padaria()), "Pão");
  assert.equal(p.macros.list.length, 1);
  near(s2(p.macros.list[0].tn), 4.531, 3);
  near(s2(p.macros.list[0].tp), 4.758, 3);
  assert.equal(p.macros.list[0].sharePct, 100);
});

test("T5: elemento sem macro entra em 'Sem macro-etapa', com aviso; soma continua igual ao ciclo", () => {
  const s = padaria();
  s.elements[2].macroEtapa = "";
  const e = prod(C.computeStudy(s), "Enroladinho");
  const none = e.macros.list[e.macros.list.length - 1];
  assert.equal(none.name, "Sem macro-etapa");
  assert.equal(none.none, true);
  near(s2(none.tn), 2.92, 2);
  assert.ok(e.macros.issues.some((t) => /1 elemento\(s\) sem macro-etapa/.test(t)));
  assert.ok(Math.abs(e.macros.sumTn - e.summary.cycleNormal) < 1e-12);
});

test("A6: mesmo elemento em macros diferentes do mesmo produto → conflito (cálculo por nome mantido)", () => {
  const s = padaria();
  s.elements.splice(1, 0, C.createElement({ product: "Enroladinho", macroEtapa: "Queijo", description: "Preparar massa", videoTime: "1:04", quantity: "5", value: "AG" }));
  const e = prod(C.computeStudy(s), "Enroladinho");
  const g = e.summary.elements.find((x) => x.name === "Preparar massa");
  assert.ok(g.conflicts.includes("macro-etapa"));
  assert.equal(g.macro, "Preparo da massa", "vale a 1ª ocorrência");
  assert.ok(e.macros.issues.some((t) => /em macro-etapas diferentes \(Preparo da massa, Queijo\)/.test(t)));
  assert.ok(Math.abs(e.macros.sumTn - e.summary.cycleNormal) < 1e-12);
});

test("sem macro-etapa preenchida: nenhum resumo por macro e nenhum cálculo muda", () => {
  const s = padaria();
  const before = C.computeStudy(s);
  s.elements.forEach((e) => (e.macroEtapa = ""));
  const r = C.computeStudy(s);
  assert.equal(r.macroUsed, false);
  assert.equal(prod(r, "Pão").macros, null);
  assert.equal(prod(r, "Enroladinho").kpis.standardTime, prod(before, "Enroladinho").kpis.standardTime);
  assert.equal(r.mix.weightedTP, before.mix.weightedTP);
});

test("T8: JSON da REV 1.12 (sem o campo) abre com os mesmos resultados", () => {
  const s = padaria();
  s.elements.forEach((e) => (e.macroEtapa = ""));
  const v = JSON.parse(C.serializeStudy(s));
  v.elements.forEach((e) => delete e.macroEtapa);
  delete v.settings.macroColumn;
  const n = C.normalizeStudy(v);
  assert.ok(n.ok);
  assert.equal(n.study.elements[0].macroEtapa, "");
  assert.equal(n.study.settings.macroColumn, false);
  const a = C.computeStudy(n.study);
  const b = C.computeStudy(s);
  assert.equal(a.mix.weightedTP, b.mix.weightedTP);
  assert.equal(a.kpis.standardTime, b.kpis.standardTime);
});

test("T9: exportar e reimportar preserva macroEtapa; JSON traz resumoMacro; CSV com coluna e resumo", () => {
  const s = padaria();
  const json = JSON.parse(C.serializeStudy(s));
  const n = C.normalizeStudy(json).study;
  assert.deepEqual(n.elements.map((e) => e.macroEtapa), s.elements.map((e) => e.macroEtapa));
  assert.equal(n.settings.macroColumn, true, "com macro preenchida a coluna aparece");
  const rm = json.results.resumoMacro.find((x) => x.produto === "Enroladinho");
  assert.equal(rm.macros.length, 4);
  assert.equal(rm.somaConfere, true);
  assert.equal(json.results.summary[0].macroEtapa, "Preparo da massa");
  const csv = C.buildCSV(s);
  assert.match(csv, /Vídeo;Produto;Macro-etapa;Elemento/);
  assert.match(csv, /RESUMO POR MACRO-ETAPA/);
  assert.match(csv, /"Enroladinho";"Enrolar";1;11,3/);
});

test("T10/A1/A7: preencher para baixo no mesmo produto e renomear em todas as linhas do produto", () => {
  const s = padaria();
  s.elements.forEach((e) => (e.macroEtapa = ""));
  s.elements[0].macroEtapa = "Massa";
  let plan = C.macroFillPlan(s.elements, 0, "");
  assert.equal(plan.mode, "preencher");
  assert.equal(plan.ids.length, 3, "para no fim do Enroladinho (não passa para o Pão)");
  plan.ids.forEach((id) => (s.elements.find((e) => e.id === id).macroEtapa = "Massa"));
  s.elements[2].macroEtapa = "Preparo";
  plan = C.macroFillPlan(s.elements, 2, "Massa");
  assert.equal(plan.mode, "renomear");
  assert.equal(plan.count, 3, "as outras 3 linhas do Enroladinho com 'Massa'");
  assert.equal(C.macroFillPlan(s.elements, 4, ""), null, "Pão sem macro e sem linhas abaixo");
});

test("Excel simples: coluna Macro-etapa na GERAL e resumo por macro na Análise", () => {
  const X = require("../js/xlsx.js");
  const sheets = X.buildBPSheets(padaria());
  const head = sheets[0].rows.find((r) => r && r[0] && r[0].v === "Nº");
  assert.equal(head[head.length - 1].v, "Macro-etapa");
  assert.equal(sheets[0].autoFilter.split(":")[1].replace(/\d+/g, ""), "R");
  const analise = sheets[3].rows.filter(Boolean).map((r) => (r[0] ? r[0].v : ""));
  assert.ok(analise.includes("Por macro-etapa"));
  assert.ok(analise.includes("Enroladinho • Enrolar"));
});

/* ==========================================================================
   MFV: OCUPAÇÃO DOS RECURSOS (B2 + agrupamento por recurso) E COLUNA OCUPAÇÃO
   ========================================================================== */

test("T3/T4/B6: ocupação por macro-etapa — TC ponderado, % do takt e soma = mix", () => {
  const r = C.computeStudy(padaria());
  const occ = M.resourceOccupancy(r, { availDayMin: 520, demandDaily: 800 });
  assert.deepEqual(occ.rows.map((x) => x.name), ["Preparo da massa", "Laminação e corte", "Queijo", "Enrolar", "Moldagem"]);
  [1.68, 1.17, 0.77, 2.96, 3.57].forEach((v, i) => near(s2(occ.rows[i].tcWeighted), v, 2, `TC ponderado ${occ.rows[i].name}`));
  [4.3, 3.0, 2.0, 7.6, 9.1].forEach((v, i) => near(occ.rows[i].occupancyPct, v, 1, `% ${occ.rows[i].name}`));
  near(s2(occ.tcWeightedTotal), 10.15, 2, "Σ TC ponderado");
  assert.ok(Math.abs(occ.tcWeightedTotal - r.mix.weightedTP) < 1e-12, "Σ = TC ponderado do mix");
  assert.equal(occ.matchesMix, true);
  near(occ.occupancyTotal, 26.0, 1, "ocupação total do operador (10,15 ÷ 39)");
  assert.deepEqual(occ.issues, []);
});

test("agrupamento por recurso: a mesma macro em dois produtos soma a carga", () => {
  const s = padaria();
  s.elements[4].macroEtapa = "Preparo da massa"; // o Pão também passa pela masseira
  const occ = M.resourceOccupancy(C.computeStudy(s), { availDayMin: 520, demandDaily: 800 });
  const massa = occ.rows.find((x) => x.name === "Preparo da massa");
  near(s2(massa.tcWeighted), 1.68 + 3.57, 2);
  assert.equal(massa.parts.length, 2);
  assert.equal(occ.rows.length, 4);
});

test("T6: produto sem demanda própria → '--' e aviso, sem herdar a demanda geral", () => {
  const s = padaria();
  delete s.productDemand.enroladinho;
  const occ = M.resourceOccupancy(C.computeStudy(s), { availDayMin: 520, demandDaily: 800 });
  const enrolar = occ.rows.find((x) => x.name === "Enrolar");
  assert.equal(enrolar.load, null);
  assert.equal(enrolar.occupancyPct, null);
  assert.ok(occ.issues.some((t) => /Enroladinho sem demanda própria: informe a demanda do produto/.test(t)));
  assert.equal(occ.tcWeightedTotal, null, "total em '--' enquanto faltar demanda");
});

test("ocupação: produto fora do mix fica de fora, com nota; estudo de um produto usa a demanda da família", () => {
  const s = padaria({ produtoNoMix: { "pão": false } });
  let occ = M.resourceOccupancy(C.computeStudy(s), { availDayMin: 520, demandDaily: 800 });
  assert.ok(!occ.rows.some((x) => x.name === "Moldagem"));
  assert.ok(occ.issues.some((t) => /Pão fora do mix/.test(t)));
  const one = padaria();
  one.elements = one.elements.slice(0, 4).map((e) => Object.assign(e, { product: "" }));
  occ = M.resourceOccupancy(C.computeStudy(one), { availDayMin: 520, demandDaily: 800 });
  near(occ.rows[3].occupancyPct, 30.4, 1, "sem vários produtos: demanda da família (11,85 × 800 ÷ 31.200)");
});

test("coluna Ocupação no GBO: etapa de produto usa a demanda própria; o TC não muda", () => {
  const d = M.createMfv({ clientName: "Empresa Teste", family: "Pães" });
  d.schedule.forEach((day) => Object.assign(day, { start: "07:00", end: "15:40", breaks: "", meal: "" }));
  d.demandMonthly = String(800 * 22);
  d.workDaysMonth = "22";
  const tp = 26.31375 / 60;
  d.steps = [M.createStep({ name: "Enroladinho", source: "study", studyId: "x", studyProduct: "enroladinho", tcStudyMin: tp })];
  const r = M.computeMfv(d);
  near(r.steps[0].taktPct, 67.5, 1, "% do takt da família (inflado)");
  const occ = M.stepOccupancy(r, r.steps[0], 200);
  near(occ, 16.9, 1, "TP × 200 ÷ 31.200");
  assert.equal(M.stepOccupancy(r, r.steps[0], null), null, "sem demanda própria: '--'");
  assert.equal(r.steps[0].tc, tp, "TC continua o TP do estudo");
});

/* ==========================================================================
   YAMAZUMI: MODO POR MACRO-ETAPA
   ========================================================================== */

test("Yamazumi: segmentos por macro-etapa somam o TP (com tolerância à parte)", () => {
  const studies = new Map([["pada0000-0000-4000-8000-000000000000", padaria()]]);
  const g = Y.createGroup({ kind: "posto", members: [{ studyId: "pada0000-0000-4000-8000-000000000000", product: "enroladinho" }] });
  const m = Y.computeGroup(g, studies).members[0];
  const seg = Y.segments(m, "macro");
  assert.deepEqual(seg.map((x) => x.label), ["Preparo da massa", "Laminação e corte", "Queijo", "Enrolar", "Tolerância"]);
  near(s2(seg.reduce((a, x) => a + x.value, 0)), 26.31, 2);
});
