/**
 * REV 1.27: IA só com o produto selecionado (Kaizen e Etapas), estouros de Kaizen no fluxograma
 * do MFV e as oportunidades do MFV no Plano 5W2H. Dados fictícios.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const A = require("../js/ai.js");
const M = require("../js/mfv-calc.js");
const P = require("../js/plano-calc.js");

function study() {
  const s = C.createStudy({ clientName: "Padaria Teste", processName: "Bancada" });
  s.settings.multiProduct = true;
  s.elements = [
    ["Pão", "Buscar bandeja", "10", "NA"],
    ["Pão", "Anotar OP", "20", "IN"],
    ["Rosca", "Buscar bandeja", "30", "NA"],
    ["Rosca", "Modelar", "40", ""],
  ].map(([product, description, videoTime, value]) => C.createElement({ product, description, videoTime, value }));
  return s;
}

test("R1: Kaizen e Etapas só do produto escolhido (productKey); sem productKey, todos", () => {
  const s = study();
  const r = C.computeStudy(s);
  const k = A.buildKaizenPrompt(s, r, true, { productKey: "rosca" });
  assert.deepEqual(k.targets.map((t) => [t.product, t.name]), [["Rosca", "Buscar bandeja"]]);
  assert.ok(!k.text.includes('"produto":"Pão"'));
  assert.equal(A.buildKaizenPrompt(s, r, true).count, 3, "todos os produtos");
  const e = A.buildEtapasPrompt(s, r, true, { productKey: "pão" });
  assert.deepEqual(e.targets.map((t) => t.name), ["Buscar bandeja", "Anotar OP"]);
  assert.ok(!e.text.includes("Modelar"));
});

function mfv() {
  const d = M.createMfv({ clientName: "Padaria Teste", family: "Pães" });
  d.demandMonthly = "4400";
  d.workDaysMonth = "22";
  d.steps = [
    M.createStep({ name: "Preparação", tcManualMin: 0.5, operators: "1", kaizenNote: "Reorganizar: gelo pronto antes da janela" }),
    M.createStep({ name: "Laminação", tcManualMin: 0.4, operators: "1" }),
    M.createStep({ name: "Modelagem", tcManualMin: 0.6, operators: "1", kaizenNote: "  Combinar: bandeja na saída  " }),
  ];
  return d;
}

test("R2: estouros de Kaizen numerados na ordem do fluxo; campo salvo no JSON", () => {
  const d = mfv();
  const f = M.flowchartModel(M.computeMfv(d));
  assert.deepEqual(f.bursts.map((b) => [b.n, b.seq, b.name, b.note]), [
    [1, 1, "Preparação", "Reorganizar: gelo pronto antes da janela"],
    [2, 3, "Modelagem", "Combinar: bandeja na saída"],
  ]);
  assert.deepEqual(f.nodes.filter((n) => n.kind === "step").map((n) => n.burst), [1, 0, 2]);
  const back = M.normalizeMfv(JSON.parse(JSON.stringify(d))).doc;
  assert.equal(back.steps[0].kaizenNote, "Reorganizar: gelo pronto antes da janela");
  const old = JSON.parse(JSON.stringify(d));
  old.steps.forEach((x) => delete x.kaizenNote);
  assert.equal(M.normalizeMfv(old).doc.steps[0].kaizenNote, "", "MFV antigo abre sem estouros");
});

test("R3: oportunidades do MFV viram ações do Plano (ECRS, Onde, Por que com TC e % do takt; origem conferida)", () => {
  const d = mfv();
  const cands = P.mfvCandidates(d, M.computeMfv(d));
  assert.equal(cands.length, 2);
  const a = P.actionFromCandidate(cands[1], 4);
  assert.equal(a.what, "Combinar — Modelagem");
  assert.equal(a.how, "bandeja na saída");
  assert.equal(a.ecrs, "combinar");
  assert.equal(a.where, "MFV — Pães");
  assert.match(a.why, /^Oportunidade Kaizen do MFV: TC 0,600 min \(\d+,\d% do takt\)$/);
  assert.equal(a.origin.studyId, `mfv:${d.id}`);
  const map = new Map([[`mfv:${d.id}`, cands]]);
  assert.equal(P.originStatus(a, map), "ok");
  d.steps[2].kaizenNote = "Combinar: outra ideia";
  assert.equal(P.originStatus(a, new Map([[`mfv:${d.id}`, P.mfvCandidates(d, M.computeMfv(d))]])), "alterada");
});
