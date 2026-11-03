/**
 * Testes da REV 1.28: modelo de cronoanálise EO_Cronoanálise v00_r05 (js/xlsx-template.js).
 * Usa um modelo SINTÉTICO com a mesma estrutura do r05 (abas UNIDADES, GERAL, Listagem de
 * Elementos e Compilação e Soluções; cabeçalhos, fórmulas e "macro"), sem dados de cliente.
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
const dec = new TextDecoder();
const { buildR05 } = require("./r05-template.js");

/** Lê as abas do arquivo gerado (entradas gravadas sem compressão ou copiadas). */
function readOut(bytes) {
  const entries = T.readZip(bytes);
  const get = (name) => {
    const e = entries.find((x) => x.name === name);
    return dec.decode(e.method === 0 ? e.compressed : inflate(e.compressed));
  };
  return { entries, get };
}

/** Valor da célula: número, texto embutido ou "" (vazia). */
function cell(xml, ref) {
  const m = xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`));
  if (!m || !m[1]) return "";
  const t = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/);
  if (t) return t[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const v = m[1].match(/<v>([\s\S]*?)<\/v>/);
  return v ? Number(v[1]) : "";
}

function study() {
  const s = C.createStudy({ clientName: "Metal Alfa", processName: "Corte" });
  s.elements = [
    { description: "Corte", videoTime: "30", quantity: "2", type: "C", value: "AG", kaizen: "Simplificar: usar gabarito" },
    { description: "Transporte", videoTime: "45", type: "A", value: "NA", waste: "transporte" },
    { description: "corte", videoTime: "1:05", quantity: "1", type: "C", value: "AG" },
    { description: "Abastecer", videoTime: "00:20", type: "A", value: "IN", waste: "superproducao", newVideo: true },
    { description: "Corte", videoTime: "00:50", quantity: "3", type: "C", value: "AG" },
  ].map((e) => C.createElement(e));
  s.filmPieces = { inicio: "5" };
  s.filmPieces[s.elements[3].id] = "3";
  s.notes = "Constatação & solução <teste>";
  return s;
}

const fill = async (s, opts, baseUnit) => {
  const tpl = await T.loadTemplate(buildR05(baseUnit), { inflate });
  const out = T.fillTemplate(tpl, s, opts);
  const o = readOut(out.bytes);
  return { tpl, out, U: o.get("xl/worksheets/sheet1.xml"), G: o.get("xl/worksheets/sheet2.xml"), L: o.get("xl/worksheets/sheet3.xml"), K: o.get("xl/worksheets/sheet4.xml"), o };
};

test("r05: reconhecido pelos cabeçalhos (abas UNIDADES/GERAL/Listagem/Compilação)", async () => {
  const tpl = await T.loadTemplate(buildR05(), { inflate });
  assert.equal(tpl.kind, "crono-r05");
  assert.equal(tpl.rev, "r05");
  assert.equal(tpl.baseUnit, "Peça");
  assert.equal(tpl.lotUnit, "Lote");
  assert.equal(tpl.macro, true);
  assert.deepEqual(tpl.valueLabels, { AG: "Agrega", NA: "Não agrega", IN: "Incidental" });
});

test("r05: GERAL com elemento, tempos, Qtd, Unidade (Peça/Lote), Tipo e lista sem repetição", async () => {
  const { G, out } = await fill(study());
  assert.equal(out.lines, 5);
  assert.equal(out.elements, 3);
  assert.equal(cell(G, "A9"), 1, "Nº do modelo mantido");
  assert.equal(cell(G, "B9"), "Corte");
  assert.equal(cell(G, "B11"), "Corte", "mesmo nome do resumo (corte → Corte)");
  assert.ok(Math.abs(cell(G, "D9") - 30 / 86400) < 1e-12 && cell(G, "C9") === 0, "tempos em fração de dia");
  assert.equal(cell(G, "E9"), 2);
  assert.equal(cell(G, "F9"), "Peça");
  assert.equal(cell(G, "G9"), "C");
  assert.equal(cell(G, "E10"), 1, "acíclico = 1 Lote");
  assert.equal(cell(G, "F10"), "Lote");
  assert.equal(cell(G, "G10"), "A");
  assert.deepEqual(["L9", "L10", "L11", "L12"].map((r) => cell(G, r)), ["Corte", "Transporte", "Abastecer", ""]);
  assert.match(G, /<c r="H9"><f>IF\(ISBLANK\(F9\)/, "fórmula da Qtd. na Base preservada");
  assert.match(G, /<c r="K9"><f>[^<]+<\/f><\/c>/, "valor guardado da fórmula removido (o Excel recalcula)");
});

test("r05 D1: Tamanho do lote = peças das filmagens → Listagem = TP observado do app", async () => {
  const s = study();
  const { U, L } = await fill(s);
  assert.equal(cell(U, "B8"), 8, "5 + 3 peças");
  const r = C.computeStudy(s);
  const app = r.summary.elements.map((g) => Math.round(g.cycleTime * 60 * 1000) / 1000);
  assert.deepEqual(["C9", "C10", "C11"].map((x) => cell(L, x)), app, "Corte 13,333 | Transporte 1,875 | Abastecer 2,5");
  assert.deepEqual(app, [13.333, 1.875, 2.5]);
  assert.deepEqual(["D9", "D10", "D11"].map((x) => cell(L, x)), [2, 8, 8], "Qtd. média na unidade base");
});

test("r05 D1: sem as peças de todas as filmagens → lote 1 (tempo total) e aviso", async () => {
  const s = study();
  s.filmPieces = { inicio: "5" };
  const { U, L, out } = await fill(s);
  assert.equal(cell(U, "B8"), 1);
  assert.equal(cell(L, "C10"), 15, "Transporte = tempo total observado");
  assert.ok(out.warnings.some((w) => w.includes("Tamanho do lote = 1")));
});

test("r05: Listagem com valor, ação; % incidência em branco; exemplo do modelo apagado", async () => {
  const { L } = await fill(study());
  assert.deepEqual(["E9", "E10", "E11"].map((x) => cell(L, x)), ["Agrega", "Não agrega", "Incidental"]);
  assert.equal(cell(L, "F9"), "Simplificar: usar gabarito");
  assert.equal(cell(L, "F10"), "");
  assert.equal(cell(L, "I9"), "", "D4: % de incidência fica para o consultor");
  assert.equal(cell(L, "A9"), 1);
  assert.match(L, /<c r="J9"><f>IFERROR\(C9\*\(1-I9\),""\)<\/f><\/c>/, "fórmula do tempo futuro preservada");
});

test("r05 D3: Responsável e Data de conclusão vêm do Plano 5W2H do cliente", async () => {
  const s = study();
  const planActions = [
    { who: "João", end: "2026-12-10", origin: { studyId: s.id, element: "corte", etapa: "", product: "" } },
    { who: "Ana", end: "2026-11-30", origin: { studyId: s.id, element: "Corte", etapa: "", product: "" } },
    { who: "Outro", end: "2026-12-01", origin: { studyId: "outro-estudo", element: "Transporte", etapa: "", product: "" } },
  ];
  const { L, out } = await fill(s, { planActions });
  assert.equal(cell(L, "G9"), "João / Ana");
  assert.equal(cell(L, "H9"), 46366, "maior data (10/12/2026) como data do Excel");
  assert.equal(cell(L, "G10"), "", "ação de outro estudo não entra");
  assert.ok(out.warnings.some((w) => w.includes("1 elemento(s) vieram do Plano")));
});

test("r05 D5/D6: premissas e desperdícios em UNIDADES!C15; constatações na Compilação B35", async () => {
  const { U, K } = await fill(study());
  const obs = cell(U, "C15");
  assert.ok(obs.includes("Metal Alfa — Corte"));
  assert.ok(obs.includes("2 filmagem(ns) — peças F1: 5; F2: 3; 5 lançamento(s), 3 elemento(s)"), obs);
  assert.ok(obs.includes("Tamanho do lote = 8 peças filmadas"));
  assert.ok(obs.includes("Desperdícios observados:\n- Transporte: Transporte\n- Abastecer: Superprodução"));
  assert.ok(!obs.includes("exemplo"), "texto de exemplo do modelo substituído");
  assert.equal(cell(K, "B35"), "Constatação & solução <teste>");
  assert.match(K, /<c r="B35" s="29"/, "formatação da célula mantida");
});

test("r05 D2/D7: avisos de ritmo, tolerância e mais de 137 lançamentos", async () => {
  const s = study();
  s.elements[0].pace = "110";
  s.shiftParams.tolerancePct = 10;
  let { out } = await fill(s);
  assert.ok(out.warnings.some((w) => w.includes("não tem coluna de ritmo")));
  assert.ok(out.warnings.some((w) => w.includes("10% de tolerância")));
  const big = C.createStudy({ clientName: "X", processName: "Y" });
  big.elements = Array.from({ length: 140 }, (_, i) => C.createElement({ description: `E${i % 5}`, videoTime: `${Math.floor((i + 1) / 60)}:${String((i + 1) % 60).padStart(2, "0")}`, quantity: "1", type: "C" }));
  ({ out } = await fill(big));
  assert.equal(out.lines, 140);
  assert.ok(out.warnings.some((w) => w.includes("acima de 137 atividades")));
});

test("r05: unidade base vazia recebe 'Peça'; macro e demais partes copiadas", async () => {
  const { U, G, o } = await fill(study(), {}, "");
  assert.equal(cell(U, "B9"), "Peça");
  assert.equal(cell(G, "F9"), "Peça");
  const vba = o.entries.find((e) => e.name === "xl/vbaProject.bin");
  assert.equal(vba.method, 8, "macro copiada byte a byte");
});

test("r05: um arquivo por produto e etapa no nome do elemento", async () => {
  const s = C.createStudy({ clientName: "Padaria", processName: "Bancada" });
  s.elements = [
    ["Pão", "Laminação", "Abrir a massa", "10"],
    ["Pão", "Modelagem", "Enrolar", "25"],
    ["Rosca", "Laminação", "Abrir a massa", "40"],
  ].map(([product, etapa, description, videoTime]) => C.createElement({ product, etapa, description, videoTime, quantity: "1", type: "C" }));
  const { G, out } = await fill(s);
  assert.deepEqual(["B9", "B10", "B11"].map((r) => cell(G, r)), ["Laminação • Abrir a massa", "Modelagem • Enrolar", ""]);
  assert.ok(out.warnings.some((w) => w.includes('exportado só "Pão"')));
});

test("r05: layout alterado é recusado com a célula que mudou", async () => {
  // Cabeçalho da Listagem alterado
  const broken = X.zip(
    T.readZip(buildR05()).map((e) => (e.name === "xl/worksheets/sheet3.xml"
      ? { name: e.name, data: enc.encode(dec.decode(inflate(e.compressed)).replace("Qtd. (média)", "Quantidade")) }
      : { name: e.name, raw: { method: e.method, compressed: e.compressed, crc: e.crc, size: e.size } }))
  );
  await assert.rejects(T.loadTemplate(broken, { inflate }), /Layout diferente do modelo r05 \(Listagem!D7/);
});
