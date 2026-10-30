/**
 * Teste de ponta a ponta da REV 1.22 (Playwright): peças = 0 numa filmagem que continua outra
 * (sem peças novas). O tipo A passa a ser dividido pelas peças das demais filmagens, e a tela
 * mostra a continuação. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev122.js http://127.0.0.1:8080/
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
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.22 ${base}`);

  // F1: produção (10 peças); F2: continuação com preparação da massa (só acíclicos)
  const s = C.createStudy({ clientName: "Continuação Teste", processName: "Padaria" });
  s.settings.entryMode = "quantidade";
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    C.createElement({ description: "Modelar pão", type: "C", quantity: "10", videoTime: "40" }), // 40 s ÷ 10 = 4 s
    C.createElement({ description: "Colocar na bandeja", type: "C", quantity: "10", videoTime: "60" }), // 20 s ÷ 10 = 2 s
    C.createElement({ description: "Preparação do gelo", type: "A", videoTime: "30", newVideo: true }), // 30 s
    C.createElement({ description: "Colocar matéria-prima", type: "A", videoTime: "50" }), // 20 s
  ];
  s.filmPieces = { [C.FIRST_FILM_KEY]: "10" };
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[2-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.22");
  await p.setInputFiles("#input-import-json", { name: "c.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Padaria");

  const hint = () => txt("#films-hint, .films-hint");
  check((await hint()).includes("Filmagem que continua outra (sem peças novas): digite 0"), "sem peças na F2: aviso explica o 0");
  const f2 = (await p.$$(".film-pieces"))[1];
  await f2.fill("0");
  await p.waitForFunction(() => LeanApp.state.computed.films.acyclic === "por-unidade");
  check(!(await f2.evaluate((x) => x.classList.contains("input-invalid"))), "0 aceito (não fica em vermelho)");
  check((await hint()).includes("Tipo A = Σtempo ÷ 10 peças (1 filmagem(ns) de continuação, com 0 peças)"), "aviso: tipo A ÷ 10 peças, com a continuação: " + (await hint()));
  check((await hint()).includes("Ciclo real observado: 11,0 s/un"), "ciclo observado inclui a continuação: (60 + 50 s) ÷ 10 = 11,0");
  check((await p.$$eval(".film-out", (l) => l.map((x) => x.textContent)))[1].includes("continuação (sem peças novas)"), "F2 mostra 'continuação (sem peças novas)'");
  const tp = await p.evaluate(() => Number((LeanApp.state.computed.kpis.standardTime * 60).toFixed(3)));
  check(tp === 11, "tempo padrão = 4 + 2 + 3 + 2 = 11 s (acíclicos ÷ 10): " + tp);
  await f2.fill("-1");
  await p.waitForFunction(() => LeanApp.state.computed.films.acyclic === "incompleto");
  check(await f2.evaluate((x) => x.classList.contains("input-invalid")), "negativo continua inválido");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
