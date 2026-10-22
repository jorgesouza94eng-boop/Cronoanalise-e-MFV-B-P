/**
 * Testes da REV 1.14: vários operadores no mesmo estudo (Fase 1) e avisos de consistência
 * (Fase 3). Dados fictícios do consultor: tempo líquido 28.800 s (480 min), demanda 1.800/dia
 * (takt 16 s), tolerância 0%, 1 filmagem de 00:00 a 02:00, 10 peças.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");

const sec = (min) => (min == null ? null : min * 60);
const near = (actual, expected, dec, msg) =>
  assert.equal(Number(Number(actual).toFixed(dec)), expected, `${msg || ""} esperado ${expected}, obtido ${actual}`);

/** rows: [op, elemento, tipo, qtd, tempo final, valor, desperdício] */
function study(rows, extra) {
  const s = C.createStudy({ id: "op000000-0000-4000-8000-000000000000", clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 1800, tolerancePct: 0 };
  s.elements = rows.map(([operador, description, type, quantity, videoTime, value, waste]) =>
    C.createElement({ operador, description, type, quantity: String(quantity), videoTime, value: value || "AG", waste: waste || "" })
  );
  s.filmPieces = { inicio: "10" };
  s.settings.numOperadores = 2;
  return Object.assign(s, extra || {});
}
/** T1, com as linhas intercaladas na ordem do vídeo. */
const T1 = () => [
  [2, "Buscar material", "A", 1, "20", "IN", "movimentacao"],
  [1, "Preparar", "A", 1, "30", "IN"],
  [2, "Embalar", "C", 10, "1:30"],
  [1, "Montar", "C", 10, "1:50"],
  [1, "Aguardando Op2", "A", 1, "2:00", "NA", "espera"],
  [2, "Aguardando Op1", "A", 1, "2:00", "NA", "espera"],
];
const T9 = () => T1().concat([
  [3, "Inspecionar", "C", 10, "1:00"],
  [3, "Aguardando", "A", 1, "2:00", "NA", "espera"],
]);

test("T1: leitura contínua por operador — TP Op1 = 3 + 8 + 1 = 12 s; TP Op2 = 2 + 7 + 3 = 12 s", () => {
  const r = C.computeStudy(study(T1()));
  assert.equal(r.multiOperator, true);
  assert.deepEqual(r.rows.map((x) => Number(sec(x.subtractedTime).toFixed(6))), [20, 30, 70, 80, 10, 30], "tempo subtraído pelo mesmo operador");
  const [o1, o2] = r.product.operators;
  assert.deepEqual(o1.summary.elements.map((g) => Number(sec(g.cycleTime).toFixed(6))), [3, 8, 1]);
  assert.deepEqual(o2.summary.elements.map((g) => Number(sec(g.cycleTime).toFixed(6))), [2, 7, 3]);
  near(sec(o1.tp), 12, 6);
  near(sec(o2.tp), 12, 6);
  assert.equal(r.errorCount, 0);
  assert.deepEqual(r.warnings, []);
});

test("T2: posto — conteúdo 20 s, ciclo 12 s, balanceamento 83,3%, ideais 1,25, capacidade 2.400/dia", () => {
  const r = C.computeStudy(study(T1()));
  const p = r.product.posto;
  near(sec(r.product.operators[0].content), 11, 6);
  near(sec(r.product.operators[1].content), 9, 6);
  near(sec(p.content), 20, 6);
  near(sec(p.cycle), 12, 6);
  near(p.balancePct, 83.3, 1);
  near(p.opsIdeal, 1.25, 2);
  assert.equal(r.kpis.capacity, 2400);
  assert.equal(r.kpis.status, "balanceado", "ciclo do posto 12 s ≤ takt 16 s");
  near(sec(r.kpis.taktTime), 16, 6);
});

test("T3: atividade em paralelo — Enrolar de 00:00 a 07:13, Qtd 66 cada, 66 peças", () => {
  const s = study([
    [1, "Enrolar", "C", 66, "7:13"],
    [2, "Enrolar", "C", 66, "7:13"],
  ]);
  s.filmPieces = { inicio: "66" };
  const r = C.computeStudy(s);
  r.product.operators.forEach((o) => near(sec(o.tp), 6.56, 2, o.label));
  near(sec(r.product.posto.cycle), 6.56, 2);
  near(sec(r.product.posto.content), 13.12, 2);
  assert.equal(r.filmList[0].observed * 60, 433, "tempo observado da filmagem não soma os operadores");
});

test("T4: Op2 termina em 01:40 numa filmagem que termina em 02:00 → aviso", () => {
  const rows = T1();
  rows[5][4] = "1:40";
  const r = C.computeStudy(study(rows));
  assert.ok(r.warnings.includes("Op2 termina em 01:40; a filmagem termina em 02:00"), r.warnings.join(" | "));
});

test("T5: leitura do Op2 menor que a anterior do Op2 (mas maior que a do Op1) → erro só no Op2", () => {
  const rows = T1();
  rows.splice(3, 0, [2, "Conferir", "C", 10, "1:00"]); // Op2 já estava em 01:30; o Op1 em 00:30
  const r = C.computeStudy(study(rows));
  const bad = r.rows.filter((x) => !x.valid);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].operator, 2);
  assert.match(bad[0].errors[0], /menor que a leitura anterior do Op2 \(01:30\)/);
});

test("T7: estudo de 1 operador — resultados idênticos aos da REV 1.12", () => {
  const rows = T1().map((x) => Object.assign([], x, { 0: 1 }));
  const s = study(rows.slice(0, 4).map((x, i) => Object.assign([], x, { 4: ["20", "50", "1:30", "2:00"][i] })));
  s.settings.numOperadores = 1;
  const withField = C.computeStudy(s);
  const old = JSON.parse(JSON.stringify(s));
  old.schemaVersion = 5;
  delete old.settings.numOperadores;
  old.elements.forEach((e) => delete e.operador);
  const r = C.computeStudy(C.normalizeStudy(old).study);
  assert.equal(r.multiOperator, false);
  assert.equal(r.product.operators, null);
  assert.equal(r.kpis.standardTime, withField.kpis.standardTime);
  assert.deepEqual(r.rows.map((x) => x.subtractedTime), withField.rows.map((x) => x.subtractedTime));
  assert.deepEqual(r.summary.elements.map((g) => g.cycleTime), withField.summary.elements.map((g) => g.cycleTime));
  near(sec(r.kpis.standardTime), 12, 6, "leitura contínua única: 20÷10 + 30÷10 + 40÷10 + 30÷10 = 2 + 3 + 4 + 3");
});

test("T8: exportar e reimportar JSON preserva operador por linha, nº de operadores e tipo", () => {
  const s = study(T9(), {});
  s.settings.numOperadores = 3;
  s.settings.tipoOperadores = "linha";
  s.settings.nomesOperadores = { 1: "Ana" };
  const json = JSON.parse(C.serializeStudy(s));
  const n = C.normalizeStudy(json).study;
  assert.deepEqual(n.elements.map((e) => e.operador), [2, 1, 2, 1, 1, 2, 3, 3]);
  assert.equal(n.settings.numOperadores, 3);
  assert.equal(n.settings.tipoOperadores, "linha");
  assert.equal(n.settings.nomesOperadores["1"], "Ana");
  assert.equal(json.results.elements[0].operador, 2);
  assert.equal(json.results.operadores.porProduto[0].operadores.length, 3);
  assert.equal(json.results.operadores.porProduto[0].operadores[0].operador, "Op1 (Ana)");
  const csv = C.buildCSV(s);
  assert.match(csv, /Nº;Filmagem;Vídeo;Operador;Elemento/);
  assert.match(csv, /\n1;1;"";"Op2";"Buscar material"/);
  assert.match(csv, /OPERADORES \(3\) — tipo LINHA/);
});

test("T9: T1 + Op3 — TP 12, espera 6, conteúdo 6; posto 26 s, 72,2%, ideais 1,63", () => {
  const s = study(T9());
  s.settings.numOperadores = 3;
  const r = C.computeStudy(s);
  const o3 = r.product.operators[2];
  near(sec(o3.tp), 12, 6);
  near(sec(o3.wait), 6, 6);
  near(sec(o3.content), 6, 6);
  const p = r.product.posto;
  near(sec(p.cycle), 12, 6);
  near(sec(p.content), 26, 6);
  near(p.balancePct, 72.2, 1);
  near(p.opsIdeal, 1.63, 2);
  assert.equal(p.n, 3);
});

test("operador exibido: o resumo e os indicadores mostram o operador escolhido; 0 = posto", () => {
  const s = study(T1());
  s.settings.operadorExibido = 2;
  let r = C.computeStudy(s);
  assert.equal(r.operatorView, 2);
  assert.deepEqual(r.summary.elements.map((g) => g.name), ["Buscar material", "Embalar", "Aguardando Op1"]);
  s.settings.operadorExibido = 0;
  r = C.computeStudy(s);
  assert.equal(r.summary.elements.length, 6, "posto: elementos dos dois operadores");
  assert.equal(r.summary.elements[0].opLabel, "Op1");
});

test("carga do mix usa o ciclo do posto de cada produto", () => {
  const s = study(T1().map((x) => x.concat([])));
  s.elements.forEach((e) => (e.product = "P1"));
  s.productDemand = { p1: "1000" };
  const r = C.computeStudy(s);
  near(sec(r.mix.weightedTP), 12, 6);
  near(r.mix.occupancyPct, 41.67, 2, "12 × 1.000 ÷ 28.800");
});

test("T11 (cálculo): 10 operadores — o 10º é aceito e há aviso de muitos operadores", () => {
  const rows = [];
  for (let n = 1; n <= 10; n++) rows.push([n, `Tarefa ${n}`, "C", 10, "1:00"]);
  const s = study(rows);
  s.settings.numOperadores = 10;
  const r = C.computeStudy(s);
  assert.equal(r.operatorCount, 10);
  assert.equal(r.product.operators.length, 10);
  assert.ok(r.warnings.includes("Muitos operadores no mesmo vídeo: confira a linha do tempo de cada um."));
  assert.equal(r.rows[9].operator, 10);
});

/* ==========================================================================
   FASE 3 — AVISOS DE CONSISTÊNCIA
   ========================================================================== */

function pao(rows, pieces) {
  const s = C.createStudy({ id: "pao00000-0000-4000-8000-000000000000", clientName: "Empresa Teste", processName: "Forma" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 600, tolerancePct: 0 };
  s.settings.multiProduct = true;
  s.elements = rows.map(([description, quantity, videoTime]) => C.createElement({ product: "Pão", description, type: "C", quantity: String(quantity), videoTime, value: "AG" }));
  s.filmPieces = { inicio: String(pieces) };
  return s;
}

test("A1: Σ quantidade 3 ≠ 96 peças → aviso; com Qtd 31, 30 e 35 → sem aviso", () => {
  const rows = (q) => [
    ["Passando Manteiga na Forma", q[0], "40"],
    ["Passando Manteiga na Forma", q[1], "1:20"],
    ["Passando Manteiga na Forma", q[2], "2:05"],
  ];
  let r = C.computeStudy(pao(rows([1, 1, 1]), 96));
  assert.ok(r.checks.some((t) => /Elemento "Passando Manteiga na Forma": Σ quantidade \(3\) diferente das peças do produto \(96\)/.test(t)), r.checks.join(" | "));
  r = C.computeStudy(pao(rows([31, 30, 35]), 96));
  assert.ok(!r.checks.some((t) => /Σ quantidade/.test(t)));
});

test("A2: ciclo 109,4 s × 435 s ÷ 96 peças = 4,53 s → aviso; ciclo corrigido → sem aviso", () => {
  let r = C.computeStudy(pao([["Moldar", 5, "6:47"], ["Untar", 1, "7:15"]], 96)); // 407÷5 + 28÷1 = 109,4 s
  near(sec(r.product.summary.cycleNormal), 109.4, 1);
  assert.ok(r.checks.some((t) => /Tempo do ciclo \(109,40 s\) diferente do tempo observado por peça \(4,53 s\)/.test(t)), r.checks.join(" | "));
  r = C.computeStudy(pao([["Moldar", 96, "6:47"], ["Untar", 96, "7:15"]], 96));
  near(sec(r.product.summary.cycleNormal), 4.53, 2);
  assert.deepEqual(r.checks, []);
});

test("A1/A2 com operadores: os avisos são por operador", () => {
  const rows = T1();
  rows[2][3] = 1; // Embalar com Qtd 1
  const r = C.computeStudy(study(rows));
  assert.ok(r.checks.some((t) => /^Op2: Elemento "Embalar": Σ quantidade \(1\)/.test(t)), r.checks.join(" | "));
  assert.ok(r.checks.some((t) => /^Op2: Tempo do ciclo/.test(t)));
  assert.ok(!r.checks.some((t) => /^Op1:/.test(t)));
});

/* ==========================================================================
   INTEGRAÇÕES (MFV, Yamazumi, modelo B+P)
   ========================================================================== */

const M = require("../js/mfv-calc.js");
const Y = require("../js/yamazumi-calc.js");

function mfv(steps, availMin) {
  const d = M.createMfv({ clientName: "Empresa Teste", family: "Teste" });
  const end = availMin === 520 ? "15:40" : "15:00";
  d.schedule.forEach((day) => Object.assign(day, { start: "07:00", end, breaks: "", meal: "" }));
  d.demandMonthly = String(1800 * 22);
  d.workDaysMonth = "22";
  d.steps = steps;
  return d;
}

test("T6: MFV tipo POSTO — 1 etapa com TC 12 s, 2 ops e conteúdo 20 s", () => {
  const r = C.computeStudy(study(T1()));
  const p = r.product.posto;
  const step = M.createStep({ name: "Bancada", source: "study", studyId: "x", tcStudyMin: p.cycle, contentStudyMin: p.content, operators: "2", studyOperators: 2 });
  const m = M.computeMfv(mfv([step]));
  near(sec(m.steps[0].tc), 12, 6);
  assert.equal(m.steps[0].operators, 2);
  near(sec(m.steps[0].content), 20, 6);
  assert.equal(m.steps[0].contentSource, "study");
  near(m.opsIdeal, 1.25, 2, "ideais pelo conteúdo: 20 ÷ 16");
  near(m.lineBalancePct, 83.3, 1, "20 ÷ (2 × 12)");
  // JSON do MFV preserva os campos da etapa
  const back = M.normalizeMfv(JSON.parse(M.serializeMfv(mfv([step])))).doc.steps[0];
  assert.equal(back.contentStudyMin, p.content);
  assert.equal(back.studyOperators, 2);
});

test("T10 (cálculo): tipo LINHA — 3 etapas (Op1, Op2, Op3) sem aviso de contagem dupla", () => {
  const s = study(T9());
  s.settings.numOperadores = 3;
  s.settings.tipoOperadores = "linha";
  const r = C.computeStudy(s);
  assert.equal(r.operatorKind, "linha");
  const steps = r.product.operators.map((o) => M.createStep({ name: `Bancada • ${o.label}`, source: "study", studyId: "x", studyOperator: o.op, tcStudyMin: o.tp }));
  const m = M.computeMfv(mfv(steps));
  assert.deepEqual(m.steps.map((x) => Number(sec(x.tc).toFixed(6))), [12, 12, 12]);
  const info = () => ({ warnings: [], demand: 1800, netTime: 480 });
  assert.deepEqual(M.linkChecks(mfv(steps), m, info).filter((c) => c.kind === "duplo"), []);
  // O mesmo operador duas vezes, ou o posto inteiro junto com um operador: contagem dupla
  const twice = steps.concat([M.createStep({ studyId: "x", studyOperator: 2 })]);
  assert.equal(M.linkChecks(mfv(twice), m, info).filter((c) => c.kind === "duplo").length, 1);
  const whole = steps.concat([M.createStep({ studyId: "x" })]);
  assert.equal(M.linkChecks(mfv(whole), m, info).filter((c) => c.kind === "duplo").length, 1);
});

test("A4: tempo líquido do estudo 480 min num MFV com 520 min/dia → aviso", () => {
  const steps = [M.createStep({ name: "Bancada", studyId: "x", tcStudyMin: 0.2 })];
  const d = mfv(steps, 520);
  const m = M.computeMfv(d);
  const out = M.linkChecks(d, m, () => ({ warnings: [], demand: null, netTime: 480 }));
  assert.ok(out.some((c) => c.kind === "tempo" && /Tempo disponível do MFV \(520 min\/dia\) diferente do tempo líquido dos estudos: 1\. Bancada \(480 min\)/.test(c.text)));
  assert.equal(M.linkChecks(mfv(steps, 480), M.computeMfv(mfv(steps, 480)), () => ({ warnings: [], netTime: 480 })).filter((c) => c.kind === "tempo").length, 0);
});

test("Yamazumi: estudo com N operadores entra como N barras (posto: ciclo 12, conteúdo 26)", () => {
  const s = study(T9());
  s.settings.numOperadores = 3;
  const studies = new Map([["op000000-0000-4000-8000-000000000000", s]]);
  const g = Y.createGroup({ kind: "posto", members: [{ studyId: "op000000-0000-4000-8000-000000000000" }] });
  const r = Y.computeGroup(g, studies);
  assert.equal(r.members.length, 3);
  assert.deepEqual(r.members.map((m) => m.label), ["Bancada • Op1", "Bancada • Op2", "Bancada • Op3"]);
  near(sec(r.cycle), 12, 6);
  near(sec(r.content), 26, 6);
  near(r.balancePct, 72.2, 1);
  assert.equal(r.n, 3);
});

test("T12: modelo B+P — um estudo por operador, cada um com o TP do operador", () => {
  const s = study(T1());
  [1, 2].forEach((op) => {
    const one = C.operatorStudy(s, op);
    const r = C.computeStudy(one);
    assert.equal(r.multiOperator, false);
    assert.equal(r.rows.length, 3);
    near(sec(r.kpis.standardTime), 12, 6, `Op${op}`);
    assert.match(one.processName, new RegExp(`— Op${op}$`));
  });
  assert.equal(s.elements.length, 6, "o estudo original não muda");
});

test("T12: filmagens preservadas no estudo do operador (início e peças da F2)", () => {
  const rows = T1().concat([
    [1, "Montar", "C", 10, "1:20"],
    [2, "Embalar", "C", 10, "1:10"],
  ]);
  const s = study(rows);
  s.elements[6].newVideo = true; // a F2 começa numa linha do Op1
  s.filmPieces = { inicio: "10", [s.elements[6].id]: "10" };
  const r2 = C.computeStudy(C.operatorStudy(s, 2));
  assert.equal(r2.filmCount, 2, "o Op2 também tem a F2");
  near(sec(r2.rows[3].subtractedTime), 70, 6, "1ª linha do Op2 na F2: 01:10 − início 00:00");
  assert.equal(r2.films.acyclic, "por-unidade", "as peças da F2 continuam valendo");
});
