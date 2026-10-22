/**
 * Testes do preenchimento do modelo Excel B+P (js/xlsx-template.js).
 * Usa um modelo SINTÉTICO com a mesma estrutura da REV2 (cabeçalhos na linha 8,
 * textos compartilhados, fórmulas, partes compactadas e "macro"), para não
 * versionar a planilha de cliente.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const C = require("../js/calc.js");
const X = require("../js/xlsx.js");
const T = require("../js/xlsx-template.js");

const inflate = (b) => new Uint8Array(zlib.inflateRawSync(b));
const enc = new TextEncoder();
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sheet = (rows) => `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;

/** Entrada compactada (deflate), como num .xlsm real. */
function deflated(name, text) {
  const data = typeof text === "string" ? enc.encode(text) : text;
  return { name, raw: { method: 8, compressed: new Uint8Array(zlib.deflateRawSync(data)), crc: X.crc32(data), size: data.length } };
}

/** rev21: cabeçalho F8 "Ritmo (%)" da planilha REV2.1 da equipe (peças em D7, tolerância em Análise!L6). */
function buildTemplate(rev21) {
  const sst = ["Nº", "Elemento", "Tempo (Inicio)", "Tempo (Fim)", "Quantidade", "agrega?", "Tipo", "todos elementos", "Tempo (s)", "Qt.", "Valor", "Ação",
    "Agrega", "Não agrega", "Incidental", "Espera", "Transporte", "Processamento Excessivo", "Movimentação ", "Elemento antigo do cliente anterior", "Texto antigo",
    "Ritmo (%)"];
  const s = (i) => `t="s"><v>${i}</v>`;
  const geral =
    (rev21 ? `<row r="7"><c r="D7" s="12"/></row>` : "") +
    `<row r="8" spans="2:19"><c r="B8" s="1" ${s(0)}</c><c r="C8" s="1" ${s(1)}</c><c r="D8" s="1" ${s(2)}</c><c r="E8" s="1" ${s(3)}</c>` +
    (rev21 ? `<c r="F8" s="1" ${s(21)}</c>` : "") +
    `<c r="G8" s="1" ${s(4)}</c><c r="H8" s="1" ${s(5)}</c><c r="I8" s="1" ${s(6)}</c><c r="L8" s="1" ${s(7)}</c></row>` +
    `<row r="10" spans="2:19"><c r="B10" s="2"><v>1</v></c><c r="C10" s="3" ${s(19)}</c><c r="D10" s="4"><v>0</v></c><c r="E10" s="4"><v>0.01</v></c>` +
    `<c r="G10" s="5"><v>3</v></c><c r="H10" s="6" t="str"><f>IF(C10="","",C10)</f><v>Elemento antigo</v></c><c r="I10" s="7" t="s"><v>6</v></c>` +
    `<c r="K10" s="8"><f t="shared" ref="K10:K11" si="0">IF(C10="","",E10-D10)</f><v>0.01</v></c><c r="L10" s="3" ${s(19)}</c><c r="S10" ${s(20)}</c></row>` +
    `<row r="11"><c r="C11" s="3" ${s(19)}</c><c r="K11" s="8"><f t="shared" si="0"/><v>0</v></c></row>`;
  const listagem =
    `<row r="8"><c r="B8" ${s(1)}</c><c r="C8" ${s(8)}</c><c r="D8" ${s(9)}</c><c r="E8" ${s(10)}</c><c r="F8" ${s(11)}</c></row>` +
    `<row r="9"><c r="A9"><v>1</v></c><c r="B9" s="9" ${s(19)}</c><c r="C9" s="10"><v>999</v></c><c r="E9" ${s(12)}</c>` +
    `<c r="F9" t="str"><f>IF(E9=BD!$A$1,"Manter Atividade","x")</f><v>Manter Atividade</v></c></row>`;
  const compil = [15, 16, 17, 18].map((i, k) => `<row r="${39 + k}"><c r="D${39 + k}" ${s(i)}</c><c r="E${39 + k}"><f>COUNTIF(G:G,D${39 + k})</f><v>0</v></c></row>`).join("") +
    `<row r="55"><c r="B55" s="11" ${s(20)}</c></row>`;
  const bd = `<row r="1"><c r="A1" ${s(12)}</c></row><row r="2"><c r="A2" ${s(13)}</c></row><row r="3"><c r="A3" ${s(14)}</c></row>`;
  const analise = (rev21 ? `<row r="6"><c r="L6" s="13"/></row>` : "") + `<row r="15"><c r="F15" ${s(20)}</c></row><row r="16"><c r="C16" ${s(20)}</c></row>`;
  const names = ["GERAL", "Listagem de Elementos", "Compilação e Soluções", "Análise", "BD"];
  const sheets = [geral, listagem, compil, analise, bd];
  const sstXml = `<?xml version="1.0"?><sst ${NS}>${sst.map((t) => `<si><t xml:space="preserve">${X.esc(t)}</t></si>`).join("")}</sst>`;
  const files = [
    deflated("[Content_Types].xml", "<Types/>"),
    deflated("xl/workbook.xml", `<?xml version="1.0"?><workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${X.esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029"/></workbook>`),
    deflated("xl/_rels/workbook.xml.rels", `<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    deflated("xl/sharedStrings.xml", sstXml),
    ...sheets.map((rows, i) => deflated(`xl/worksheets/sheet${i + 1}.xml`, sheet(rows))),
    deflated("xl/vbaProject.bin", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    { name: "xl/media/logo.png", data: new Uint8Array([137, 80, 78, 71]) },
  ];
  return X.zip(files);
}

function study() {
  const s = C.createStudy({ clientName: "Metal Alfa", processName: "Corte" });
  s.elements = [
    { description: "Corte", videoTime: "30", quantity: "2", type: "C", value: "AG" },
    { description: "Transporte", videoTime: "45", type: "A", value: "NA", waste: "transporte" },
    { description: "corte", videoTime: "1:05", quantity: "1", type: "C", value: "AG" },
    { description: "Abastecer", videoTime: "00:20", type: "A", value: "IN", waste: "superproducao", newVideo: true },
    { description: "Sem tempo", videoTime: "" },
  ].map((e) => C.createElement(e));
  s.notes = "Constatação & solução <teste>";
  return s;
}

async function filled() {
  const tpl = await T.loadTemplate(buildTemplate(), { inflate });
  const out = T.fillTemplate(tpl, study());
  const entries = T.readZip(out.bytes);
  const text = async (name) => {
    const e = entries.find((x) => x.name === name);
    return new TextDecoder().decode(e.method === 0 ? e.compressed : inflate(e.compressed));
  };
  return { tpl, out, entries, text };
}

test("modelo: reconhece a REV2 e lê os rótulos da aba BD e do quadro de desperdícios", async () => {
  const tpl = await T.loadTemplate(buildTemplate(), { inflate });
  assert.equal(tpl.kind, "crono-rev2");
  assert.equal(tpl.macro, true);
  assert.deepEqual(tpl.valueLabels, { AG: "Agrega", NA: "Não agrega", IN: "Incidental" });
  assert.equal(tpl.wasteLabels.movimentacao, "Movimentação ", "mantém o espaço do texto original (usado no CONT.SE)");
  assert.equal(tpl.wasteLabels.processamento, "Processamento Excessivo");
});

test("modelo: recusa planilha que não é a REV2", async () => {
  const other = X.buildWorkbook([{ name: "Plan1", rows: [["a"]] }]);
  await assert.rejects(T.loadTemplate(other, { inflate }), /faltam as abas/);
  await assert.rejects(T.loadTemplate(new Uint8Array([1, 2, 3]), { inflate }), /não é um Excel válido/);
});

test("GERAL: preenche elemento, início, fim, quantidade e tipo; nova filmagem começa em 00:00", async () => {
  const { text, out } = await filled();
  const g = await text("xl/worksheets/sheet1.xml");
  assert.equal(out.lines, 4, "linha sem tempo não é exportada");
  assert.match(g, /<c r="C10" s="3" t="inlineStr"><is><t xml:space="preserve">Corte<\/t><\/is><\/c>/, "mantém o estilo da célula");
  assert.match(g, /<c r="E10" s="4"><v>0\.000347222/);
  assert.match(g, /<c r="C12" t="inlineStr"><is><t xml:space="preserve">Corte<\/t>/, "'corte' vira o nome canônico 'Corte'");
  assert.match(g, /<c r="D13"><v>0<\/v><\/c>/, "linha de nova filmagem: início 00:00");
  assert.match(g, /<c r="I11" t="inlineStr"><is><t xml:space="preserve">A<\/t>/);
  assert.match(g, /<c r="L10" s="3" t="inlineStr"><is><t xml:space="preserve">Corte<\/t>/, "lista de elementos únicos");
  assert.match(g, /<c r="S10"\/>/, "observação do modelo anterior apagada");
  assert.ok(!g.includes("Elemento antigo"), "nenhum dado do cliente anterior");
});

test("GERAL: início da filmagem digitado vai para o Tempo (Início) da linha (REV 1.3)", async () => {
  const st = study();
  st.filmStarts = { [st.elements[3].id]: "00:05" };
  const tpl = await T.loadTemplate(buildTemplate(), { inflate });
  const out = T.fillTemplate(tpl, st);
  const e = T.readZip(out.bytes).find((x) => x.name === "xl/worksheets/sheet1.xml");
  const g = new TextDecoder().decode(e.method === 0 ? e.compressed : inflate(e.compressed));
  assert.match(g, /<c r="D13"><v>0\.0000578703/, "F2 começa em 00:05 (5 s ÷ 86.400)");
});

test("vários produtos: o modelo recebe só o produto escolhido, com aviso e nome de arquivo próprio", async () => {
  const st = study();
  st.elements.forEach((e, i) => (e.product = i < 2 ? "Chapa" : "Tubo"));
  const tpl = await T.loadTemplate(buildTemplate(), { inflate });
  let out = T.fillTemplate(tpl, st);
  assert.equal(out.lines, 2, "Chapa: 2 lançamentos");
  assert.ok(out.warnings.some((w) => /2 produtos/.test(w) && /Chapa/.test(w)));
  assert.match(T.exportFileName(st, "modelo.xlsm"), /^Crono_Metal_Alfa_Corte_Chapa_\d{4}-\d{2}-\d{2}\.xlsm$/);
  st.settings.product = C.elementKey("Tubo");
  out = T.fillTemplate(await T.loadTemplate(buildTemplate(), { inflate }), st);
  assert.equal(out.lines, 2, "Tubo: 2 lançamentos (a linha sem tempo não entra)");
});

test("GERAL: fórmulas preservadas, sem valor guardado (o Excel recalcula)", async () => {
  const { text } = await filled();
  const g = await text("xl/worksheets/sheet1.xml");
  assert.match(g, /<c r="H10" s="6"><f>IF\(C10="","",C10\)<\/f><\/c>/);
  assert.match(g, /<c r="K10" s="8"><f t="shared" ref="K10:K11" si="0">IF\(C10="","",E10-D10\)<\/f><\/c>/);
  assert.match(g, /<c r="K11" s="8"><f t="shared" si="0"\/><\/c>/);
  const wb = await text("xl/workbook.xml");
  assert.match(wb, /<calcPr calcId="191029" fullCalcOnLoad="1"\/>/);
});

test("Listagem: valores do resumo do app, rótulos exatos e fórmula da ação intacta", async () => {
  const { text, out } = await filled();
  const l = await text("xl/worksheets/sheet2.xml");
  assert.equal(out.elements, 3);
  assert.match(l, /<c r="B9" s="9" t="inlineStr"><is><t xml:space="preserve">Corte<\/t>/);
  assert.match(l, /<c r="C9" s="10"><v>16\.667<\/v><\/c>/, "Corte (C): (30 + 20) s ÷ (2 + 1) un = 16,667 s");
  assert.ok(!/<row r="12">/.test(l), "não cria linhas vazias que não existiam no modelo");
  assert.match(l, /<c r="E10" t="inlineStr"><is><t xml:space="preserve">Não agrega<\/t>/);
  assert.match(l, /<c r="G10" t="inlineStr"><is><t xml:space="preserve">Transporte<\/t>/);
  assert.match(l, /<c r="F9" t="str">|<c r="F9"><f>/);
  assert.ok(out.warnings.some((w) => /Superprodução/.test(w)), "avisa desperdício sem linha no quadro da planilha");
});

test("Compilação e Análise: constatações (escapadas) e identificação do estudo", async () => {
  const { text } = await filled();
  const c = await text("xl/worksheets/sheet3.xml");
  assert.match(c, /<c r="B55" s="11" t="inlineStr"><is><t xml:space="preserve">Constatação &amp; solução &lt;teste&gt;<\/t>/);
  const a = await text("xl/worksheets/sheet4.xml");
  assert.match(a, /Metal Alfa — Corte \(2 filmagem\(ns\)/);
  assert.match(a, /<c r="F15"\/>/);
});

test("partes não alteradas são copiadas byte a byte (macros, imagens, textos compartilhados)", async () => {
  const original = T.readZip(buildTemplate());
  const { entries } = await filled();
  for (const name of ["xl/vbaProject.bin", "xl/media/logo.png", "xl/sharedStrings.xml", "xl/worksheets/sheet5.xml"]) {
    const a = original.find((e) => e.name === name);
    const b = entries.find((e) => e.name === name);
    assert.equal(b.method, a.method, name);
    assert.deepEqual(Buffer.from(b.compressed), Buffer.from(a.compressed), name);
    assert.equal(b.crc, a.crc, name);
  }
  assert.equal(entries.length, original.length);
});

test("limites do modelo: mais lançamentos que linhas disponíveis é recusado", async () => {
  const tpl = await T.loadTemplate(buildTemplate(), { inflate });
  const s = C.createStudy({ clientName: "A", processName: "B" });
  s.elements = Array.from({ length: 292 }, (_, i) => C.createElement({ description: `E${i % 3}`, videoTime: C.formatVideoTime((i + 1) / 60) }));
  assert.throws(() => T.fillTemplate(tpl, s), /comporta 291/);
});

test("nome do arquivo exportado: Crono_<Cliente>_<Posto>_<data>.xlsm", () => {
  const name = T.exportFileName({ clientName: "Indústria Alfa", processName: "Posto 01" }, "modelo.xlsm");
  assert.match(name, /^Crono_Industria_Alfa_Posto_01_\d{4}-\d\d-\d\d\.xlsm$/);
  assert.match(T.exportFileName({ clientName: "A", processName: "B" }, "m.xlsx"), /\.xlsx$/);
});

/* ==========================================================================
   MODELO DO MFV SIMPLIFICADO (ABAS EP / EF)
   ========================================================================== */

const M = require("../js/mfv-calc.js");

function buildMfvTemplate() {
  const sst = ["HORÁRIO DE TRABALHO - ESTADO PRESENTE", "Dias da Semana", "Etapa", "TC", "NÚM. OPs", "Estoques", "Hiper Aço", "Sucata antiga"];
  const s = (i) => `t="s"><v>${i}</v>`;
  const ep =
    `<row r="5"><c r="D5" s="1" ${s(6)}</c></row>` +
    `<row r="20"><c r="B20" ${s(0)}</c></row><row r="21"><c r="B21" ${s(1)}</c><c r="O21" s="2"><f>1240/6*26</f><v>5373</v></c></row>` +
    `<row r="22"><c r="C22" s="3"><v>0.3</v></c><c r="D22" s="3"><v>0.7</v></c><c r="G22" s="3"><f>D22-C22</f><v>0.4</v></c><c r="H22" s="3"><f>G22-F22-E22</f><v>0.4</v></c></row>` +
    `<row r="27"><c r="C27" s="3"/><c r="D27" s="3"/></row>` +
    `<row r="38"><c r="C38" ${s(2)}</c><c r="E38" ${s(3)}</c><c r="F38" ${s(4)}</c></row>` +
    `<row r="39"><c r="C39" s="4" ${s(7)}</c><c r="E39" s="5"><v>0.09</v></c></row>` +
    `<row r="46"><c r="E46" s="5"><f>SUM(E39:E45)</f><v>0.09</v></c></row>` +
    `<row r="54"><c r="B54" ${s(5)}</c></row><row r="56"><c r="D56" s="6"><f>1*O22</f><v>206</v></c></row>`;
  const names = ["EP", "EF"];
  const files = [
    deflated("xl/workbook.xml", `<?xml version="1.0"?><workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" calcCompleted="0"/></workbook>`),
    deflated("xl/_rels/workbook.xml.rels", `<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    deflated("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS}>${sst.map((t) => `<si><t>${X.esc(t)}</t></si>`).join("")}</sst>`),
    deflated("xl/worksheets/sheet1.xml", sheet(ep)),
    deflated("xl/worksheets/sheet2.xml", sheet(ep)),
    deflated("xl/media/fluxograma.png", new Uint8Array([9, 9, 9])),
  ];
  return X.zip(files);
}

function mfvDoc() {
  const d = M.createMfv({ clientName: "Laje Forte", family: "Lajes" });
  d.productUnit = "m²";
  d.timeUnit = "h";
  d.demandMonthly = "5373,33";
  d.workDaysMonth = "26";
  d.operatorsTotal = "2";
  d.schedule[5] = { day: "SÁB", start: "07:30", end: "11:30", breaks: "", meal: "" };
  d.steps = [
    M.createStep({ name: "Corte", tcManualMin: 0.6, operators: "2", uptimePct: "50" }),
    M.createStep({ name: "Concretagem", tcManualMin: 1.2, operators: "2", kaizen: true }),
  ];
  d.inventories = [M.createInventory({ name: "Cura", quantity: "1446,67" })];
  d.notes = "Premissa 1\nPremissa 2";
  return d;
}

async function mfvFilled() {
  const out = await T.fillFromBytes(buildMfvTemplate(), mfvDoc(), { inflate, expect: "mfv" });
  const entries = T.readZip(out.bytes);
  const text = (name) => {
    const e = entries.find((x) => x.name === name);
    return new TextDecoder().decode(e.method === 0 ? e.compressed : inflate(e.compressed));
  };
  return { out, entries, text };
}

test("MFV: modelo reconhecido e não confundido com o da cronoanálise", async () => {
  const tpl = await T.loadTemplate(buildMfvTemplate(), { inflate });
  assert.equal(tpl.kind, "mfv-rev1");
  await assert.rejects(T.loadTemplate(buildMfvTemplate(), { inflate, expect: "crono" }), /modelo do MFV/);
  await assert.rejects(T.loadTemplate(buildTemplate(), { inflate, expect: "mfv" }), /não é o modelo do MFV/);
});

test("MFV/EP: dados gerais, demanda sobre fórmula do consultor e TCs em HORAS", async () => {
  const { text } = await mfvFilled();
  const ep = text("xl/worksheets/sheet1.xml");
  assert.match(ep, /<c r="D5" s="1" t="inlineStr"><is><t xml:space="preserve">Laje Forte<\/t>/);
  assert.match(ep, /<c r="O21" s="2"><v>5373\.33<\/v><\/c>/, "demanda digitada substitui a conta '=1240/6*26'");
  assert.match(ep, /<c r="E39" s="5"><v>0\.01<\/v><\/c>/, "TC 0,6 min = 0,01 h");
  assert.match(ep, /<c r="G39"[^>]*><v>0\.5<\/v><\/c>/, "uptime 50% = 0,5");
  assert.match(ep, /<c r="B40"[^>]*><is><t xml:space="preserve">X<\/t>/, "processo Kaizen marcado");
  assert.match(ep, /<c r="C39" s="4" t="inlineStr"><is><t xml:space="preserve">Corte<\/t>/);
  assert.match(ep, /<c r="E46" s="5"\/>/, "linha extra do modelo (antiga soma) limpa");
  assert.match(ep, /<c r="K37"[^>]*><v>2<\/v>/, "total de operadores digitado");
  assert.match(ep, /<c r="D35"[^>]*><is><t xml:space="preserve">HORAS \/ peça<\/t>/);
  assert.match(ep, /<c r="D56" s="6"\/>/, "estoque antigo (fórmula) limpo");
  assert.match(ep, /<c r="D55"[^>]*><v>1446\.67<\/v>/);
  assert.match(ep, /Premissa 2/);
  assert.ok(!ep.includes("Sucata antiga") || !/C39[^<]*Sucata/.test(ep));
});

test("MFV/EP: horas do dia só onde o modelo não tem fórmula", async () => {
  const { text } = await mfvFilled();
  const ep = text("xl/worksheets/sheet1.xml");
  assert.match(ep, /<c r="H22" s="3"><f>G22-F22-E22<\/f><\/c>/, "fórmula preservada (sem valor guardado)");
  assert.match(ep, /<c r="H27"><v>0\.16666666/, "sábado sem fórmula: 4 h preenchidas");
  assert.match(ep, /<c r="C27" s="3"><v>0\.3125<\/v>/, "07:30");
});

test("MFV/EF: dados gerais copiados, etapas em branco; arquivo marcado para recalcular", async () => {
  const { text, out } = await mfvFilled();
  const ef = text("xl/worksheets/sheet2.xml");
  assert.match(ef, /Laje Forte/);
  assert.ok(!ef.includes("Hiper Aço"), "sem dados do cliente anterior");
  assert.match(ef, /<c r="C39" s="4"\/>/);
  assert.match(ef, /<c r="E39" s="5"\/>/);
  assert.match(text("xl/workbook.xml"), /<calcPr calcId="191029" fullCalcOnLoad="1"\/>/);
  assert.ok(out.warnings.some((w) => /fluxograma/i.test(w)));
});

test("MFV: limite de 13 etapas da planilha", async () => {
  const d = mfvDoc();
  d.steps = Array.from({ length: 14 }, (_, i) => M.createStep({ name: `E${i}`, tcManualMin: 1 }));
  await assert.rejects(T.fillFromBytes(buildMfvTemplate(), d, { inflate }), /comporta 13/);
});

/* ==========================================================================
   PLANILHA REV2.1 DA EQUIPE: ritmo (F), peças (D7) e tolerância (Análise!L6)
   ========================================================================== */

async function sheetText(out, name) {
  const e = T.readZip(out.bytes).find((x) => x.name === name);
  return new TextDecoder().decode(e.method === 0 ? e.compressed : inflate(e.compressed));
}

test("REV2.1: reconhecida pelo cabeçalho 'Ritmo (%)'; a REV2.0 continua aceita", async () => {
  assert.equal((await T.loadTemplate(buildTemplate(true), { inflate })).rev, "2.1");
  assert.equal((await T.loadTemplate(buildTemplate(), { inflate })).rev, "2.0");
});

test("REV2.1: ritmo por linha, peças das filmagens em D7 e tolerância em L6; sem avisos da REV2.0", async () => {
  const st = study();
  st.elements[0].pace = "110";
  st.shiftParams.tolerancePct = 12;
  // peças em todas as filmagens → acíclicos por unidade
  C.computeStudy(st).filmList.forEach((f, i) => (st.filmPieces[f.key] = String(5 + i)));
  const out = T.fillTemplate(await T.loadTemplate(buildTemplate(true), { inflate }), st);
  const g = await sheetText(out, "xl/worksheets/sheet1.xml");
  assert.match(g, /<c r="F10"><v>110<\/v><\/c>/, "ritmo 110% na 1ª linha");
  assert.ok(!/<c r="F11"[^>]*><v>/.test(g), "ritmo 100% fica vazio (padrão da planilha)");
  assert.match(g, /<c r="D7" s="12"><v>11<\/v><\/c>/, "D7 = 5 + 6 peças das 2 filmagens");
  const a = await sheetText(out, "xl/worksheets/sheet4.xml");
  assert.match(a, /<c r="L6" s="13"><v>12<\/v><\/c>/, "tolerância 12%");
  assert.ok(!out.warnings.some((w) => /Análise|ritmo/.test(w)), "sem os avisos de limitação da REV2.0");
});

test("REV2.0: avisa que o ritmo não é levado (a planilha não tem a coluna)", async () => {
  const st = study();
  st.elements[0].pace = "90";
  const out = T.fillTemplate(await T.loadTemplate(buildTemplate(), { inflate }), st);
  assert.ok(out.warnings.some((w) => /não tem coluna de ritmo/.test(w)));
});

test("REV 1.14 (A3/T12): modelo REV2.0 com acíclicos por peça avisa; um arquivo por operador", async () => {
  const st = study();
  st.elements.forEach((e) => (e.operador = 1));
  st.elements.push(C.createElement({ description: "Setup", type: "A", videoTime: "9:00", operador: 2 }));
  st.settings.numOperadores = 2;
  st.filmPieces = { inicio: "10" };
  const tpl = await T.loadTemplate(buildTemplate(), { inflate });
  const one = T.fillTemplate(tpl, C.operatorStudy(st, 2));
  assert.ok(one.warnings.some((w) => /modelo REV2.0 soma os acíclicos sem dividir pelas peças; use o modelo REV2.1/.test(w)), one.warnings.join(" | "));
  assert.match(T.exportFileName(st, "m.xlsm", 2), /_Op2_\d{4}-\d{2}-\d{2}\.xlsm$/);
});
