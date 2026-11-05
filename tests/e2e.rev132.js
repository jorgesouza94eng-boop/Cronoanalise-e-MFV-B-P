/**
 * Teste de ponta a ponta da REV 1.32 (Playwright): ao digitar nomes na grade (descrição),
 * o recálculo espera uma pausa (250 ms) em vez de rodar a cada tecla; sair do campo aplica na
 * hora; o resultado final é o mesmo. Tolerância fora da faixa = TP "--". Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev132.js http://127.0.0.1:8080/
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
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.32 ${base}`);

  const s = C.createStudy({ clientName: "Digitação Teste", processName: "Bancada" });
  s.shiftParams.tolerancePct = 10;
  s.elements = [
    C.createElement({ description: "Cortar", videoTime: "0:20", quantity: "1", value: "AG" }),
    C.createElement({ description: "Cortar", videoTime: "0:40", quantity: "1", value: "AG" }),
    C.createElement({ description: "Embalar", videoTime: "0:50", quantity: "1", value: "IN" }),
  ];
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(3[2-9]|[4-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.32");
  await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");
  const groups = () => p.evaluate(() => LeanApp.state.computed.summary.elements.map((g) => g.name).join("|"));
  check((await groups()) === "Cortar|Embalar", "resumo inicial: Cortar | Embalar");

  // Digitando: o estudo muda na hora, o resumo só depois da pausa
  const cell = "#chrono-tbody tr:nth-child(2) [data-field=description]";
  await p.click(cell);
  await p.keyboard.press("End");
  await p.keyboard.type(" peça", { delay: 30 });
  check((await p.evaluate(() => LeanApp.state.study.elements[1].description)) === "Cortar peça", "digitação gravada no estudo na hora");
  check((await groups()) === "Cortar|Embalar", "resumo ainda não recalculado durante a digitação");
  await p.waitForTimeout(400);
  check((await groups()) === "Cortar|Cortar peça|Embalar", "após a pausa (250 ms): resumo recalculado");

  // Sair do campo aplica na hora
  await p.click(cell);
  await p.keyboard.press("End");
  await p.keyboard.type("s");
  await p.keyboard.press("Tab");
  check((await groups()) === "Cortar|Cortar peças|Embalar", "sair do campo: recálculo imediato");
  const tpPage = await p.evaluate(() => LeanApp.state.computed.kpis.standardTime);
  const tpNode = C.computeStudy(await p.evaluate(() => JSON.parse(JSON.stringify(LeanApp.state.study)))).kpis.standardTime;
  check(Math.abs(tpPage - tpNode) < 1e-12, "TP da tela = TP calculado fora do navegador");

  // Tolerância fora da faixa = TP "--"
  await p.evaluate(() => { LeanApp.state.study.shiftParams.tolerancePct = 150; });
  await p.fill("#chrono-tbody tr:nth-child(3) [data-field=description]", "Embalar caixa");
  await p.keyboard.press("Tab");
  check((await p.evaluate(() => LeanApp.state.computed.kpis.standardTime)) === null, "tolerância 150%: TP \"--\"");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
