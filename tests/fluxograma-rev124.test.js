/**
 * REV 1.24: fluxograma do processo (estado presente) no MFV — sequência de etapas e estoques
 * para o desenho (M.flowchartModel). Dados fictícios.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/mfv-calc.js");

function mfv() {
  const d = M.createMfv({ clientName: "Jeans Teste", family: "Calças" });
  d.demandMonthly = "4400";
  d.workDaysMonth = "22";
  d.steps = [
    M.createStep({ name: "Bater uso", tcManualMin: 0.5, operators: "1" }),
    M.createStep({ name: "Grampear frente", tcManualMin: 1.2, operators: "1", kaizen: true }),
    M.createStep({ name: "Desgastar bolsos", tcManualMin: 0.8, operators: "2" }),
    M.createStep({ name: "Lavar e secar", unmeasured: true }),
  ];
  return d;
}

test("F1: MFV novo — Matéria-prima no início e Produto acabado no fim; gargalo e Kaizen marcados", () => {
  const d = mfv();
  const f = M.flowchartModel(M.computeMfv(d));
  assert.deepEqual(
    f.nodes.map((n) => (n.kind === "step" ? n.step.name : `△ ${n.inv.name}`)),
    ["△ Matéria-prima", "Bater uso", "Grampear frente", "Desgastar bolsos", "Lavar e secar", "△ Produto acabado"]
  );
  const bn = f.nodes.filter((n) => n.bottleneck).map((n) => n.step.name);
  assert.deepEqual(bn, ["Grampear frente"], "gargalo = maior TC");
  assert.equal(f.nodes.find((n) => n.step && n.step.kaizen).step.name, "Grampear frente");
  assert.equal(f.nodes.find((n) => n.step && n.step.unmeasured).bottleneck, false, "etapa não medida nunca é gargalo");
  assert.equal(f.unplaced.length, 0);
});

test("F2: estoque antes de uma etapa; sem posição e de etapa removida ficam fora do desenho", () => {
  const d = mfv();
  d.inventories.push(M.createInventory({ name: "Entre grampo e desgaste", quantity: "200", beforeStepId: d.steps[2].id }));
  d.inventories.push(M.createInventory({ name: "Sem lugar", quantity: "10" }));
  d.inventories.push(M.createInventory({ name: "Órfão", quantity: "5", beforeStepId: "id-que-nao-existe" }));
  const r = M.computeMfv(d);
  const f = M.flowchartModel(r);
  const seq = f.nodes.map((n) => (n.kind === "step" ? n.step.seq : n.inv.name));
  assert.deepEqual(seq.slice(1, 5), [1, 2, "Entre grampo e desgaste", 3]);
  assert.deepEqual(f.unplaced.map((i) => [i.name, i.orphan]), [["Sem lugar", false], ["Órfão", true]]);
  // 200 ÷ (4400 ÷ 22 = 200/dia) = 1 dia; o lead time soma todos os estoques (também os fora do desenho)
  assert.equal(f.nodes[3].inv.days, 1);
  assert.equal(f.leadTimeDays, r.leadTimeDays);
  assert.ok(Math.abs(f.processTotal - 2.5) < 1e-9, "Σ TC das etapas medidas");
});

test("F3: gargalo pela carga do operador compartilhado marca as etapas dele", () => {
  const d = mfv();
  d.steps[0].operatorTag = "Op1";
  d.steps[2].operatorTag = "Op1";
  const f = M.flowchartModel(M.computeMfv(d));
  assert.equal(f.bottleneckKind, "operador");
  assert.deepEqual(f.nodes.filter((n) => n.bottleneck).map((n) => n.step.name), ["Bater uso", "Desgastar bolsos"]);
});

test("F4: JSON de versões anteriores (sem posição) abre com estoques fora do desenho e dados ligados", () => {
  const d = mfv();
  const raw = JSON.parse(JSON.stringify(d));
  raw.inventories.forEach((i) => delete i.beforeStepId);
  delete raw.flowShowData;
  const back = M.normalizeMfv(raw).doc;
  assert.equal(back.flowShowData, true);
  assert.deepEqual(back.inventories.map((i) => i.beforeStepId), ["", ""]);
  assert.equal(M.flowchartModel(M.computeMfv(back)).unplaced.length, 2);
});
