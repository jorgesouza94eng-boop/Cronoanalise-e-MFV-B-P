/**
 * Testes da compilação (aba "Compilação e Soluções") e da exportação Excel no layout B+P.
 * Executar: npm test
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const X = require("../js/xlsx.js");

function studyQty(rows, extra) {
  const s = C.createStudy({ clientName: "Cliente & Cia <teste>", processName: "Posto 01" });
  s.elements = rows.map((e) => C.createElement(e));
  return Object.assign(s, extra || {});
}

const ROWS = [
  { description: "Corte", videoTime: "30", quantity: "2", value: "AG" },
  { description: "Procurar peças", videoTime: "50", type: "A", value: "NA", waste: "movimentacao" },
  { description: "Transporte", videoTime: "1:30", type: "A", value: "NA", waste: "transporte" },
  { description: "Anotar OP", videoTime: "1:40", type: "A", value: "IN", waste: "processamento" },
  { description: "Corte", videoTime: "2:10", quantity: "2", value: "AG" },
];

test("compilação: contagem e tempo por valor agregado (soma = 100%)", () => {
  const c = C.computeStudy(studyQty(ROWS)).compilation;
  const by = Object.fromEntries(c.byValue.map((v) => [v.key, v]));
  assert.equal(c.elementCount, 4);
  assert.equal(by.AG.count, 1);
  assert.equal(by.NA.count, 2);
  assert.equal(by.IN.count, 1);
  assert.ok(Math.abs(by.AG.time * 60 - 15) < 1e-9, "Corte: (30 + 30) s ÷ 4 un = 15 s");
  assert.ok(Math.abs(by.NA.time * 60 - 60) < 1e-9, "20 + 40 s");
  assert.ok(Math.abs(c.byValue.reduce((a, v) => a + v.pct, 0) - 100) < 1e-9);
  assert.equal(c.byValue.some((v) => v.key === ""), false, "sem a categoria 'Sem classificação' quando tudo está classificado");
});

test("compilação: desperdícios em ordem de Pareto e 'Sem classificação' quando falta valor", () => {
  const c = C.computeStudy(studyQty(ROWS.concat([{ description: "Limpeza", videoTime: "3:00", type: "A" }]))).compilation;
  assert.deepEqual(c.byWaste.map((w) => w.key), ["transporte", "movimentacao", "processamento"]);
  const none = c.byValue.find((v) => v.key === "");
  assert.equal(none.count, 1);
  assert.equal(none.label, "Sem classificação");
});

test("constatações e soluções são gravadas no JSON", () => {
  const r = C.normalizeStudy(JSON.parse(C.serializeStudy(studyQty(ROWS, { notes: "Layout em U" }))));
  assert.equal(r.study.notes, "Layout em U");
});

test("zip: CRC-32 de referência", () => {
  assert.equal(X.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zip: estrutura com assinaturas local, central e final", () => {
  const z = X.zip([{ name: "a.txt", data: new TextEncoder().encode("olá") }]);
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(z.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(z.length - 12, true), 1, "1 arquivo no diretório central");
});

test("colunas do Excel: A, Z, AA, AZ", () => {
  assert.deepEqual([0, 25, 26, 51].map(X.colName), ["A", "Z", "AA", "AZ"]);
});

test("Excel B+P: 4 abas no layout da planilha, tempos em segundos", () => {
  const sheets = X.buildBPSheets(studyQty(ROWS, { notes: "Constatação 1\nSolução 1" }));
  assert.deepEqual(sheets.map((s) => s.name), ["GERAL", "Listagem de Elementos", "Compilação e Soluções", "Análise"]);
  const listagem = sheets[1].rows;
  const header = listagem.find((r) => r && r[0] && r[0].v === "Nº");
  assert.deepEqual(header.slice(0, 6).map((c) => c.v), ["Nº", "Elemento", "Tempo (s)", "Qt.", "Valor", "Ação"]);
  const corte = listagem.find((r) => r && r[1] && r[1].v === "Corte");
  assert.equal(corte[2].v, 15, "Tempo (s) = 15");
  assert.equal(corte[3].v, 2, "Qt. média = 2");
  assert.equal(corte[5].v, "Manter atividade");
  const total = listagem.find((r) => r && r[0] && r[0].v === "Tempo normal do ciclo (s)");
  assert.equal(total[2].v, 15 + 20 + 40 + 10);
  const notes = sheets[2].rows.find((r) => r && r[0] && r[0].s === "notes");
  assert.equal(notes[0].v, "Constatação 1\nSolução 1");
});

test("Excel B+P: arquivo .xlsx gerado com partes obrigatórias e texto escapado", () => {
  const bytes = X.buildBPWorkbook(studyQty(ROWS));
  const text = new TextDecoder().decode(bytes);
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet4.xml"]) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(text.includes("Cliente &amp; Cia &lt;teste&gt;"), "caracteres especiais escapados");
  assert.ok(!text.includes("Cliente & Cia <teste>"), "sem XML quebrado");
});
