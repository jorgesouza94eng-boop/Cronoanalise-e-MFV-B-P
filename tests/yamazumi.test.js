/**
 * Testes do Yamazumi (js/yamazumi-calc.js) e da regra do grupo Posto no MFV (js/mfv-calc.js).
 * Exemplo de conferência da regra confirmada (CLAUDE.md): Corte 30 s, Solda 52 s,
 * Célula (Op.1 40 s + Op.2 28 s), Embalagem 18 s, takt 45 s.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const Y = require("../js/yamazumi-calc.js");
const M = require("../js/mfv-calc.js");

const close = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) < (tol || 1e-9), `${msg || ""} esperado ${expected}, obtido ${actual}`);
const s = (sec) => sec / 60; // segundos → minutos

/** Estudo sintético (frequência, leitura contínua em segundos, takt 45 s). */
function study(id, processName, elements, tol) {
  const st = C.createStudy({
    id,
    clientName: "Empresa Teste",
    processName,
    settings: { entryMode: "frequencia", timeUnit: "s" },
    shiftParams: { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 640, tolerancePct: tol || 0 },
  });
  let clock = 0;
  st.elements = elements.map((e) => {
    clock += e.sec;
    return C.createElement({ description: e.name, videoTime: String(clock), value: e.value || "AG", waste: e.waste || "" });
  });
  return st;
}

const op1 = () =>
  study("op1", "Célula Op.1", [
    { name: "Montar", sec: 30 },
    { name: "Buscar peça", sec: 10, value: "NA", waste: "movimentacao" },
  ]);
const op2 = (withWait) =>
  study("op2", "Célula Op.2", [{ name: "Soldar", sec: 28 }].concat(withWait ? [{ name: "Aguardando Op.1", sec: 12, value: "NA", waste: "espera" }] : []));

function cell(withWait) {
  const studies = new Map([
    ["op1", op1()],
    ["op2", op2(withWait)],
  ]);
  const g = Y.createGroup({ clientName: "Empresa Teste", name: "Célula", kind: "posto", members: [{ studyId: "op1" }, { studyId: "op2" }] });
  return { g, studies, r: Y.computeGroup(g, studies) };
}

test("Yamazumi: célula Op.1 40 s + Op.2 28 s → ciclo 40, conteúdo 68, balanceamento 85%", () => {
  const { r } = cell(false);
  assert.equal(r.n, 2);
  close(r.cycle, s(40));
  close(r.content, s(68));
  close(r.balancePct, 85);
  close(r.takt, s(45), 1e-9, "takt pré-preenchido pelo 1º estudo");
  close(r.taktPct, (40 / 45) * 100);
  close(r.opsIdeal, 68 / 45);
  assert.equal(r.status, "atende");
  close(r.capacityDay, 480 / s(40));
  close(r.hhPerPiece, (2 * s(40)) / 60);
});

test("Yamazumi: 'Aguardando Op.1' 12 s lançado como Espera não muda ciclo nem conteúdo", () => {
  const { r } = cell(true);
  close(r.cycle, s(40));
  close(r.content, s(68));
  close(r.balancePct, 85);
  const m2 = r.members[1];
  close(m2.tp, s(40));
  close(m2.wait, s(12));
  close(m2.classes.ESP, s(12));
  close(m2.classes.NA, 0, 1e-9, "espera não entra em Não agrega");
});

test("Yamazumi: segmentos por classe e por elemento, com tolerância", () => {
  const st = study("t", "Posto", [
    { name: "A", sec: 30 },
    { name: "B", sec: 10, value: "IN" },
    { name: "C", sec: 20, value: "NA", waste: "espera" },
  ], 10);
  const m = Y.memberMetrics(st, "");
  close(m.tn, s(60));
  close(m.tp, s(66));
  close(m.tolerance, s(6));
  close(m.wait, s(22), 1e-9, "espera no TP = TN × (1 + tol)");
  close(m.content, s(44));
  const byClass = Y.segments(m, "classe");
  assert.deepEqual(byClass.map((x) => x.key), ["AG", "IN", "ESP", "TOL"]);
  close(byClass.reduce((a, x) => a + x.value, 0), m.tp);
  const byEl = Y.segments(m, "elemento");
  assert.deepEqual(byEl.map((x) => x.label), ["A", "B", "C", "Tolerância"]);
  close(byEl.reduce((a, x) => a + x.value, 0), m.tp);
});

test("Yamazumi: takt digitado prevalece e avisos de consistência", () => {
  const studies = new Map([
    ["op1", op1()],
    ["x", Object.assign(op2(false), { clientName: "Outra" })],
  ]);
  studies.get("x").shiftParams.tolerancePct = 5;
  const g = Y.createGroup({ kind: "posto", members: [{ studyId: "op1" }, { studyId: "x" }, { studyId: "sumiu" }], taktMin: s(30) });
  const r = Y.computeGroup(g, studies);
  close(r.takt, s(30));
  assert.equal(r.status, "acima");
  assert.equal(r.n, 2);
  assert.ok(r.warnings.some((w) => /não encontrado/.test(w)));
  assert.ok(r.warnings.some((w) => /empresas diferentes/.test(w)));
  assert.ok(r.warnings.some((w) => /tolerâncias diferentes/.test(w)));
});

test("Yamazumi: comparação T1 × T3 com variação proporcional", () => {
  const t1 = { cycle: 2, content: 3, n: 2, hhPerPiece: 4 / 60, pcPerHH: 15, balancePct: 75, naPct: 30, motion: 0.5 };
  const t3 = { cycle: 1.5, content: 2.7, n: 2, hhPerPiece: 3 / 60, pcPerHH: 20, balancePct: 90, naPct: 15, motion: 0.5 };
  const rows = Y.compareGroups(t1, t3);
  const by = (k) => rows.find((x) => x.key === k);
  close(by("cycle").deltaPct, -25);
  assert.equal(by("cycle").verdict, "melhora");
  close(by("pcPerHH").deltaPct, (20 / 15 - 1) * 100);
  assert.equal(by("balancePct").verdict, "melhora");
  assert.equal(by("motion").verdict, "igual");
  assert.equal(Y.compareGroups(t1, null)[0].deltaPct, null);
});

test("Yamazumi: normalizeGroup valida e preserva os campos", () => {
  const g = Y.createGroup({ clientName: "Empresa Teste", name: "Célula", members: [{ studyId: "a", product: "p" }], taktMin: 0.5 });
  const back = Y.normalizeGroup(JSON.parse(Y.serializeGroup(g)));
  assert.ok(back.ok);
  assert.equal(back.doc.members[0].product, "p");
  assert.equal(back.doc.taktMin, 0.5);
  assert.match(back.doc.fileName, /^Yamazumi_Empresa_Teste_Celula_/);
  assert.equal(Y.normalizeGroup({ schema: "outro" }).ok, false);
});

/* ==========================================================================
   REGRA DO GRUPO POSTO NO MFV
   ========================================================================== */

function mfvExample() {
  const d = M.createMfv({ clientName: "Empresa Teste", family: "Produto" });
  d.schedule.forEach((day) => Object.assign(day, { start: "07:00", end: "15:00", breaks: "", meal: "" }));
  d.demandMonthly = String(640 * 22);
  d.workDaysMonth = "22";
  const { r } = cell(false);
  d.steps = [
    M.createStep({ name: "Corte", tcManualMin: s(30) }),
    M.createStep({ name: "Solda", tcManualMin: s(52) }),
    M.createStep({ name: "Célula", source: "group", groupId: "g1", tcGroupMin: r.cycle, contentGroupMin: r.content, groupOperators: 2, operators: "2" }),
    M.createStep({ name: "Embalagem", tcManualMin: s(18) }),
  ];
  return d;
}

test("MFV com grupo Posto: exemplo de conferência da regra confirmada", () => {
  const r = M.computeMfv(mfvExample());
  close(r.takt, s(45));
  close(r.steps[2].tc, s(40));
  close(r.steps[2].taktPct, (40 / 45) * 100);
  assert.equal(r.bottleneck.name, "Solda");
  close(r.line.capacityDay, 553.846, 1e-3);
  close(r.contentTotal, s(168));
  close(r.opsIdeal, 168 / 45);
  close(r.opsTotal, 5);
  close(r.lineBalancePct, (168 / (5 * 52)) * 100);
  close(r.tcTotal, s(140), 1e-9, "tempo de processamento usa o ciclo do posto");
  assert.equal(r.hasGroups, true);
});

test("MFV com grupo Posto: TC editado ajusta o conteúdo na proporção; conteúdo digitado prevalece", () => {
  const d = mfvExample();
  const step = d.steps[2];
  step.source = "manual";
  step.tcManualMin = s(36);
  let r = M.computeMfv(d);
  close(r.steps[2].tc, s(36));
  close(r.steps[2].content, s(68 * 36 / 40));
  assert.equal(r.steps[2].contentSource, "proporcional");
  step.contentManualMin = s(60);
  r = M.computeMfv(d);
  close(r.steps[2].content, s(60));
  assert.equal(r.steps[2].contentSource, "manual");
  assert.ok(r.steps[2].warnings.length);
});

test("MFV sem grupos: operadores ideais continuam ΣTC ÷ takt", () => {
  const d = mfvExample();
  d.steps.splice(2, 1);
  const r = M.computeMfv(d);
  close(r.opsIdeal, 100 / 45);
  assert.equal(r.hasGroups, false);
  const back = M.normalizeMfv(JSON.parse(M.serializeMfv(mfvExample())));
  assert.equal(back.doc.steps[2].source, "group");
  close(back.doc.steps[2].contentGroupMin, s(68));
});

test("Yamazumi: Excel simples com as abas Yamazumi, Elementos e T1 x T3", () => {
  const X = require("../js/xlsx.js");
  const { g, r } = cell(true);
  const sheets = Y.buildGroupSheets(g, r, Y.compareGroups(r, r));
  assert.deepEqual(sheets.map((x) => x.name), ["Yamazumi", "Elementos", "T1 x T3"]);
  const header = sheets[0].rows.findIndex((row) => row[0] && row[0].v === "Operador");
  assert.equal(sheets[0].rows[header + 2][5].v, 40, "TP do Op.2 em segundos");
  assert.equal(sheets[0].rows[header + 2][9].v, 12, "espera do Op.2");
  assert.equal(sheets[1].rows.length, 1 + 4);
  const bytes = X.buildWorkbook(sheets);
  assert.ok(bytes.length > 1000);
});
