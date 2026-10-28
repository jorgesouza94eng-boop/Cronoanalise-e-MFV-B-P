/**
 * REV 1.18: a classificação (tipo, valor, desperdício) escolhida numa linha é copiada para as
 * outras linhas do mesmo elemento — no mesmo produto e na mesma etapa. Dados fictícios.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");

const el = (description, extra) => C.createElement(Object.assign({ description }, extra || {}));

test("valor: linhas sem classificação são preenchidas; já classificadas com outro valor vão para conferência", () => {
  const els = [
    el("Passando a Massa no Laminador", { value: "IN" }),
    el("Cortando a Massa"),
    el("passando a massa no laminador"), // mesmo nome (maiúsculas não contam)
    el("Passando a Massa no Laminador", { value: "AG" }),
    el("Passando a Massa no Laminador", { value: "IN" }), // já igual: nada a fazer
  ];
  const plan = C.classificationPlan(els, 0, "value");
  assert.equal(plan.value, "IN");
  assert.deepEqual(plan.fill.map((x) => x.seq), [3]);
  assert.deepEqual(plan.conflict.map((x) => [x.seq, x.value]), [[4, "AG"]]);
});

test("tipo e desperdício também são copiados; valor vazio não é copiado", () => {
  const els = [el("Beber Água", { type: "A", waste: "espera" }), el("Beber Água", { type: "C" }), el("Beber Água", { type: "A" })];
  assert.deepEqual(C.classificationPlan(els, 0, "type").conflict.map((x) => x.seq), [2]);
  assert.deepEqual(C.classificationPlan(els, 0, "waste").fill.map((x) => x.seq), [2, 3]);
  assert.equal(C.classificationPlan([el("X"), el("X", { value: "AG" })], 0, "value"), null, "linha esvaziada não apaga as outras");
});

test("outro produto ou outra etapa não é o mesmo elemento", () => {
  const els = [
    el("Pegar bandeja", { value: "IN", product: "Pão", etapa: "Moldagem" }),
    el("Pegar bandeja", { product: "Pão", etapa: "Moldagem" }),
    el("Pegar bandeja", { product: "Pão", etapa: "Forno" }),
    el("Pegar bandeja", { product: "Rosca", etapa: "Moldagem" }),
  ];
  assert.deepEqual(C.classificationPlan(els, 0, "value").fill.map((x) => x.seq), [2]);
});

test("sem nome ou sem outras linhas: nada a fazer", () => {
  assert.equal(C.classificationPlan([el("", { value: "AG" }), el("", {})], 0, "value"), null);
  assert.equal(C.classificationPlan([el("Único", { value: "AG" })], 0, "value"), null);
  assert.equal(C.classificationPlan([el("A", { value: "AG" })], 0, "kaizen"), null);
});
