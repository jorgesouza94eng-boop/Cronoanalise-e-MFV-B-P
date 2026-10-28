/**
 * Teste de ponta a ponta da REV 1.18 (Playwright): ao escolher o valor, o desperdício ou o tipo
 * de uma linha, as outras linhas do mesmo elemento recebem a mesma classificação (as vazias
 * direto; as já classificadas com outro valor, só se o consultor confirmar). Com filtro ativo,
 * só a linha editada muda. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev118.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp */ // existe apenas dentro da página testada
const { chromium } = require("playwright");
const C = require("../js/calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  let answer = true;
  const dialogs = [];
  p.on("dialog", (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.18 ${base}`);

  const s = C.createStudy({ clientName: "Classificação Teste", processName: "Laminação" });
  s.elements = [
    ["Passando a Massa no Laminador", "10", ""],
    ["Cortando a Massa", "20", ""],
    ["Passando a Massa no Laminador", "30", ""],
    ["Passando a Massa no Laminador", "40", "AG"],
    ["Cortando a Massa", "50", ""],
  ].map(([description, videoTime, value]) => C.createElement({ description, videoTime, value }));
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(1[8-9]|[2-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.18");
  await p.setInputFiles("#input-import-json", { name: "c.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Laminação");
  const sel = (i, f) => `#chrono-tbody tr:nth-child(${i}) [data-field='${f}']`;
  const values = () => p.evaluate(() => LeanApp.state.study.elements.map((e) => e.value || "-").join(","));

  // Linha 1 = Incidental: a 3 (vazia) recebe; a 4 (Agrega) pergunta — aqui, manter
  answer = false;
  await p.selectOption(sel(1, "value"), "IN");
  check(dialogs.some((m) => m.includes('"Passando a Massa no Laminador" também aparece nas linhas 04 (Agrega)')), "pergunta antes de trocar a linha já classificada");
  check(await values() === "IN,-,IN,AG,-", "vazia preenchida, a já classificada mantida: " + (await values()));
  check(await p.inputValue(sel(3, "value")) === "IN", "a tela mostra o valor copiado na linha 3");
  check((await txt(".toast:last-child")).includes('"Incidental" aplicado em 1 linha(s) de "Passando a Massa no Laminador" (03)'), "aviso das linhas alteradas");

  // Linha 4 = Incidental de novo, aceitando: todas iguais; o aviso de divergência some
  answer = true;
  dialogs.length = 0;
  await p.selectOption(sel(4, "value"), "NA");
  check(dialogs.length === 1 && (await values()) === "NA,-,NA,NA,-", "confirmado: todas as linhas do elemento iguais: " + (await values()));
  check(!(await p.evaluate(() => LeanApp.state.computed.summary.elements.some((g) => g.conflicts.length))), "sem classificação divergente no resumo");

  // Tipo e desperdício
  dialogs.length = 0;
  await p.selectOption(sel(2, "type"), "A");
  check(dialogs.length === 1 && (await p.evaluate(() => LeanApp.state.study.elements[4].type)) === "A", "tipo copiado (a linha 5 era C: confirmado)");
  await p.selectOption(sel(2, "waste"), "movimentacao");
  check(await p.evaluate(() => LeanApp.state.study.elements[4].waste) === "movimentacao", "desperdício copiado para a linha vazia");

  // Com filtro ativo, só a linha editada muda
  await p.fill("#flt-text", "Cortando");
  await p.selectOption(sel(2, "value"), "AG");
  check(await values() === "NA,AG,NA,NA,-", "com filtro: só a linha editada: " + (await values()));
  await p.click("#btn-clear-filter");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
