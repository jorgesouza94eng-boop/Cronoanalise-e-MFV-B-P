/**
 * REV 1.14 (Fase 2): MFV com produto estratificado — TC ponderado pela demanda do produto,
 * operador compartilhado entre etapas e etapa não medida. Testes M1 a M9 (dados fictícios).
 * Base: 520 min/dia = 31.200 s; família 800/dia (Pão 600, Enroladinho 200); takt 39,0 s.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/mfv-calc.js");

const near = (a, b, tol, msg) => assert.ok(a != null && Math.abs(a - b) <= tol, `${msg || ""} esperado ${b}, obtido ${a}`);
const sec = (m) => (m == null ? null : m * 60);

function base() {
  const d = M.createMfv({ clientName: "Empresa Teste", family: "Pães" });
  d.timeUnit = "s";
  d.schedule = M.DAYS.map((day, i) => ({ day, start: i < 5 ? "07:00" : "", end: i < 5 ? "15:40" : "", breaks: "", meal: "" }));
  d.demandMonthly = String(800 * 22);
  d.workDaysMonth = "22";
  return d;
}

/** Etapa ligada a um estudo de 1 produto (TP em segundos, demanda própria do produto). */
const studyStep = (name, tpS, demand, extra) =>
  M.createStep(Object.assign({ name, source: "study", studyId: `st-${name}`, studyProduct: "", tcStudyMin: tpS / 60, studyDemand: demand }, extra || {}));

function m1() {
  const d = base();
  const w = { weighted: true, operatorTag: "Op1" };
  d.steps = [
    studyStep("Enroladinho • Preparo", 6.72, 200, Object.assign({ kaizen: true }, w)),
    studyStep("Enroladinho • Laminação e corte", 4.67, 200, w),
    studyStep("Enroladinho • Queijo", 3.07, 200, w),
    studyStep("Enroladinho • Enrolar", 11.85, 200, w),
    studyStep("Pão • Moldagem", 4.76, 600, w),
  ];
  return d;
}

test("M1: TC ponderado = TP × demanda do produto ÷ demanda da família", () => {
  const r = M.computeMfv(m1());
  near(sec(r.takt), 39, 1e-9, "takt");
  const tcs = r.steps.map((s) => Number(sec(s.tc).toFixed(2)));
  assert.deepEqual(tcs, [1.68, 1.17, 0.77, 2.96, 3.57]);
  assert.equal(r.steps[4].weight.factor, 0.75);
  assert.equal(r.steps[0].weight.demand, 200);
  assert.equal(r.steps[0].weight.family, 800);
});

test("M2: carga do Op1 10,15 s, 26,0% do takt, capacidade 3.075/dia, 1 operador atual", () => {
  const r = M.computeMfv(m1());
  assert.equal(r.sharedOperators.length, 1);
  const o = r.sharedOperators[0];
  near(sec(o.load), 10.15, 0.005, "carga");
  near(o.taktPct, 26.0, 0.05, "% do takt");
  assert.equal(Math.round(o.capacityDay), 3075);
  assert.deepEqual(o.seqs, [1, 2, 3, 4, 5]);
  near(r.opsTotal, 1, 1e-9, "operadores atuais (distintos)");
});

test("M3: gargalo = carga do Op1 (10,15 s), não a maior etapa (3,57 s)", () => {
  const d = m1();
  const r = M.computeMfv(d);
  assert.equal(r.bottleneck.kind, "operador");
  assert.equal(r.bottleneck.operator, "Op1");
  near(sec(r.bottleneck.tc), 10.15, 0.005);
  assert.equal(Math.round(r.line.capacityDay), 3075);
  const checks = M.linkChecks(d, r, () => null).map((c) => c.text);
  assert.ok(checks.some((t) => t.startsWith("Operador Op1: etapas 1, 2, 3, 4 e 5 • carga 10,15 s • 26,0% do takt • capacidade 3.075/dia")), checks.join(" | "));
  assert.ok(checks.some((t) => t.includes("Gargalo = carga do operador Op1 (10,15 s), não a maior etapa (5. Pão • Moldagem, 3,57 s)")), checks.join(" | "));
});

test("M4: Kaizen em Preparo usa a capacidade do Op1 (3.075/dia)", () => {
  const r = M.computeMfv(m1());
  assert.equal(r.kaizen.operator, "Op1");
  assert.equal(Math.round(r.kaizen.capacityDay), 3075);
  near(sec(r.kaizen.tc), 1.68, 1e-9, "TC da etapa Kaizen continua o da etapa");
});

test("M6: etapa não medida fica fora dos cálculos e gera o aviso de fluxo incompleto", () => {
  const d = m1();
  const before = M.computeMfv(d);
  d.steps.push(M.createStep({ name: "Forno", unmeasured: true, kaizen: true }));
  const r = M.computeMfv(d);
  const forno = r.steps[5];
  assert.equal(forno.unmeasured, true);
  assert.equal(forno.tc, null);
  assert.equal(forno.errors.length, 0, "não é erro");
  assert.equal(forno.kaizen, false, "não pode ser Kaizen");
  near(r.tcTotal, before.tcTotal, 1e-12, "ΣTC");
  near(r.opsTotal, before.opsTotal, 1e-12, "operadores");
  near(r.line.capacityDay, before.line.capacityDay, 1e-9, "capacidade");
  assert.deepEqual(r.unmeasured, [{ seq: 6, name: "Forno" }]);
  const t = M.linkChecks(d, r, () => null).find((c) => c.kind === "fluxo");
  assert.equal(t.text, "Fluxo incompleto: 1 etapa(s) sem TC (6. Forno). Gargalo e capacidade valem só para as etapas medidas.");
});

test("M7: produto sem demanda própria com ponderação ligada → \"--\" e aviso", () => {
  const d = m1();
  d.steps[1].studyDemand = null;
  const r = M.computeMfv(d);
  assert.equal(r.steps[1].tc, null);
  assert.match(r.steps[1].errors[0], /Informe a demanda do produto/);
  // a carga do Op1 fica sem a etapa (não estima)
  near(sec(r.sharedOperators[0].load), 10.15 - 1.1675, 0.005);
  assert.match(r.sharedOperators[0].issues.join(), /1 etapa\(s\) sem TC fora da carga/);
});

test("Ponderação desligada por padrão; Mix e TC digitado não são ponderados; lead time usa o TP original", () => {
  const d = base();
  d.steps = [
    studyStep("Preparo", 6.72, 200),
    M.createStep({ name: "Forno • Mix", source: "study", studyId: "x", studyProduct: M.MIX_KEY, tcStudyMin: 0.2, studyDemand: 200, weighted: true }),
    M.createStep({ name: "Manual", tcManualMin: 0.1, weighted: true }),
  ];
  assert.equal(M.createStep().weighted, false);
  const r = M.computeMfv(d);
  near(sec(r.steps[0].tc), 6.72, 1e-9);
  near(sec(r.steps[1].tc), 12, 1e-9);
  near(sec(r.steps[2].tc), 6, 1e-9);
  const p = M.computeMfv(m1());
  near(sec(p.processTotal), 6.72 + 4.67 + 3.07 + 11.85 + 4.76, 1e-9, "tempo de processamento = Σ TP original (31,07 s)");
  near(sec(p.tcTotal), 10.1475, 1e-9, "ΣTC do GBO ponderado");
});

test("Etapa ponderada não acusa demanda diferente da família; não ponderada continua acusando", () => {
  const d = m1();
  const r = M.computeMfv(d);
  const info = (s) => ({ warnings: [], demand: s.studyDemand });
  assert.ok(!M.linkChecks(d, r, info).some((c) => c.kind === "demanda"));
  d.steps[0].weighted = false;
  assert.ok(M.linkChecks(d, M.computeMfv(d), info).some((c) => c.kind === "demanda"));
});

test("Operador compartilhado com etapas comuns: atuais = distintos + Nº ops das etapas sem operador", () => {
  const d = m1();
  d.steps.push(M.createStep({ name: "Embalagem", tcManualMin: 20 / 60, operators: "2" }));
  const r = M.computeMfv(d);
  near(r.opsTotal, 3, 1e-9);
  assert.equal(r.bottleneck.kind, "etapa", "20 s > carga 10,15 s");
  assert.equal(r.bottleneck.seq, 6);
});

test("M8: MFV da REV 1.12 (sem os campos novos) → resultados idênticos", () => {
  const d = base();
  d.steps = [M.createStep({ name: "Corte", tcManualMin: 0.5, operators: "2", kaizen: true }), M.createStep({ name: "Solda", tcManualMin: 0.8 })];
  const raw = JSON.parse(M.serializeMfv(d));
  raw.schemaVersion = 5;
  raw.steps.forEach((s) => ["weighted", "studyDemand", "operatorTag", "unmeasured"].forEach((k) => delete s[k]));
  const n = M.normalizeMfv(raw);
  assert.ok(n.ok);
  const a = M.computeMfv(d);
  const b = M.computeMfv(n.doc);
  assert.deepEqual(
    [b.tcTotal, b.opsTotal, b.line.capacityDay, b.bottleneck.name, b.kaizen.capacityDay, b.status, b.sharedOperators.length, b.unmeasured.length],
    [a.tcTotal, a.opsTotal, a.line.capacityDay, a.bottleneck.name, a.kaizen.capacityDay, a.status, 0, 0]
  );
  assert.equal(b.bottleneck.kind, "etapa");
});

test("M9: JSON preserva operador, ponderação, demanda do produto e etapas não medidas", () => {
  const d = m1();
  d.steps.push(M.createStep({ name: "Forno", unmeasured: true }));
  const n = M.normalizeMfv(JSON.parse(M.serializeMfv(d)));
  assert.ok(n.ok);
  assert.deepEqual(
    n.doc.steps.map((s) => [s.operatorTag, s.weighted, s.studyDemand, s.unmeasured]),
    d.steps.map((s) => [s.operatorTag, s.weighted, s.studyDemand, s.unmeasured])
  );
  const res = JSON.parse(M.serializeMfv(d)).results;
  assert.equal(res.sharedOperators[0].operator, "Op1");
  assert.deepEqual(res.unmeasuredSteps, [{ seq: 6, name: "Forno" }]);
  assert.equal(res.bottleneck.kind, "operador");
});
