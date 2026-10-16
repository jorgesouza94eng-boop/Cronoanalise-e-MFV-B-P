/**
 * Teste de ponta a ponta da REV 1.5 (Playwright): "preencher para baixo" da coluna Produto.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev15.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp */ // existe apenas dentro da página testada
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

/** 8 linhas sem produto (um estudo antigo, antes de ligar "Vários produtos"); a F2 começa na linha 6. */
function studyJson() {
  const s = C.createStudy({ clientName: "Metal Épsilon", processName: "Serra" });
  s.elements = ["10", "20", "30", "40", "50", "08", "16", "24"].map((t, i) =>
    C.createElement({ description: i % 2 ? "Medir" : "Cortar", videoTime: t, newVideo: i === 5 })
  );
  return Buffer.from(C.serializeStudy(s));
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  let answer = true; // resposta às confirmações (Enter = sim, Esc = não)
  const asked = [];
  p.on("dialog", (d) => { asked.push(d.message()); return answer ? d.accept() : d.dismiss(); });
  const cell = (n) => `#chrono-tbody tr:nth-child(${n}) [data-field=product]`;
  const products = () => p.$$eval("#chrono-tbody [data-field=product]", (i) => i.map((x) => x.value));
  const stored = () => p.evaluate(() => LeanApp.state.study.elements.map((e) => e.product));
  console.log(`== REV 1.5 ${base}`);

  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  await p.setInputFiles("#input-import-json", { name: "e.json", mimeType: "application/json", buffer: studyJson() });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Serra");
  await p.evaluate(() => { const d = document.getElementById("study-dialog"); if (d.open) d.close(); });
  await p.check("#opt-multi-product");

  // Regra 1: produto na linha 1 preenche as vazias abaixo (atravessa a troca de filmagem)
  await p.fill(cell(1), "Produto A");
  await p.press(cell(1), "Tab");
  check((await products()).every((v) => v === "Produto A"), "linha 1 → linhas 1 a 8 com 'Produto A' (inclusive a F2)");
  check(JSON.stringify(await stored()) === JSON.stringify(Array(8).fill("Produto A")), "valores gravados no estudo");
  check(asked.length === 0, "preencher vazias não pede confirmação");
  check((await p.textContent("#toast-region")).includes("linhas 2 a 8"), "aviso: aplicado nas linhas 2 a 8");
  // Clicar numa linha recém-preenchida e digitar substitui o texto (não acrescenta)
  await p.click(cell(8));
  await p.keyboard.type("Produto A");
  check(await p.inputValue(cell(8)) === "Produto A", "digitar numa linha preenchida substitui o produto (texto selecionado ao entrar)");

  // Regra 2: trocar o produto pergunta e troca o bloco seguido
  await p.fill(cell(5), "Produto B");
  await p.press(cell(5), "Enter");
  check(asked.length === 1 && asked[0].includes("linhas 6 a 8") && asked[0].includes('"Produto A"'), "troca pergunta: linhas 6 a 8 que estavam como 'Produto A'");
  check(JSON.stringify(await products()) === JSON.stringify(["Produto A", "Produto A", "Produto A", "Produto A", "Produto B", "Produto B", "Produto B", "Produto B"]), "Enter = sim: linhas 5 a 8 'Produto B'");
  check(await p.evaluate(() => document.activeElement.dataset.field) === "description", "Enter no produto segue para a descrição");
  await p.waitForFunction(() => LeanApp.state.computed.products.length === 2);
  check(await p.evaluate(() => LeanApp.state.computed.products.map((x) => x.summary.elements.length).join()) === "2,2", "resumo separado: 2 produtos");

  // Esc = só esta linha
  answer = false;
  await p.fill(cell(7), "Produto C");
  await p.press(cell(7), "Tab");
  answer = true;
  check(JSON.stringify((await products()).slice(4)) === JSON.stringify(["Produto B", "Produto B", "Produto C", "Produto B"]), "Esc = não: só a linha 7 muda");

  // Com filtro ativo, só a linha editada muda (sem perguntar)
  const before = asked.length;
  await p.selectOption("#flt-type", "C");
  await p.fill(cell(2), "Produto Z");
  await p.press(cell(2), "Tab");
  check(asked.length === before && JSON.stringify((await products()).slice(0, 4)) === JSON.stringify(["Produto A", "Produto Z", "Produto A", "Produto A"]), "com filtro: só a linha editada, sem confirmação");
  await p.click("#btn-clear-filter");

  // Persistência
  await p.evaluate(() => LeanApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  check(JSON.stringify(await stored()) === JSON.stringify(["Produto A", "Produto Z", "Produto A", "Produto A", "Produto B", "Produto B", "Produto C", "Produto B"]), "produtos preservados após recarregar");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
