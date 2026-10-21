/**
 * Testes da conferência dos vínculos do MFV (REV 1.11): só avisos, nenhum cálculo muda.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");

/** Estudo sintético com dois produtos (quantidade, segundos). */
function twoProducts(demands) {
  const s = C.createStudy({ id: "s2", clientName: "Empresa Teste", processName: "Forno" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 100, tolerancePct: 0 };
  s.elements = [
    C.createElement({ product: "A", description: "Moldar", videoTime: "10", value: "AG" }),
    C.createElement({ product: "B", description: "Rechear", videoTime: "40", value: "AG" }),
  ];
  s.productDemand = demands || {};
  return s;
}

test("studyQuality: mix parcial e produto fora do mix (REV 1.12)", () => {
  const s = twoProducts({ a: "900", b: "100" });
  let r = C.computeStudy(s);
  let q = M.studyQuality(r, M.MIX_KEY);
  assert.deepEqual(q.warnings, []);
  assert.equal(q.demand, 1000);
  s.produtoNoMix = { b: false };
  r = C.computeStudy(s);
  q = M.studyQuality(r, M.MIX_KEY);
  assert.ok(q.warnings.some((w) => /mix parcial: B fora da carga/.test(w)));
  assert.equal(q.demand, 900, "só A no mix");
  assert.ok(M.studyQuality(r, "b").warnings.includes("produto fora do mix na Cronoanálise"));
  assert.deepEqual(M.studyQuality(r, "a").warnings, [], "produto incluído: sem aviso");
  // Sem demanda própria: o mix fica sem TC (não herda a demanda geral)
  assert.equal(C.computeStudy(twoProducts()).mix.weightedTP, null);
});

test("studyQuality: acíclico sem peças, elemento sem classe e linha com erro", () => {
  const s = C.createStudy({ id: "s1", clientName: "Empresa Teste", processName: "Bancada" });
  s.elements = [
    C.createElement({ description: "Enrolar", videoTime: "10", value: "AG" }),
    C.createElement({ description: "Trocar assadeira", type: "A", videoTime: "40" }),
    C.createElement({ description: "Erro", videoTime: "30" }),
  ];
  const q = M.studyQuality(C.computeStudy(s), "");
  assert.ok(q.warnings.some((w) => /tipo A/.test(w)));
  assert.ok(q.warnings.some((w) => /1 elemento\(s\) sem classificação/.test(w)));
  assert.ok(q.warnings.some((w) => /1 linha\(s\) com erro/.test(w)));
  s.filmPieces = { inicio: "4" };
  assert.ok(!M.studyQuality(C.computeStudy(s), "").warnings.some((w) => /tipo A/.test(w)), "com as peças, o tipo A vira tempo por peça");
});

test("linkChecks: contagem dupla (Mix + produto, posto repetido, estudo no grupo)", () => {
  const info = { warnings: [], demand: null };
  const lookup = (s) => (s.groupId ? { warnings: [], demand: null, studyIds: ["s1"] } : info);
  const doc = {
    steps: [
      M.createStep({ name: "Forno • Mix", source: "study", studyId: "s2", studyProduct: M.MIX_KEY }),
      M.createStep({ name: "Forno • A", source: "study", studyId: "s2", studyProduct: "a" }),
    ],
  };
  let out = M.linkChecks(doc, { demandDaily: null }, lookup);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Mix e produto/);
  doc.steps[0].studyProduct = "b";
  assert.match(M.linkChecks(doc, { demandDaily: null }, lookup)[0].text, /mesmo posto em mais de uma etapa/);
  const doc2 = { steps: [M.createStep({ name: "Célula", source: "group", groupId: "g" }), M.createStep({ name: "Op.1", source: "study", studyId: "s1" })] };
  assert.match(M.linkChecks(doc2, { demandDaily: null }, lookup)[0].text, /no grupo e em outra etapa/);
  const ok = { steps: [M.createStep({ studyId: "s1" }), M.createStep({ studyId: "s3" })] };
  assert.deepEqual(M.linkChecks(ok, { demandDaily: null }, lookup), []);
});

test("linkChecks: demanda do estudo diferente da demanda diária do MFV", () => {
  const doc = { steps: [M.createStep({ name: "Corte", studyId: "s1" }), M.createStep({ name: "Solda", studyId: "s3" })] };
  const lookup = (s) => ({ warnings: s.studyId === "s1" ? ["1 linha(s) com erro, fora do cálculo"] : [], demand: s.studyId === "s1" ? 240 : 640 });
  const out = M.linkChecks(doc, { demandDaily: 640 }, lookup);
  assert.equal(out.length, 2);
  assert.match(out[0].text, /^1\. Corte: 1 linha/);
  assert.match(out[1].text, /1\. Corte \(240,0\/dia\)/);
  assert.ok(!/Solda/.test(out[1].text), "Solda tem a mesma demanda do MFV");
  assert.equal(M.linkChecks(doc, { demandDaily: 642 }, () => ({ warnings: [], demand: 640 })).length, 0, "diferença até 1% não avisa");
});
