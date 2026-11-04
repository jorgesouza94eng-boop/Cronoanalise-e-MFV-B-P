/**
 * Teste de ponta a ponta da REV 1.30 (Playwright): empresa ativa compartilhada pelas 4 páginas
 * (selo no cabeçalho, documento aberto ao entrar, janela "Novo" já na empresa) e seletor
 * "MFV da empresa" / "Grupo da empresa". Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev130.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanYamazumiApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");
const C = require("../js/calc.js");
const M = require("../js/mfv-calc.js");

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
  const badge = () => p.textContent(".app-header .app-company").then((t) => t.trim());
  console.log(`== REV 1.30 ${base}`);

  const study = (client, process) => {
    const s = C.createStudy({ clientName: client, processName: process });
    s.elements = [C.createElement({ description: "Modelar", videoTime: "10", quantity: "1", type: "C", value: "AG" })];
    return s;
  };
  const sA = study("Padaria Sol", "Forno");
  const sB = study("Metal Alfa", "Corte");

  // 1) Cronoanálise: o estudo aberto define a empresa ativa (selo no cabeçalho)
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(3\d|[4-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.30");
  for (const s of [sA, sB]) {
    await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
    await p.waitForFunction((id) => LeanApp.state.study && LeanApp.state.study.id === id, s.id);
  }
  await p.evaluate(() => LeanApp.flushSave && LeanApp.flushSave());
  check((await badge()) === "Empresa: Metal Alfa", "selo do cabeçalho: " + (await badge()));

  // 2) MFV: 1 da Metal Alfa e 2 da Padaria Sol (o último importado fica aberto)
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  check((await p.inputValue("#new-client")) === "Metal Alfa", "MFV: empresa ativa sem MFV → \"Novo MFV\" já com a empresa");
  const mfvs = [M.createMfv({ clientName: "Metal Alfa", family: "Perfis" }), M.createMfv({ clientName: "Padaria Sol", family: "Pães" }), M.createMfv({ clientName: "Padaria Sol", family: "Bolos" })];
  for (const d of mfvs) {
    d.steps = [M.createStep({ name: "Etapa", tcManualMin: 0.2 })];
    await p.setInputFiles("#input-import-mfv", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(d)) });
    await p.waitForFunction((id) => LeanMfvApp.state.doc && LeanMfvApp.state.doc.id === id, d.id);
    await p.evaluate(() => LeanMfvApp.flushSave());
  }
  await p.waitForFunction(() => !document.getElementById("mfv-switch-box").hidden && document.querySelectorAll("#mfv-switch option").length === 3);
  const opts = await p.$$eval("#mfv-switch option", (o) => o.map((x) => x.textContent));
  check(opts.length === 3 && opts[0].startsWith("Bolos (") && opts[1].startsWith("Pães (") && opts[2] === "+ Novo MFV desta empresa", "seletor \"MFV da empresa\": só as 2 famílias da Padaria Sol + novo: " + opts.join(" | "));
  check((await badge()) === "Empresa: Padaria Sol", "MFV aberto muda a empresa ativa");
  await p.selectOption("#mfv-switch", mfvs[1].id);
  await p.waitForFunction((id) => LeanMfvApp.state.doc.id === id, mfvs[1].id);
  check((await p.inputValue("#mfv-family")) === "Pães", "seletor troca para o MFV escolhido");
  await p.fill("#mfv-family", "Pães franceses");
  check((await p.$eval("#mfv-switch option:checked", (o) => o.textContent)).startsWith("Pães franceses"), "seletor acompanha a família digitada");
  await p.evaluate(() => LeanMfvApp.flushSave());

  // 3) Cronoanálise pelo menu: abre o estudo da empresa ativa (Padaria Sol), não o último (Metal Alfa)
  await p.click("a[href='index.html']");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  check((await p.evaluate(() => LeanApp.state.study.processName)) === "Forno", "Cronoanálise abre o estudo da empresa ativa");
  check(await p.isHidden("#study-dialog[open]"), "sem janela: estudo aberto direto");

  // 4) Abrir o estudo da Metal Alfa → MFV abre o MFV dela (1 só, sem aviso)
  await p.click("#btn-studies");
  await p.waitForSelector("#study-dialog[open]");
  check((await p.$eval("select.company-filter", (s) => s.options[s.selectedIndex].textContent)).startsWith("Padaria Sol"), "lista de estudos já filtrada na empresa ativa");
  await p.selectOption("select.company-filter", "");
  await p.click(`#study-list li[data-id='${sB.id}'] .study-item`);
  await p.waitForFunction((id) => LeanApp.state.study.id === id, sB.id);
  await p.click("a[href='mfv.html']");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  check((await p.evaluate(() => LeanMfvApp.state.doc.family)) === "Perfis", "MFV abre o da Metal Alfa (empresa ativa)");
  check(await p.$$eval("#mfv-switch option", (o) => o.length) === 2, "Metal Alfa: 1 MFV + novo no seletor");

  // 5) Yamazumi e Plano sem documento da empresa: janela com a empresa preenchida
  await p.click("a[href='yamazumi.html']");
  await p.waitForSelector("#doc-dialog[open]");
  check((await p.inputValue("#new-client")) === "Metal Alfa", "Yamazumi: \"Novo grupo\" já com a empresa ativa");
  await p.click("a[href='plano.html']").catch(async () => p.goto(base + "plano.html"));
  await p.waitForSelector("#doc-dialog[open]");
  check((await p.inputValue("#new-client")) === "Metal Alfa", "Plano: \"Novo plano\" já com a empresa ativa");
  check((await badge()) === "Empresa: Metal Alfa", "selo igual nas 4 páginas");

  // 6) Empresa com 2 MFVs: abre o mais recente, avisa e destaca o seletor; "+ Novo" abre a janela
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  await p.click("#btn-studies");
  await p.waitForSelector("#study-dialog[open]");
  await p.selectOption("select.company-filter", "");
  await p.click(`#study-list li[data-id='${sA.id}'] .study-item`);
  await p.waitForFunction((id) => LeanApp.state.study.id === id, sA.id);
  await p.goto(base + "mfv.html");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  check((await p.evaluate(() => LeanMfvApp.state.doc.clientName)) === "Padaria Sol", "MFV da Padaria Sol aberto");
  await p.waitForFunction(() => document.getElementById("toast-region").textContent.includes("tem 2 MFVs"));
  check((await txt("#toast-region")).includes('Padaria Sol tem 2 MFVs — escolha a família no seletor "MFV da empresa"'), "aviso dos 2 MFVs");
  check((await p.getAttribute("#mfv-switch", "class")).includes("switch-attention"), "seletor destacado");
  await p.selectOption("#mfv-switch", "__new");
  await p.waitForSelector("#doc-dialog[open]");
  check((await p.inputValue("#new-client")) === "Padaria Sol", "\"+ Novo MFV desta empresa\" abre a janela com a empresa");
  check((await p.evaluate(() => LeanMfvApp.state.doc.clientName)) === "Padaria Sol" && (await p.inputValue("#mfv-switch")) !== "__new", "MFV aberto continua o mesmo (nada criado)");
  await p.keyboard.press("Escape");

  // 7) Yamazumi: seletor "Grupo da empresa" com 2 grupos
  await p.goto(base + "yamazumi.html");
  await p.waitForSelector("#doc-dialog[open]");
  for (const name of ["Célula 1", "Célula 2"]) {
    await p.fill("#new-client", "Padaria Sol");
    await p.fill("#new-name", name);
    await p.click("#new-doc-form button[type=submit]");
    await p.waitForFunction((n) => window.LeanYamazumiApp && LeanYamazumiApp.state.doc && LeanYamazumiApp.state.doc.name === n, name);
    await p.evaluate(() => LeanYamazumiApp.flushSave());
    if (name === "Célula 1") {
      await p.click("#btn-docs");
      await p.waitForSelector("#doc-dialog[open]");
    }
  }
  await p.waitForFunction(() => document.querySelectorAll("#grp-switch option").length === 3);
  check((await p.$$eval("#grp-switch option", (o) => o.map((x) => x.textContent.replace(/ \(.*$/, "")))).join("|") === "Célula 1|Célula 2|+ Novo grupo desta empresa", "seletor \"Grupo da empresa\" com os 2 grupos");

  // Celular: sem rolagem horizontal com o seletor e o selo
  await p.goto(base + "mfv.html");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: sem rolagem horizontal");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
