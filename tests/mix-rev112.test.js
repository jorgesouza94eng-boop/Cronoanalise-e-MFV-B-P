/**
 * Testes da REV 1.12: "Considerar no mix" por produto e nome do vídeo por filmagem.
 * Base: tempo líquido = 28.800 s (480 min). Produtos A (TP 40 s), B (TP 60 s) e C (TP 100 s).
 * Desde a REV 1.12 o produto sem demanda própria NÃO herda a demanda geral no mix (decisão D1).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../js/calc.js");

const close = (actual, expected, tol, msg) =>
  assert.ok(actual != null && Math.abs(actual - expected) < (tol || 1e-9), `${msg || ""} esperado ${expected}, obtido ${actual}`);
const sec = (min) => min * 60;

/** Estudo sintético: A 40 s, B 60 s, C 100 s (modo quantidade, tolerância 0%). */
function abc(extra) {
  const s = C.createStudy({ id: "abc00000-0000-4000-8000-000000000000", clientName: "Empresa Teste", processName: "Posto" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 500, tolerancePct: 0 };
  s.elements = [
    C.createElement({ product: "A", description: "Montar A", videoTime: "40", value: "AG" }),
    C.createElement({ product: "B", description: "Montar B", videoTime: "1:40", value: "AG" }),
    C.createElement({ product: "C", description: "Montar C", videoTime: "3:20", value: "NA", waste: "espera" }),
  ];
  s.productDemand = { a: "300", b: "200" };
  return Object.assign(s, extra || {});
}
const row = (mix, name) => mix.items.find((i) => i.name === name);

test("T1: C desmarcado → só A e B na carga; C 'fora do mix' com '--'", () => {
  const r = C.computeStudy(abc({ produtoNoMix: { c: false } }));
  const m = r.mix;
  close(sec(row(m, "A").load), 12000);
  close(sec(row(m, "B").load), 12000);
  close(sec(m.load), 24000);
  close(m.occupancyPct, (24000 / 28800) * 100);
  assert.equal(m.occupancyPct.toFixed(1), "83.3");
  close(sec(m.taktMix), 57.6, 1e-9);
  close(sec(m.weightedTP), 48, 1e-9);
  assert.equal(row(m, "C").inMix, false);
  assert.equal(row(m, "C").demand, null);
  assert.equal(row(m, "C").load, null);
  assert.equal(m.status, "atende");
  assert.equal(m.partial, true);
  assert.ok(m.issues.includes("Mix parcial: ocupação do posto subestimada, produto C fora da carga"));
  // C continua com TP, resumo, capacidade e takt próprios
  const c = r.products.find((p) => p.name === "C");
  close(sec(c.kpis.standardTime), 100);
  assert.equal(c.summary.elements.length, 1);
  assert.equal(c.kpis.capacity, Math.floor(28800 / 100));
  close(sec(c.kpis.taktTime), 28800 / 500, 1e-9, "takt de C pela demanda geral (fora do mix)");
});

test("T2 (D1): C marcado sem demanda própria → não herda a geral; indicadores do mix em '--'", () => {
  const m = C.computeStudy(abc()).mix;
  assert.equal(m.status, "incompleto");
  assert.equal(m.load, null);
  assert.equal(m.occupancyPct, null);
  assert.equal(m.taktMix, null);
  assert.equal(m.weightedTP, null);
  assert.equal(row(m, "C").demand, null);
  assert.ok(m.issues.some((t) => /Produto C sem demanda própria: informe a demanda ou desmarque "Considerar no mix"/.test(t)));
});

test("T2b: C com demanda própria 500 → fórmula do mix com os 3 produtos (256,9%; 28,8 s; 74,0 s)", () => {
  const s = abc();
  s.productDemand.c = "500";
  const m = C.computeStudy(s).mix;
  close(sec(row(m, "C").load), 50000);
  assert.equal(m.occupancyPct.toFixed(1), "256.9");
  close(sec(m.taktMix), 28.8, 1e-9);
  close(sec(m.weightedTP), 74, 1e-9);
  assert.equal(m.status, "sobrecarga");
  assert.equal(m.partial, false);
});

test("T3: todos desmarcados → '--' nos quatro indicadores e 'Informe a demanda ou inclua um produto no mix'", () => {
  const m = C.computeStudy(abc({ produtoNoMix: { a: false, b: false, c: false } })).mix;
  assert.equal(m.status, "vazio");
  ["load", "occupancyPct", "taktMix", "weightedTP"].forEach((k) => assert.equal(m[k], null, k));
  assert.deepEqual(m.issues, ["Informe a demanda ou inclua um produto no mix"]);
  assert.equal(m.partial, false);
});

test("T4: só A incluído → 41,7%; takt misto 96 s; TC ponderado 40 s", () => {
  const m = C.computeStudy(abc({ produtoNoMix: { b: false, c: false } })).mix;
  assert.equal(m.occupancyPct.toFixed(1), "41.7");
  close(sec(m.taktMix), 96, 1e-9);
  close(sec(m.weightedTP), 40, 1e-9);
  assert.equal(m.partial, true);
});

test("T5: JSON da REV 1.11 (v4, sem o campo) abre com todos no mix e os mesmos resultados", () => {
  const s = abc();
  s.productDemand.c = "500";
  const v4 = JSON.parse(C.serializeStudy(s));
  v4.schemaVersion = 4;
  delete v4.produtoNoMix;
  delete v4.filmVideos;
  const n = C.normalizeStudy(v4);
  assert.ok(n.ok);
  assert.deepEqual(n.study.produtoNoMix, {});
  const a = C.computeStudy(n.study).mix;
  const b = C.computeStudy(s).mix;
  assert.ok(a.items.every((i) => i.inMix));
  ["load", "occupancyPct", "taktMix", "weightedTP", "status"].forEach((k) => assert.equal(a[k], b[k], k));
});

test("T6: desmarcar e remarcar volta aos valores originais sem mexer nos elementos", () => {
  const s = abc();
  s.productDemand.c = "500";
  const before = C.computeStudy(s).mix;
  const els = JSON.stringify(s.elements);
  s.produtoNoMix = { c: false };
  assert.notEqual(C.computeStudy(s).mix.load, before.load);
  delete s.produtoNoMix.c;
  const after = C.computeStudy(s).mix;
  ["load", "occupancyPct", "taktMix", "weightedTP", "status"].forEach((k) => assert.equal(after[k], before[k], k));
  assert.equal(JSON.stringify(s.elements), els, "tipo, valor e desperdício intactos");
});

test("T7: exportar JSON e reimportar preserva 'Considerar no mix' (e o resumo traz considerarNoMix)", () => {
  const s = abc({ produtoNoMix: { c: false, a: true } });
  const json = JSON.parse(C.serializeStudy(s));
  assert.deepEqual(C.normalizeStudy(json).study.produtoNoMix, { c: false }, "só o 'false' é guardado");
  const prods = json.results.products;
  assert.equal(prods.find((p) => p.product === "C").considerarNoMix, false);
  assert.equal(prods.find((p) => p.product === "A").considerarNoMix, true);
  assert.equal(json.results.mix.partial, true);
  assert.match(json.results.mix.note, /Mix parcial: C fora da carga/);
  // CSV: coluna e nota
  const csv = C.buildCSV(s);
  assert.match(csv, /Considerar no mix/);
  assert.match(csv, /"C";[^\n]*;Não;/);
  assert.match(csv, /Status do mix;"Atende o mix \(mix parcial\)"/);
});

test("estudo de um produto só: sem mix e sem mudança nos cálculos", () => {
  const s = abc();
  s.elements.forEach((e) => (e.product = ""));
  s.produtoNoMix = { "": false };
  const r = C.computeStudy(s);
  assert.equal(r.mix, null);
  assert.equal(r.product.inMix, true);
  close(sec(r.kpis.standardTime), 200);
});

test("nome do vídeo por filmagem: resumo, CSV e JSON", () => {
  const s = abc();
  s.elements[2].newVideo = true;
  s.filmStarts = { [s.elements[2].id]: "00:00" };
  s.elements[2].videoTime = "1:40";
  s.filmVideos = { inicio: "IMG_0001.mp4", [s.elements[2].id]: "IMG_0002.mp4" };
  const r = C.computeStudy(s);
  assert.deepEqual(r.filmList.map((f) => f.video), ["IMG_0001.mp4", "IMG_0002.mp4"]);
  const json = JSON.parse(C.serializeStudy(s));
  assert.equal(json.results.films[1].video, "IMG_0002.mp4");
  assert.deepEqual(C.normalizeStudy(json).study.filmVideos, s.filmVideos);
  const csv = C.buildCSV(s);
  assert.match(csv, /\n3;2;"IMG_0002\.mp4";"C"/);
});

test("rótulo de revisão nas páginas = versão do package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const rev = `REV ${pkg.version.split(".").slice(0, 2).join(".")}`;
  ["index.html", "mfv.html", "yamazumi.html"].forEach((f) => {
    assert.ok(fs.readFileSync(path.join(__dirname, "..", f), "utf8").includes(`>${rev}<`), `${f} mostra ${rev}`);
  });
});
