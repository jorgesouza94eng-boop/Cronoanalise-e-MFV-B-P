/**
 * REV 1.15: coluna Etapa na cronoanálise (TP por etapa do processo) e ligação com o MFV.
 * Dados fictícios: tolerância 0%, 1 filmagem com 10 peças.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");

const sec = (m) => (m == null ? null : Number((m * 60).toFixed(6)));

/** [etapa, elemento, tipo, qtd, tempo final, operador] */
function study(lines, extra) {
  const s = C.createStudy({ clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = lines.map(([etapa, description, type, quantity, videoTime, operador]) =>
    C.createElement({ etapa, description, type, quantity: String(quantity), videoTime, operador: operador || 1 })
  );
  s.filmPieces = { inicio: "10" };
  return Object.assign(s, extra || {});
}

const PADARIA = [
  ["Laminação", "Abrir a massa", "C", 10, "40"], // 40 s ÷ 10 = 4,0
  ["Laminação", "Pegar bandeja", "A", 1, "50"], // 10 s ÷ 10 peças = 1,0
  ["Queijo", "Colocar queijo", "C", 10, "120"], // 01:20 − 00:50 = 30 s ÷ 10 = 3,0
  ["Enrolar", "Enrolar", "C", 10, "320"], // 03:20 − 01:20 = 120 s ÷ 10 = 12,0
  ["Enrolar", "Pegar bandeja", "A", 1, "330"], // 10 s ÷ 10 = 1,0 (mesmo nome, outra etapa)
];

test("E1: TP por etapa, na ordem da grade; produto = Σ etapas; mesmo nome em etapas diferentes não se mistura", () => {
  const r = C.computeStudy(study(PADARIA));
  assert.equal(r.withEtapas, true);
  const et = r.product.etapas;
  assert.deepEqual(et.map((e) => [e.order, e.name, sec(e.tp)]), [[1, "Laminação", 5], [2, "Queijo", 3], [3, "Enrolar", 13]]);
  assert.equal(sec(r.kpis.standardTime), 21, "produto = 5 + 3 + 13");
  const pegar = r.summary.elements.filter((g) => g.name === "Pegar bandeja");
  assert.deepEqual(pegar.map((g) => g.etapa), ["Laminação", "Enrolar"], "dois elementos 'Pegar bandeja', um por etapa");
});

test("E2: sem etapa nas linhas → resultados idênticos aos da REV 1.14", () => {
  const lines = PADARIA.map((l) => ["", ...l.slice(1)]);
  const r = C.computeStudy(study(lines));
  assert.equal(r.withEtapas, false);
  assert.equal(r.product.etapas, null);
  assert.equal(r.rows[0].etapaKey, "");
  assert.equal(r.summary.elements.filter((g) => g.name === "Pegar bandeja").length, 1, "agrupa pelo nome, como antes");
  assert.equal(sec(r.kpis.standardTime), 4 + 2 + 3 + 12, "Pegar bandeja: 20 s ÷ 10 peças = 2,0");
});

test("E3: linhas sem etapa num estudo com etapas ficam em '(sem etapa)'", () => {
  const lines = PADARIA.slice();
  lines.push(["", "Limpar a bancada", "A", 1, "350"]);
  const et = C.computeStudy(study(lines)).product.etapas;
  assert.equal(et[3].name, "(sem etapa)");
  assert.equal(sec(et[3].tp), 2);
});

test("E4: vários operadores — etapa de um só operador é dele; etapa de 2 operadores vira posto", () => {
  const s = study([
    ["Laminação", "Abrir a massa", "C", 10, "40", 1], // Op1 4,0
    ["Queijo", "Colocar queijo", "C", 10, "30", 2], // Op2 3,0
    ["Enrolar", "Enrolar", "C", 10, "240", 1], // Op1 02:40 − 00:40 = 120 s → 12,0
    ["Enrolar", "Enrolar", "C", 10, "210", 2], // Op2 02:10 − 00:30 = 100 s → 10,0
  ]);
  s.settings.numOperadores = 2;
  const et = C.computeStudy(s).product.etapas;
  assert.deepEqual(et.map((e) => [e.name, e.n, e.operator]), [["Laminação", 1, 1], ["Queijo", 1, 2], ["Enrolar", 2, 0]]);
  assert.equal(sec(et[2].tp), 12, "ciclo da etapa = maior TP (Op1)");
  assert.equal(sec(et[2].content), 22, "conteúdo = Σ dos operadores");
  assert.deepEqual(et[2].operators.map((o) => sec(o.tp)), [12, 10]);
});

test("E5: preencher para baixo também na coluna Etapa", () => {
  const els = [C.createElement({ etapa: "Moldagem" }), C.createElement(), C.createElement(), C.createElement({ etapa: "Forno" })];
  const plan = C.productFillPlan(els, 0, "", "etapa");
  assert.equal(plan.mode, "preencher");
  assert.deepEqual(plan.ids, [els[1].id, els[2].id]);
});

test("E6: JSON preserva a etapa e grava os resultados por etapa; CSV com a coluna e o bloco ETAPAS", () => {
  const s = study(PADARIA);
  s.settings.multiEtapa = true;
  const n = C.normalizeStudy(JSON.parse(C.serializeStudy(s)));
  assert.ok(n.ok);
  assert.deepEqual(n.study.elements.map((e) => e.etapa), PADARIA.map((l) => l[0]));
  assert.equal(n.study.settings.multiEtapa, true);
  const res = JSON.parse(C.serializeStudy(s)).results;
  assert.deepEqual(res.etapas[0].etapas.map((e) => e.etapa), ["Laminação", "Queijo", "Enrolar"]);
  const csv = C.buildCSV(s);
  assert.match(csv, /;Etapa;Elemento;/);
  assert.match(csv, /ETAPAS DO PROCESSO/);
  assert.match(csv, /\r\n3;"Enrolar";13,0;13,0;/);
});

test("E7: MFV — etapas do mesmo estudo não são contagem dupla; a mesma etapa duas vezes, ou o produto inteiro junto, é", () => {
  const step = (o) => M.createStep(Object.assign({ name: "x", source: "study", studyId: "st1", tcStudyMin: 0.1 }, o));
  const dup = (steps) => M.linkChecks({ steps, timeUnit: "s" }, { demandDaily: null }, () => null).filter((c) => c.kind === "duplo").length;
  assert.equal(dup([step({ studyEtapa: "laminacao" }), step({ studyEtapa: "queijo" })]), 0);
  assert.equal(dup([step({ studyEtapa: "laminacao" }), step({ studyEtapa: "laminacao" })]), 1);
  assert.equal(dup([step({}), step({ studyEtapa: "queijo" })]), 1);
  // Produtos diferentes do mesmo estudo: dupla, salvo se ponderados e com operador/etapa
  assert.equal(dup([step({ studyProduct: "pao" }), step({ studyProduct: "rosca" })]), 1);
  assert.equal(dup([step({ studyProduct: "pao", weighted: true, operatorTag: "Op1" }), step({ studyProduct: "rosca", weighted: true, operatorTag: "Op1" })]), 0);
  assert.equal(dup([step({ studyProduct: "pao", studyEtapa: "a", weighted: true }), step({ studyProduct: "rosca", studyEtapa: "a", weighted: true })]), 0);
  assert.equal(dup([step({ studyProduct: M.MIX_KEY }), step({ studyProduct: "pao", studyEtapa: "a" })]), 1, "Mix + etapa");
});

test("E8: MFV normaliza e grava a etapa vinculada", () => {
  const d = M.createMfv({ clientName: "A", family: "B" });
  d.steps = [M.createStep({ name: "Enrolar", source: "study", studyId: "st1", studyEtapa: "enrolar", tcStudyMin: 0.2 })];
  const n = M.normalizeMfv(JSON.parse(M.serializeMfv(d)));
  assert.equal(n.doc.steps[0].studyEtapa, "enrolar");
});
