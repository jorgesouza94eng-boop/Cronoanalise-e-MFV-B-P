/**
 * REV 1.19: Plano de Ação 5W2H (js/plano-calc.js) e preenchimento do modelo 5W2H.
 * Dados fictícios e modelo SINTÉTICO (mesmos cabeçalhos da linha 6 do modelo B+P).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const C = require("../js/calc.js");
const X = require("../js/xlsx.js");
const T = require("../js/xlsx-template.js");
const P = require("../js/plano-calc.js");

const inflate = (b) => new Uint8Array(zlib.inflateRawSync(b));
const HOJE = "2026-06-15";

function plan(actions) {
  const d = P.createPlan({ clientName: "Empresa Teste" });
  d.createdDate = "2026-06-01";
  d.actions = actions.map((a) => P.createAction(a));
  return d;
}

test("P1: status calculado pelo % e pelas datas", () => {
  const st = (a) => P.actionStatus(a, HOJE);
  assert.equal(st({ pct: "100", end: "2026-06-01" }), "concluida", "100% vence o prazo vencido");
  assert.equal(st({ pct: "50", end: "2026-06-14" }), "atrasada");
  assert.equal(st({ pct: "10", end: "2026-06-30" }), "andamento");
  assert.equal(st({ start: "2026-06-15", end: "2026-06-30" }), "andamento", "início hoje");
  assert.equal(st({ start: "2026-06-20" }), "nao-iniciada");
  assert.equal(st({}), "nao-iniciada");
});

test("P2: resumo — contagem, % médio, Σ Quanto (só referência), próximo prazo e avisos", () => {
  const d = plan([
    { what: "Aplicar 5S na bancada", pct: "100", cost: "150,50", end: "2026-06-10" },
    { what: "SMED na prensa", pct: "40", cost: "1.000,00", start: "2026-06-01", end: "2026-06-30" },
    { what: "Kanban de embalagem", end: "2026-06-20" },
    { what: "", pct: "120", cost: "-5", start: "2026-06-10", end: "2026-06-05" },
  ]);
  const r = P.computePlan(d, HOJE);
  assert.equal(r.total, 4);
  assert.deepEqual(r.count, { "nao-iniciada": 1, andamento: 1, concluida: 1, atrasada: 1 });
  assert.equal(r.pctMean, (100 + 40 + 0 + 0) / 4, "% inválido conta como 0");
  assert.equal(r.costTotal, 1150.5, "Quanto negativo fica fora");
  assert.equal(r.costInformed, true);
  assert.deepEqual([r.next.seq, r.next.end], [3, "2026-06-20"]);
  assert.deepEqual(r.actions[3].issues, ["% completo deve estar entre 0 e 100", "Quanto deve ser um valor em R$ (0 ou mais)", "Fim antes do início", "Informe O que"]);
  const vazio = P.computePlan(plan([]), HOJE);
  assert.equal(vazio.pctMean, null);
  assert.equal(vazio.costInformed, false);
});

test("P3: prefixo ECRS da ação Kaizen", () => {
  assert.deepEqual(P.parseEcrs("Reorganizar: Aplicar 5S no posto"), { ecrs: "reorganizar", text: "Aplicar 5S no posto" });
  assert.deepEqual(P.parseEcrs("ELIMINAR – busca de ferramenta"), { ecrs: "eliminar", text: "busca de ferramenta" });
  assert.deepEqual(P.parseEcrs("Trocar a bandeja de lugar"), { ecrs: "", text: "Trocar a bandeja de lugar" });
});

function estudo() {
  const s = C.createStudy({ clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Abrir a massa", "C", 10, "40", "Simplificar: usar gabarito"],
    ["Buscar bandeja", "A", 1, "100", "Eliminar: bandejas no posto"],
    ["Enrolar", "C", 10, "220", ""],
    ["Buscar bandeja", "A", 1, "240", "Eliminar: bandejas no posto"], // mesma ação, mesmo elemento = 1 só
  ].map(([description, type, quantity, videoTime, kaizen]) => C.createElement({ description, type, quantity: String(quantity), videoTime, kaizen, waste: type === "A" ? "movimentacao" : "" }));
  s.filmPieces = { inicio: "10" };
  return s;
}

test("P4: ações Kaizen do estudo → ações do plano (Pareto pelo % do ciclo)", () => {
  const s = estudo();
  const cands = P.studyCandidates(s);
  assert.equal(cands.length, 2);
  const buscar = cands.find((c) => c.origin.element === "Buscar bandeja");
  // Σ das 2 passadas (20 + 20 s) ÷ 10 peças = 4 s/pç de 16 s/pç (4 + 4 + 8)
  assert.equal(Number((buscar.cycleTime * 60).toFixed(6)), 4, "tempo no ciclo em minutos (4 s)");
  assert.equal(Number(buscar.sharePct.toFixed(6)), 25);
  const a = P.actionFromCandidate(buscar, 1);
  assert.equal(a.what, "Eliminar — Buscar bandeja");
  assert.equal(a.how, "bandejas no posto");
  assert.equal(a.ecrs, "eliminar");
  assert.equal(a.waste, "movimentacao");
  assert.equal(a.where, "Bancada");
  assert.match(a.why, /^Movimentação: 4(,0)? s\/pç \(25(,0)?% do ciclo\)$/);
  assert.deepEqual([a.who, a.start, a.end, a.cost, a.pct], ["", "", "", "", ""], "Quem, Quando, Quanto e % ficam para o consultor");
  assert.equal(a.priority, 1);

  const map = new Map([[s.id, cands]]);
  assert.equal(P.originStatus(a, map), "ok");
  s.elements[1].kaizen = s.elements[3].kaizen = "Eliminar: carrinho com bandejas";
  assert.equal(P.originStatus(a, new Map([[s.id, P.studyCandidates(s)]])), "alterada");
  assert.equal(P.originStatus(a, new Map()), "sem-estudo");
  assert.equal(P.originStatus(P.createAction({ what: "manual" }), map), "");
});

test("P5: JSON v1 — ida e volta; esquema errado é recusado", () => {
  const d = plan([{ what: "Aplicar 5S", who: "Supervisor", end: "2026-07-01", pct: "30", tool: "5s" }]);
  const back = P.normalizePlan(JSON.parse(P.serializePlan(d)));
  assert.equal(back.ok, true);
  assert.equal(back.doc.actions[0].who, "Supervisor");
  assert.equal(back.doc.actions[0].tool, "5s");
  assert.match(d.fileName, /^Plano_Empresa_Teste_\d{4}-\d{2}-\d{2}_[\w-]{8}\.json$/);
  assert.ok(P.FILE_PATTERN.test(d.fileName));
  assert.equal(P.normalizePlan({ schema: "lean-chrono-mfv" }).ok, false);
});

test("P6: Excel simples (sem modelo) com todas as colunas", () => {
  const d = plan([{ what: "Aplicar 5S", end: "2026-07-01", pct: "30" }]);
  const bytes = X.buildWorkbook(P.buildPlanSheets(d, HOJE));
  assert.ok(bytes.length > 1000);
  assert.equal(P.formatDate("2026-07-01"), "01/07/2026");
  assert.equal(P.excelDate("2026-07-01"), 46204);
});

/* ==========================================================================
   MODELO 5W2H SINTÉTICO
   ========================================================================== */

function deflated(name, text) {
  const data = typeof text === "string" ? new TextEncoder().encode(text) : text;
  return { name, raw: { method: 8, compressed: new Uint8Array(zlib.deflateRawSync(data)), crc: X.crc32(data), size: data.length } };
}

function buildPlanoTemplate() {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const sst = ["O QUE", "COMO", "QUEM", "QUANDO", "ONDE", "POR QUE", "QUANTO", "% COMPLETO", "Ação antiga"];
  const s = (i) => `t="s"><v>${i}</v>`;
  const rows =
    `<row r="3"><c r="B3" s="1"/><c r="D3" s="1"/><c r="G3" s="1"/><c r="J3" s="2"/></row>` +
    `<row r="6"><c r="A6" ${s(0)}</c><c r="B6" ${s(1)}</c><c r="C6" ${s(2)}</c><c r="D6" ${s(3)}</c><c r="F6" ${s(4)}</c><c r="G6" ${s(5)}</c><c r="H6" ${s(6)}</c><c r="I6" ${s(7)}</c></row>` +
    `<row r="8"><c r="A8" s="3" ${s(8)}</c><c r="D8" s="4"><v>45000</v></c><c r="I8" s="5"><v>0.5</v></c></row>`;
  return X.zip([
    deflated("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="x"/></Types>'),
    deflated("xl/workbook.xml", `<?xml version="1.0"?><workbook ${NS}><sheets><sheet name="5W2H" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    deflated("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'),
    deflated("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS}>${sst.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`),
    deflated("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`),
  ]);
}

function text(bytes, name) {
  const e = T.readZip(bytes).find((x) => x.name === name);
  return e ? new TextDecoder().decode(e.method === 0 ? e.compressed : inflate(e.compressed)) : null;
}

test("P7: modelo 5W2H reconhecido e não confundido com os da cronoanálise e do MFV", async () => {
  assert.equal((await T.loadTemplate(buildPlanoTemplate(), { inflate })).kind, "plano-5w2h");
  await assert.rejects(T.loadTemplate(buildPlanoTemplate(), { inflate, expect: "crono" }));
  await assert.rejects(T.loadTemplate(buildPlanoTemplate(), { inflate, expect: "mfv" }));
});

test("P8: preenche a aba 5W2H (17 ações por arquivo) e acrescenta a aba do app", async () => {
  const acts = Array.from({ length: 19 }, (_, i) => ({ what: `Ação ${i + 1}`, who: i ? "Líder" : "", start: "2026-06-01", end: "2026-07-01", pct: "50", cost: "100" }));
  const d = plan(acts);
  const p0 = await T.fillFromBytes(buildPlanoTemplate(), d, { inflate, expect: "plano", part: 0 });
  assert.equal(p0.parts, 2);
  const s0 = text(p0.bytes, "xl/worksheets/sheet1.xml");
  assert.match(s0, /<c r="A8" s="3" t="inlineStr"><is><t xml:space="preserve">Ação 1<\/t>/, "ação antiga substituída, estilo mantido");
  assert.match(s0, /<c r="D8" s="4"><v>46174<\/v>/, "início como data do Excel");
  assert.match(s0, /<c r="I8" s="5"><v>0\.5<\/v>/, "% completo 50 = 0,5");
  assert.match(s0, /Ação 17/);
  assert.ok(!/Ação 18/.test(s0));
  assert.ok(p0.warnings.some((w) => /comporta 17/.test(w)));
  assert.ok(p0.warnings.some((w) => /sem Quem/.test(w)));
  assert.match(text(p0.bytes, "xl/workbook.xml"), /Plano \(app\)/);
  const p1 = await T.fillFromBytes(buildPlanoTemplate(), d, { inflate, expect: "plano", part: 1 });
  const s1 = text(p1.bytes, "xl/worksheets/sheet1.xml");
  assert.match(s1, /Ação 18/);
  assert.match(s1, /Ação 19/);
  assert.match(T.exportPlanoFileName(d, "modelo.xlsx", 1, 2), /^5W2H_Empresa_Teste_\d{4}-\d{2}-\d{2}_parte2\.xlsx$/);
});

test("P9 (REV 1.20): ferramenta sugerida pela IA (kaizenTool) vai para a ação do plano; chave inválida é descartada", () => {
  const s = estudo();
  s.elements[3].kaizenTool = "5s"; // 2ª linha do mesmo elemento: vale para a ação
  const back = C.normalizeStudy(JSON.parse(C.serializeStudy(s))).study;
  assert.equal(back.elements[3].kaizenTool, "5s");
  assert.equal(C.normalizeStudy(Object.assign(JSON.parse(C.serializeStudy(s)), {})).study.elements[0].kaizenTool, "");
  const c = P.studyCandidates(back).find((x) => x.origin.element === "Buscar bandeja");
  assert.equal(P.actionFromCandidate(c, 1).tool, "5s");
  const bad = JSON.parse(C.serializeStudy(s));
  bad.elements[3].kaizenTool = "robo";
  assert.equal(C.normalizeStudy(bad).study.elements[3].kaizenTool, "");
});
