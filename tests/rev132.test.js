/**
 * Testes da REV 1.32 (achados da bateria de testes de 05/11/2026): takt do Excel do MFV em
 * HORAS, aviso das 7 etapas do Nº ideal, r05 com elementos sem classificação, tolerância fora
 * de 0–99% e paradas iguais ao expediente. Modelos sintéticos, sem dados de cliente.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");
const X = require("../js/xlsx.js");
const T = require("../js/xlsx-template.js");
const { buildR05 } = require("./r05-template.js");

const inflate = (b) => new Uint8Array(zlib.inflateRawSync(b));
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sheet = (rows) => `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;

/** MFV Simplificado sintético (cabeçalhos que o app confere e a fórmula K43 = K40 ÷ O23). */
function buildMfv() {
  const t = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${X.esc(v)}</t></is></c>`;
  const ep =
    `<row r="20">${t("B20", "HORÁRIO DE TRABALHO - ESTADO PRESENTE")}</row><row r="21">${t("B21", "Dias da Semana")}</row>` +
    `<row r="23">${t("P23", "MINUTOS")}</row><row r="35">${t("D35", "HORAS / peça")}</row>` +
    `<row r="38">${t("C38", "Etapa")}${t("E38", "TC")}${t("F38", "NÚM. OPs")}</row>` +
    `<row r="40"><c r="K40"><f>SUM(E39:E45)</f></c></row><row r="43"><c r="K43"><f>K40/O23</f></c></row>` +
    `<row r="54">${t("B54", "Estoques")}</row>`;
  const names = ["EP", "EF"];
  return X.zip([
    { name: "xl/workbook.xml", data: new TextEncoder().encode(`<?xml version="1.0"?><workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: new TextEncoder().encode(`<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", data: new TextEncoder().encode(sheet(ep)) },
    { name: "xl/worksheets/sheet2.xml", data: new TextEncoder().encode(sheet(ep)) },
  ]);
}

function mfv(nSteps, unit) {
  const d = M.createMfv({ clientName: "QA", family: "F" });
  d.schedule.forEach((x, i) => Object.assign(x, i < 5 ? { start: "07:00", end: "17:00", breaks: "20", meal: "60" } : { start: "", end: "", breaks: "", meal: "" }));
  d.demandMonthly = "8800";
  d.workDaysMonth = "22";
  d.timeUnit = unit;
  d.steps = Array.from({ length: nSteps }, (_, j) => M.createStep({ name: `E${j}`, tcManualMin: 0.5, operators: "1" }));
  return d;
}

const epXml = (bytes) => {
  const e = T.readZip(bytes).find((x) => x.name === "xl/worksheets/sheet1.xml");
  return new TextDecoder().decode(e.method === 0 ? e.compressed : inflate(e.compressed));
};

test("1 — Excel do MFV: takt em HORAS (mesma unidade do TC), com aviso quando o MFV usa min/s", async () => {
  for (const unit of ["min", "s", "h"]) {
    const out = await T.fillFromBytes(buildMfv(), mfv(4, unit), { inflate, expect: "mfv" });
    const ep = epXml(out.bytes);
    assert.match(ep, /<c r="P23"[^>]*><is><t[^>]*>HORAS<\/t>/, `P23 = HORAS (unidade ${unit})`);
    assert.match(ep, /<c r="D35"[^>]*><is><t[^>]*>HORAS \/ peça<\/t>/);
    const warn = out.warnings.some((w) => w.includes("O takt vai para a planilha em HORAS"));
    assert.equal(warn, unit !== "h", `aviso da unidade (${unit})`);
  }
});

test("2 — Excel do MFV: mais de 7 etapas → aviso do Nº ideal da planilha (soma E39:E45)", async () => {
  let out = await T.fillFromBytes(buildMfv(), mfv(7, "h"), { inflate, expect: "mfv" });
  assert.ok(!out.warnings.some((w) => w.includes("soma só")));
  out = await T.fillFromBytes(buildMfv(), mfv(9, "h"), { inflate, expect: "mfv" });
  const w = out.warnings.find((x) => x.includes("soma só"));
  assert.ok(w && w.includes("9 etapas") && w.includes("7 primeiras") && w.includes("3,46"), w);
});

test("4 — r05: elementos sem classificação de valor → aviso (ficam fora da Compilação)", async () => {
  const s = C.createStudy({ clientName: "QA", processName: "P" });
  s.elements = [
    C.createElement({ description: "Cortar", videoTime: "0:20", quantity: "2", value: "AG" }),
    C.createElement({ description: "Conferir", videoTime: "0:30", quantity: "1", value: "" }),
    C.createElement({ description: "Embalar", videoTime: "0:45", quantity: "1", value: "" }),
  ];
  const tpl = await T.loadTemplate(buildR05(), { inflate });
  const out = T.fillTemplate(tpl, s);
  const w = out.warnings.find((x) => x.includes("sem classificação"));
  assert.ok(w && w.startsWith("2 elemento(s)") && w.includes("25 s menor") && w.includes("Conferir, Embalar"), w);
  s.elements.forEach((e) => (e.value = "NA"));
  assert.ok(!T.fillTemplate(await T.loadTemplate(buildR05(), { inflate }), s).warnings.some((x) => x.includes("sem classificação")));
});

test("5 — tolerância fora de 0–99% → TP \"--\" (antes 150% entrava no TP)", () => {
  const s = C.createStudy({ clientName: "QA", processName: "P" });
  s.elements = [C.createElement({ description: "A", videoTime: "0:30" })];
  for (const [tol, tp] of [["10", 33], ["0", 30], ["99", 59.7], ["100", null], ["150", null], ["-5", null], ["", null]]) {
    s.shiftParams.tolerancePct = tol;
    const k = C.computeStudy(s).kpis;
    assert.equal(k.standardTime == null ? null : Math.round(k.standardTime * 60 * 1000) / 1000, tp, `tolerância "${tol}"`);
    if (tp == null) assert.ok(k.issues.includes("Tolerância deve estar entre 0% e 99%"));
  }
});

test("6 — MFV: pausa + refeição iguais ao expediente = erro (antes o dia zerava sem aviso)", () => {
  const d = mfv(1, "min");
  d.schedule[0] = Object.assign(d.schedule[0], { start: "07:00", end: "17:00", breaks: "540", meal: "60" });
  let r = M.computeMfv(d);
  assert.deepEqual(r.days[0].errors, ["Paradas maiores ou iguais ao expediente"]);
  assert.equal(r.days[0].worked, false);
  d.schedule[0].breaks = "539";
  r = M.computeMfv(d);
  assert.deepEqual(r.days[0].errors, []);
  assert.equal(r.days[0].net, 1);
});
