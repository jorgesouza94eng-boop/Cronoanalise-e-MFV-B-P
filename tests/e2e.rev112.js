/**
 * Teste de ponta a ponta da REV 1.12 (Playwright): "Considerar no mix" por produto (carga do
 * posto, mix parcial, nenhum produto no mix, demanda geral não herdada), nome do vídeo por
 * filmagem, avisos no MFV e rótulo da revisão.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev112.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp */ // existe apenas dentro da página testada
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** A 40 s (300/dia), B 60 s (200/dia), C 100 s (sem demanda própria); tempo líquido 480 min. */
function abc() {
  const s = C.createStudy({ clientName: "Empresa Teste", processName: "Posto" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 500, tolerancePct: 0 };
  s.settings.multiProduct = true;
  s.elements = [
    C.createElement({ product: "A", description: "Montar A", videoTime: "40", value: "AG" }),
    C.createElement({ product: "B", description: "Montar B", videoTime: "1:40", value: "AG" }),
    C.createElement({ product: "C", description: "Montar C", videoTime: "3:20", value: "AG" }),
  ];
  s.productDemand = { a: "300", b: "200" };
  return s;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  const rowC = "#mix-tbody tr:nth-child(3)";
  console.log(`== REV 1.12 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.\d+$/.test(await txt(".app-header .app-rev")), "rótulo da revisão no cabeçalho");
  await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(abc())) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Posto");

  // ---- C marcado sem demanda própria: não herda a geral (D1)
  check(await txt("#mix-occupancy") === "--" && (await txt("#mix-load")) === "--", "C sem demanda própria: carga e ocupação em '--'");
  const issues = await txt("#mix-issues");
  check(issues.includes('Produto C sem demanda própria: informe a demanda ou desmarque "Considerar no mix"'), "aviso do produto sem demanda");
  check(issues.includes("Desde a REV 1.12 a demanda geral não é repetida"), "aviso da mudança de regra (estudos antigos)");

  // ---- C fora do mix
  await p.uncheck(`${rowC} .mix-include`);
  check(await txt("#mix-occupancy") === "🟢 83,3% (parcial)", "C desmarcado: ocupação 24.000 ÷ 28.800 = 83,3% (parcial)");
  check(await txt("#mix-load") === "400,0", "carga total = 400 min (24.000 s)");
  check((await txt("#mix-hint")).includes("Takt misto = 57,6"), "takt misto = 57,6 s");
  check((await txt("#mix-weighted")).startsWith("48,0"), "TC ponderado = 48,0 s");
  check(await txt("#kpi-bottleneck") === "ATENDE O MIX (mix parcial)", "status com o complemento (mix parcial)");
  check((await p.getAttribute(rowC, "class")).includes("mix-out") && (await p.isVisible(`${rowC} .mix-out-tag`)), "linha de C em cinza com a etiqueta 'fora do mix'");
  check((await p.textContent(`${rowC} td:nth-child(5)`)).trim() === "--" && (await p.textContent(`${rowC} td:nth-child(6)`)).trim() === "--" && (await p.isDisabled(`${rowC} .mix-demand`)), "C: demanda bloqueada, carga e % em '--'");
  check((await txt("#mix-issues")).includes("Mix parcial: ocupação do posto subestimada, produto C fora da carga"), "aviso de mix parcial");

  // ---- Remarcar volta ao estado anterior; todos desmarcados
  await p.check(`${rowC} .mix-include`);
  check(await txt("#mix-occupancy") === "--", "C remarcado: volta ao '--' (sem demanda própria)");
  for (const n of [1, 2, 3]) await p.uncheck(`#mix-tbody tr:nth-child(${n}) .mix-include`);
  check(await txt("#mix-load") === "--" && (await txt("#mix-occupancy")) === "--" && (await txt("#mix-demand")) === "--", "todos desmarcados: '--'");
  check((await txt("#mix-issues")).includes("Informe a demanda ou inclua um produto no mix"), "mensagem: nenhum produto no mix");
  await p.check("#mix-tbody tr:nth-child(1) .mix-include");
  await p.check("#mix-tbody tr:nth-child(2) .mix-include");

  // ---- Nome do vídeo
  await p.fill("#films-list .film-video", "IMG_0001.mp4");
  await p.evaluate(() => LeanApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Posto");
  check(await p.inputValue("#films-list .film-video") === "IMG_0001.mp4", "nome do vídeo salvo e recarregado");
  check(await txt("#mix-occupancy") === "🟢 83,3% (parcial)", "recarregado: C continua fora do mix");
  check(await p.evaluate(() => LeanApp.state.study.produtoNoMix.c === false && LeanApp.state.study.filmVideos.inicio === "IMG_0001.mp4"), "campos gravados no estudo");

  // ---- MFV: Mix só com os incluídos e avisos
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Empresa Teste");
  await p.dispatchEvent("#new-client", "input");
  const items = await p.$$eval("#new-doc-study-list label", (l) => l.map((x) => ({ t: x.textContent, w: (x.querySelector(".study-check-warn") || {}).title || "" })));
  const mix = items.find((i) => i.t.includes("Mix (TC ponderado)"));
  const c = items.find((i) => i.t.includes("Posto • C"));
  check(mix && mix.t.includes("TC 0,800 min"), "Mix no MFV só com A e B: TC ponderado 48 s = 0,800 min");
  check(mix && mix.w.includes("mix parcial: C fora da carga"), "aviso de mix parcial na opção Mix");
  check(c && c.w.includes("produto fora do mix na Cronoanálise"), "produto C continua selecionável, com aviso");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
