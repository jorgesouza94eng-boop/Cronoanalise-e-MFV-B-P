/**
 * Teste de ponta a ponta da REV 1.3 (Playwright): início por filmagem, vários produtos
 * no mesmo estudo e filtros da grade/resumo.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev13.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** 2 filmagens; produtos A (linhas 1–2) e B (linhas 3–6); a F2 começa na linha 5. */
function studyJson() {
  const s = C.createStudy({ clientName: "Metal Gama", processName: "Furadeira" });
  s.elements = [
    C.createElement({ description: "Furar", videoTime: "12" }),
    C.createElement({ description: "Furar", videoTime: "24" }),
    C.createElement({ description: "Setup", type: "A", videoTime: "54" }),
    C.createElement({ description: "Furar", videoTime: "1:14" }),
    C.createElement({ description: "Furar", videoTime: "30", newVideo: true }),
    C.createElement({ description: "Furar", videoTime: "50" }),
  ];
  return Buffer.from(C.serializeStudy(s));
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  const row = (n) => `#chrono-tbody tr:nth-child(${n})`;
  const tsub = (n) => txt(`${row(n)} [data-out=tsub]`);
  const visible = () => p.$$eval("#chrono-tbody tr", (r) => r.filter((x) => !x.hidden).length);
  console.log(`== REV 1.3 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  await p.setInputFiles("#input-import-json", { name: "estudo.json", mimeType: "application/json", buffer: studyJson() });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Furadeira");
  await p.evaluate(() => { const d = document.getElementById("study-dialog"); if (d.open) d.close(); });

  // ---- 1. Início por filmagem
  check(await tsub(5) === "30,0", "sem início: 1ª linha da F2 = 30 s (desde 00:00)");
  const f2 = "#films-list .film-box:nth-child(2) .film-start";
  await p.fill(f2, "10");
  await p.press(f2, "Enter");
  check(await tsub(5) === "20,0" && (await tsub(6)) === "20,0", "início da F2 = 00:10: 1ª linha = 20 s; a seguinte não muda");
  check(await p.inputValue(f2) === "00:10", "início formatado como 00:10");
  await p.fill("#films-list .film-box:nth-child(1) .film-start", "02");
  await p.press("#films-list .film-box:nth-child(1) .film-start", "Enter");
  check(await p.inputValue("#video-start") === "00:02" && (await tsub(1)) === "10,0", "início da F1 = Leitura inicial (campos sincronizados)");
  await p.fill("#films-list .film-box:nth-child(1) .film-start", "");
  await p.press("#films-list .film-box:nth-child(1) .film-start", "Enter");
  await p.fill(f2, "40");
  await p.press(f2, "Enter");
  check(await p.$eval(row(5), (tr) => tr.classList.contains("row-error")), "tempo menor que o início da filmagem: linha em erro");
  await p.fill(f2, "10");
  await p.press(f2, "Enter");

  // ---- 2. Vários produtos
  check(await p.isHidden("#th-product"), "coluna Produto escondida em estudo de produto único");
  await p.check("#opt-multi-product");
  check(await p.isVisible("#th-product") && (await p.$$eval("#chrono-tbody .input-product", (i) => i.length)) === 6, "Vários produtos: coluna Produto em todas as linhas");
  for (let n = 1; n <= 6; n++) await p.fill(`${row(n)} [data-field=product]`, n <= 2 ? "Produto A" : "Produto B");
  await p.waitForFunction(() => LeanApp.state.computed.products.length === 2);
  check(await p.isVisible("#summary-product"), "seletor de produto no resumo");
  check(await txt("#summary-total") === "12,0", "Produto A: ciclo = 12 s");
  check((await txt("#kpi-normal-time")).startsWith("Produto A"), "indicadores mostram o produto");
  await p.selectOption("#summary-product", { label: "Produto B" });
  check(await txt("#summary-total") === "50,0", "Produto B: ciclo = Setup 30 s + Furar 20 s");
  check(await p.$$eval("#films-list .film-box:nth-child(1) .film-pieces", (i) => i.length) === 2, "F1 com 2 produtos: peças informadas por produto");

  // ---- 3. Filtros
  await p.fill("#flt-text", "furar");
  check(await visible() === 5, "filtro por nome: 5 de 6 linhas");
  check((await txt("#flt-status")).includes("5 de 6"), "aviso 'Filtro ativo: 5 de 6 linha(s)'");
  check(await p.isDisabled("#btn-add-row"), "com filtro, '+ Nova linha' fica bloqueado");
  await p.focus(`${row(2)} [data-field=description]`);
  await p.keyboard.press("ArrowDown");
  check(await p.evaluate(() => document.activeElement.closest("tr").rowIndex) === 4, "↓ pula a linha escondida (Setup)");
  await p.keyboard.press("Control+Enter");
  check(await p.$$eval("#chrono-tbody tr", (r) => r.length) === 6, "Ctrl+Enter com filtro não cria linha");
  await p.fill("#flt-text", "");
  await p.selectOption("#flt-type", "A");
  check(await visible() === 1, "filtro tipo A: só o Setup");
  check(await p.$$eval("#summary-tbody tr", (r) => r.filter((x) => !x.classList.contains("row-filtered-out")).length) === 1, "resumo também filtrado");
  await p.selectOption("#flt-type", "");
  await p.selectOption("#flt-film", "2");
  check(await visible() === 2, "filtro por filmagem: F2 = 2 linhas");
  await p.click("#btn-clear-filter");
  check(await visible() === 6 && (await txt("#flt-status")) === "" && !(await p.isDisabled("#btn-add-row")), "Limpar filtro: grade completa");
  check(await txt("#summary-total") === "50,0", "o filtro não altera os cálculos");

  // Nova linha herda o produto
  await p.click("#btn-add-row");
  check(await p.inputValue(`${row(7)} [data-field=product]`) === "Produto B", "nova linha repete o produto da anterior");
  await p.keyboard.press("Control+Delete");

  // ---- 4. Persistência e MFV com um TC por produto
  await p.evaluate(() => LeanApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.computed.products.length === 2);
  check(await p.inputValue(f2) === "00:10" && (await p.inputValue(`${row(1)} [data-field=product]`)) === "Produto A", "início e produtos preservados após recarregar");
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Metal Gama"); await p.fill("#new-family", "Flanges");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Flanges");
  const opts = await p.$$eval("#study-picker option", (o) => o.map((x) => x.textContent));
  check(opts.some((t) => t.includes("Furadeira • Produto A")) && opts.some((t) => t.includes("Furadeira • Produto B")), "MFV: uma opção de estudo por produto");

  // ---- 5. Desligar "Vários produtos" pede confirmação e limpa os produtos
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  await p.uncheck("#opt-multi-product");
  check(await p.isHidden("#th-product") && (await p.evaluate(() => LeanApp.state.computed.products.length)) === 1, "desligar: volta a um único resumo");

  await p.setViewportSize({ width: 390, height: 844 });
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: página sem rolagem horizontal");
  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
