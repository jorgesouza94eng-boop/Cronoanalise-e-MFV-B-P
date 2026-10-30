/**
 * REV 1.25: definir etapas do processo — elementos uma vez cada (C.etapaElements), linhas que
 * mudam (C.etapaAssignPlan), prévia do TP por etapa (C.etapaPreview) e o pedido/leitura das
 * etapas sugeridas pela IA (A.buildEtapasPrompt / A.parseEtapas). Dados fictícios.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const A = require("../js/ai.js");

const sec = (m) => Number((m * 60).toFixed(6));

/** Padaria fictícia: 1 filmagem, 10 peças, tolerância 0. */
function study() {
  const s = C.createStudy({ clientName: "Padaria Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.settings.multiProduct = true;
  s.elements = [
    ["Pão", "Pesar farinha", "A", "1", "20"], // 20 s ÷ 10 = 2
    ["Pão", "Laminar", "C", "10", "50"], // 30 s ÷ 10 = 3
    ["Pão", "Buscar bandeja", "A", "1", "100"], // 01:00 → 10 s ÷ 10 = 1
    ["Pão", "Laminar", "C", "10", "130"], // 01:30 → +30 s → Laminar 60 ÷ 20 = 3
    ["Pão", "Modelar", "C", "10", "210"], // 02:10 → 40 s ÷ 10 = 4
  ].map(([product, description, type, quantity, videoTime]) => C.createElement({ product, description, type, quantity, videoTime }));
  s.filmPieces = { inicio: "10" };
  return s;
}

test("E1: elementos do produto uma vez cada, na ordem da grade, com as linhas e o tempo", () => {
  const s = study();
  const l = C.etapaElements(s, "pão");
  assert.deepEqual(l.map((g) => [g.name, g.firstSeq, g.rows.length, sec(g.cycleTime), g.etapa]), [
    ["Pesar farinha", 1, 1, 2, ""],
    ["Laminar", 2, 2, 3, ""],
    ["Buscar bandeja", 3, 1, 1, ""],
    ["Modelar", 5, 1, 4, ""],
  ]);
  s.elements[1].etapa = "Laminação";
  assert.equal(C.etapaElements(s, "pão")[1].etapa, null, "linhas do mesmo elemento em etapas diferentes = várias");
});

test("E2: uma etapa por elemento vale para todas as linhas dele; prévia do TP por etapa; TP do produto igual", () => {
  const s = study();
  const l = C.etapaElements(s, "pão");
  const a = new Map([["pesar farinha", "Preparação"], ["laminar", "Laminação"], ["buscar bandeja", "Laminação"], ["modelar", "Modelagem"]]);
  const ch = C.etapaAssignPlan(s, l, a);
  assert.deepEqual(ch.map((c) => [c.index, c.value]), [[0, "Preparação"], [1, "Laminação"], [3, "Laminação"], [2, "Laminação"], [4, "Modelagem"]]);
  const pv = C.etapaPreview(s, "pão", ch);
  assert.deepEqual(pv.etapas.map((e) => [e.name, sec(e.tp)]), [["Preparação", 2], ["Laminação", 4], ["Modelagem", 4]]);
  assert.equal(sec(pv.tp), 10, "TP do produto = Σ etapas = 2 + 3 + 1 + 4");
  assert.equal(s.elements[0].etapa, "", "a prévia não altera o estudo");
  // Só as linhas com etapa diferente entram; vazio tira a etapa
  ch.forEach((c) => (s.elements[c.index].etapa = c.value));
  assert.deepEqual(C.etapaAssignPlan(s, C.etapaElements(s, "pão"), new Map([["modelar", "Modelagem"]])), []);
  assert.deepEqual(C.etapaAssignPlan(s, C.etapaElements(s, "pão"), new Map([["modelar", ""]])), [{ index: 4, value: "" }]);
});

test("E3: pedido à IA só com os elementos sem etapa (os demais vão como referência), anonimizado", () => {
  const s = study();
  s.elements[4].etapa = "Modelagem";
  const p = A.buildEtapasPrompt(s, C.computeStudy(s), true);
  assert.deepEqual(p.targets.map((t) => [t.id, t.name]), [[1, "Pesar farinha"], [2, "Laminar"], [3, "Buscar bandeja"]]);
  assert.ok(p.text.includes('"etapa_atual":"Modelagem"') && p.text.includes('"id":null'), "elemento com etapa vai como referência");
  assert.ok(p.text.includes("(3 no total)"));
  assert.ok(!p.text.includes("Padaria Teste"));
  assert.equal(p.temperature, 0.2);
  assert.ok(p.schema.properties.itens.items.required.includes("sem_etapa"));
});

test("E4: resposta lida pelo id; mesma etapa com grafias diferentes vira uma só; sem etapa clara; número no nome removido", () => {
  const s = study();
  const p = A.buildEtapasPrompt(s, C.computeStudy(s), true);
  const reply = JSON.stringify({
    itens: [
      { id: 1, sem_etapa: false, etapa: "1. Preparação da massa" },
      { id: 2, sem_etapa: false, etapa: "Laminação" },
      { id: 3, sem_etapa: false, etapa: "laminação " },
      { id: 4, sem_etapa: true, motivo: "Sequência não permite decidir" },
      { id: 9, sem_etapa: false, etapa: "Inventada" },
    ],
    etapas: [{ produto: "Pão", nome: "Laminação", justificativa: "Passagens no cilindro" }],
  });
  const out = A.parseEtapas(reply, p.targets, s);
  assert.deepEqual(out.items.map((i) => [i.id, i.etapa, i.noStage]), [[1, "Preparação da massa", false], [2, "Laminação", false], [3, "Laminação", false], [4, "", true]]);
  assert.equal(out.why.get("laminação"), "Passagens no cilindro");
});
