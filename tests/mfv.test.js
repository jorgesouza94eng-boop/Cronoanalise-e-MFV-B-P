/**
 * Testes do MFV (aba "EP" da planilha MFV Simplificado).
 * Referência: MFV da Laje Forte (REV1) — valores conferidos com a planilha.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/mfv-calc.js");

const close = (a, b, msg, tol) => assert.ok(Math.abs(a - b) < (tol || 1e-6), `${msg || ""} esperado ${b}, obtido ${a}`);

/** MFV da Laje Forte: seg–sex 07:30–17:00 com 1:30 de refeição, sáb 07:30–11:30. */
function lajeForte() {
  const d = M.createMfv({ clientName: "Laje Forte", family: "Lajes treliçadas" });
  d.schedule = M.DAYS.map((day, i) => ({
    day,
    start: i < 6 ? "07:30" : "",
    end: i < 5 ? "17:00" : i === 5 ? "11:30" : "",
    breaks: "",
    meal: i < 5 ? "01:30" : "",
  }));
  d.demandMonthly = String((1240 / 6) * 26);
  d.workDaysMonth = "26";
  d.timeUnit = "h";
  d.steps = [M.createStep({ name: "Família laje – ciclo completo", tcManualMin: 0.035484 * 60, operators: "2", kaizen: true })];
  d.inventories = [
    M.createInventory({ name: "Laje no molde (cura 24 h)", quantity: String(1240 / 6) }),
    M.createInventory({ name: "Cura no pátio (7 dias)", quantity: String((7 * 1240) / 6) }),
  ];
  return d;
}

test("horário: relógio aceita 07:30, 730 e 7; recusa 25:00 e 7:75", () => {
  assert.equal(M.parseClock("07:30").minutes, 450);
  assert.equal(M.parseClock("730").minutes, 450);
  assert.equal(M.parseClock("7").minutes, 420);
  assert.equal(M.parseClock("").minutes, null);
  assert.ok(M.parseClock("25:00").error);
  assert.ok(M.parseClock("7:75").error);
  assert.equal(M.formatClock(520), "08:40");
});

test("Laje Forte (aba EP): tempo disponível, demanda diária e takt iguais à planilha", () => {
  const r = M.computeMfv(lajeForte());
  close(r.weekMin * 60, 158400, "K21 seg/semana");
  close(r.avgDayMin, 440, "K23 min/dia");
  assert.equal(r.workedDays, 6);
  close(r.demandDaily, 206.6666667, "O22 m²/dia", 1e-6);
  close(r.takt / 60, 0.0354838709677, "O23 takt (h)", 1e-9);
});

test("Laje Forte (aba EP): capacidade, produtividade, operadores ideais e atravessamento", () => {
  const r = M.computeMfv(lajeForte());
  close(r.line.capacityDay, 206.66591515, "K46 m²/dia", 1e-4);
  close(r.line.capacityHour, 28.18171570, "K47 m²/hora", 1e-4);
  close(r.line.productivityDay, 103.33295757, "K50 m²/dia/op", 1e-4);
  close(r.line.productivityHour, 14.09085785, "K51 m²/h/op", 1e-4);
  close(r.opsIdeal, 1.0000036, "K43 operadores ideais", 1e-5);
  close(r.leadTimeDays, 8, "E65 atravessamento (dias)");
  assert.equal(r.kaizen.name, "Família laje – ciclo completo");
});

test("GBO: gargalo = maior TC; % do takt; operadores efetivos com uptime", () => {
  const d = M.createMfv({ clientName: "A", family: "B" });
  d.demandMonthly = "8800";
  d.workDaysMonth = "22";
  d.steps = [
    M.createStep({ name: "Corte", tcManualMin: 0.75, operators: "2" }),
    M.createStep({ name: "Solda", tcManualMin: 1.5, operators: "1", uptimePct: "50" }),
  ];
  const r = M.computeMfv(d);
  close(r.availDayMin, 520, "07:30–17:30 − 20 min − 1 h");
  close(r.takt, 1.3);
  assert.equal(r.bottleneck.name, "Solda");
  assert.equal(r.status, "gargalo");
  assert.equal(r.steps[1].overTakt, true);
  close(r.steps[0].taktPct, (0.75 / 1.3) * 100);
  close(r.steps[1].opsEff, 0.5);
  close(r.opsTotal, 2.5);
  close(r.line.capacityDay, 520 / 1.5);
});

test("GBO: TC do estudo × TC editado (o editado prevalece até voltar ao estudo)", () => {
  const d = M.createMfv({});
  d.demandMonthly = "100";
  d.steps = [M.createStep({ name: "Posto", source: "study", studyId: "x", tcStudyMin: 2, tcManualMin: 3 })];
  assert.equal(M.computeMfv(d).steps[0].tc, 2);
  d.steps[0].source = "manual";
  assert.equal(M.computeMfv(d).steps[0].tc, 3);
});

test("validações: horário invertido, disponibilidade fora da faixa e etapa sem TC", () => {
  const d = M.createMfv({});
  d.schedule[0] = { day: "SEG", start: "17:00", end: "07:00", breaks: "", meal: "" };
  d.availabilityPct = "0";
  d.steps = [M.createStep({ name: "Sem TC" })];
  const r = M.computeMfv(d);
  assert.ok(r.days[0].errors.length);
  assert.ok(r.issues.some((m) => /Disponibilidade/.test(m)));
  assert.ok(r.steps[0].errors.includes("Informe o TC"));
  assert.equal(r.status, "incompleto");
});

test("disponibilidade da família reduz o tempo disponível e o takt", () => {
  const d = lajeForte();
  d.availabilityPct = "50";
  const r = M.computeMfv(d);
  close(r.availDayMin, 220);
  close(r.takt, 220 / ((1240 / 6) * 26 / 26));
});

test("arquivo MFV: nome fixo, ida e volta JSON e recusa de outros arquivos", () => {
  const d = lajeForte();
  assert.match(d.fileName, /^MFV_Laje_Forte_Lajes_trelicadas_\d{4}-\d\d-\d\d_[0-9a-f]{8}\.json$/);
  const r = M.normalizeMfv(JSON.parse(M.serializeMfv(d)));
  assert.ok(r.ok);
  assert.equal(r.doc.steps[0].kaizen, true);
  assert.equal(r.doc.schedule[5].end, "11:30");
  assert.equal(r.doc.timeUnit, "h");
  assert.equal(M.normalizeMfv({ schema: "lean-chrono-estudo", schemaVersion: 1, id: "x" }).ok, false);
  const out = JSON.parse(M.serializeMfv(d));
  assert.equal(out.results.leadTimeDays, 8);
});

test("operadores: total digitado (equipe compartilhada) prevalece sobre a soma das etapas", () => {
  const d = lajeForte();
  d.steps = [
    M.createStep({ name: "Corte", tcManualMin: 0.3, operators: "2" }),
    M.createStep({ name: "Concretagem", tcManualMin: 1.2, operators: "2" }),
  ];
  let r = M.computeMfv(d);
  assert.equal(r.opsTotal, 4, "sem total digitado: soma das etapas");
  d.operatorsTotal = "2";
  r = M.computeMfv(d);
  assert.equal(r.opsTotal, 2);
  assert.equal(r.opsSum, 4);
  assert.equal(r.opsTyped, true);
  close(r.line.productivityDay, r.line.capacityDay / 2);
});

/* ==========================================================================
   PRODUTIVIDADE REAL (pç/HH) E PAYBACK (REV 1.2)
   ========================================================================== */

function withDays(doc) {
  const R = M.createProductivityRecord;
  doc.productivity = [
    R({ period: "base", pieces: "100", operators: "2", hours: "8" }),
    R({ period: "base", pieces: "120", operators: "2", hours: "8" }),
    R({ period: "acomp", pieces: "150", operators: "2", hours: "8" }),
    R({ period: "acomp", pieces: "140", operators: "2", hours: "8" }),
  ];
  return doc;
}

test("pç/HH: média do período = Σ produção ÷ Σ HH; ganho contra a meta de 20%", () => {
  const d = withDays(M.createMfv({}));
  const p = M.computeMfv(d).productivity;
  close(p.records[0].pcHH, 6.25);
  close(p.base.pcHH, 220 / 32);
  close(p.acomp.pcHH, 290 / 32);
  assert.equal(p.base.days, 2);
  assert.equal(p.source, "real");
  close(p.gainPct, (290 / 220 - 1) * 100);
  assert.equal(p.targetPct, 20);
  assert.equal(p.status, "meta");
  close(p.targetPcHH, (220 / 32) * 1.2);
});

test("pç/HH: linha incompleta fica fora da média; linha em branco não é erro", () => {
  const d = withDays(M.createMfv({}));
  d.productivity.push(M.createProductivityRecord({ period: "base", pieces: "500", operators: "", hours: "8" }));
  d.productivity.push(M.createProductivityRecord({ period: "base" }));
  const p = M.computeMfv(d).productivity;
  assert.equal(p.errorCount, 1);
  assert.equal(p.base.days, 2);
  close(p.base.pcHH, 220 / 32);
});

test("pç/HH: sem acompanhamento usa o projetado como estimativa; queda é sinalizada", () => {
  const d = withDays(M.createMfv({}));
  d.productivity = d.productivity.filter((x) => x.period === "base");
  assert.equal(M.computeMfv(d).productivity.status, "incompleto");
  d.productivityProjected = "8";
  let p = M.computeMfv(d).productivity;
  assert.equal(p.source, "projetado");
  close(p.gainPct, (8 / (220 / 32) - 1) * 100);
  assert.equal(p.status, "abaixo");
  d.productivityProjected = "5";
  p = M.computeMfv(d).productivity;
  assert.equal(p.status, "queda");
});

test("payback: HH economizadas × custo da HH + outros ganhos; meses = investimento ÷ ganho", () => {
  const d = withDays(M.createMfv({}));
  d.paybackInvestment = "20000";
  d.hhCost = "30";
  d.paybackMonthlyProd = "5000";
  d.paybackOtherGains = "500";
  const pb = M.computeMfv(d).payback;
  const saved = 5000 * (32 / 220 - 32 / 290);
  close(pb.hhSavedMonth, saved);
  close(pb.laborGain, saved * 30);
  close(pb.monthlyGain, saved * 30 + 500);
  close(pb.months, 20000 / (saved * 30 + 500));
  close(pb.annualGain, (saved * 30 + 500) * 12);
  assert.equal(pb.status, "ok");
  const json = JSON.parse(M.serializeMfv(d));
  assert.equal(json.results.payback.status, "ok");
  assert.equal(json.results.productivity.status, "meta");
});

test("payback: produção mensal vem da demanda do MFV; sem investimento ou com queda não calcula", () => {
  const d = withDays(M.createMfv({}));
  d.demandMonthly = "4400";
  d.hhCost = "30";
  let pb = M.computeMfv(d).payback;
  assert.equal(pb.monthlyProd, 4400);
  assert.equal(pb.monthlyProdFromDemand, true);
  assert.equal(pb.status, "incompleto", "sem investimento");
  d.paybackInvestment = "1000";
  d.productivity = d.productivity.map((x) => (x.period === "acomp" ? Object.assign(x, { pieces: "50" }) : x));
  pb = M.computeMfv(d).payback;
  assert.ok(pb.monthlyGain < 0);
  assert.equal(pb.status, "sem-retorno");
  assert.equal(pb.months, null);
  d.paybackInvestment = "-5";
  assert.equal(M.computeMfv(d).payback.status, "invalido");
});

test("pç/HH e payback: gravados no arquivo; MFV da versão anterior abre com a meta de 20%", () => {
  const d = withDays(M.createMfv({}));
  d.productivity[0].date = "2026-10-01";
  d.paybackInvestment = "1500";
  const back = M.normalizeMfv(JSON.parse(M.serializeMfv(d))).doc;
  assert.equal(back.schemaVersion, M.SCHEMA_VERSION);
  assert.equal(back.productivity.length, 4);
  assert.equal(back.productivity[0].date, "2026-10-01");
  assert.equal(back.productivity[2].period, "acomp");
  assert.equal(back.paybackInvestment, "1500");
  const old = M.normalizeMfv({ schema: M.SCHEMA_ID, schemaVersion: 1, id: "x" }).doc;
  assert.deepEqual(old.productivity, []);
  assert.equal(old.productivityTargetPct, "20");
});
