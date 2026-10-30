/**
 * Teste de ponta a ponta da REV 1.21 (Playwright, Gemini SIMULADO): minimizar o assistente de
 * IA enquanto ele trabalha. Selo no canto com o andamento, grade livre durante a espera, aviso
 * quando termina, sugestões presas ao estudo do pedido, elemento renomeado durante a espera e
 * falha com a janela minimizada. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev121.js http://127.0.0.1:8080/
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
  p.on("console", (m) => m.type() === "error" && !/status of 500/.test(m.text()) && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  const pillShown = () => p.isVisible("#ai-pill");

  // Gemini simulado que só responde quando o teste libera (release); fail = responde erro 500
  let release = null;
  let fail = false;
  await p.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/models?")) {
      return route.fulfill({ json: { models: [{ name: "models/gemini-teste-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }] } });
    }
    const prompt = JSON.parse(req.postData()).contents[0].parts[0].text;
    await new Promise((r) => (release = r));
    if (fail) return route.fulfill({ status: 500, json: { error: { message: "erro simulado" } } });
    let text;
    if (prompt.includes("ELEMENTOS: ")) {
      const items = JSON.parse(prompt.match(/ELEMENTOS: (\[.*\])\n/)[1]);
      text = JSON.stringify({ itens: items.map((it) => ({ id: it.id, sem_acao: false, ecrs: "Eliminar", ferramenta: "5s", acao: `Organizar ${it.elemento} com 5S`, justificativa: "dado", confianca: "alta" })) });
    } else {
      text = JSON.stringify({ itens: [{ elemento: "Sem valor", valor: "NA", desperdicio: "espera", justificativa: "Espera" }] });
    }
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text }] } }] } });
  });
  const answer = async () => {
    await p.waitForFunction(() => true);
    for (let i = 0; i < 50 && !release; i++) await p.waitForTimeout(50);
    const r = release;
    release = null;
    r();
  };

  console.log(`== REV 1.21 ${base}`);
  const study = (process, rows) => {
    const s = C.createStudy({ clientName: "Minimizar Teste", processName: process });
    s.elements = rows.map(([description, videoTime, value]) => C.createElement({ description, videoTime, value }));
    return s;
  };
  const a = study("Bancada", [["Buscar bandeja", "10", "NA"], ["Anotar OP", "20", "IN"], ["Corte", "30", "AG"], ["Sem valor", "40", ""]]);
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2[1-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.21");
  await p.setInputFiles("#input-import-json", { name: "a.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(a)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");

  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.fill("#ai-key", "CHAVE-TESTE");
  await p.click("#btn-ai-models");
  await p.waitForFunction(() => document.querySelectorAll("#ai-model option").length === 1);
  await p.click("#btn-ai-save");
  await p.waitForFunction(() => !document.querySelector("[data-ai=kaizen]").disabled);

  // 1) Kaizen minimizado: selo, grade livre, elemento renomeado durante a espera
  await p.click("[data-ai=kaizen]");
  await p.click("#btn-ai-minimize");
  check(!(await p.isVisible("#ai-dialog")), "janela minimizada");
  check(await pillShown() && (await txt("#ai-pill-text")) === "✨ IA trabalhando… (Kaizen, 2 elemento(s))", "selo mostra o andamento: " + (await txt("#ai-pill-text")));
  check(!(await p.isVisible("#btn-ai-pill-discard")), "durante a tarefa não dá para descartar");
  await p.fill("#chrono-tbody tr:nth-child(2) [data-field=description]", "Anotar ordem");
  check(await p.evaluate(() => LeanApp.state.study.elements[1].description) === "Anotar ordem", "grade editável enquanto a IA trabalha");
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  check(await p.$eval("[data-ai=classify]", (b) => b.disabled), "ao reabrir: botões bloqueados enquanto a tarefa roda (uma por vez)");
  check(!(await pillShown()), "janela aberta: selo some");
  await p.click("#btn-ai-close");
  check(await pillShown(), "fechar (×) durante a tarefa também minimiza");
  await answer();
  await p.waitForFunction(() => document.getElementById("ai-pill-text").textContent.includes("prontas"));
  check((await txt("#ai-pill-text")) === "✨ Sugestões prontas (Kaizen) — abrir" && (await p.getAttribute("#ai-pill", "class")).includes("ai-pill-done"), "terminou: selo verde 'Sugestões prontas'");
  check((await txt("#toast-region")).includes("Sugestões da IA prontas (Kaizen)"), "aviso na tela quando termina");
  await p.click("#ai-pill-open");
  await p.waitForSelector("#ai-dialog[open]");
  check(await p.$$eval("#ai-list li", (l) => l.length) === 2 && (await txt("#ai-status")).includes("2 sugestão(ões)"), "janela volta com as sugestões e a mensagem");
  check(!(await p.$eval("[data-ai=classify]", (b) => b.disabled)), "botões liberados após o fim");
  await p.click("#btn-ai-apply");
  const kz = await p.evaluate(() => LeanApp.state.study.elements.map((e) => e.kaizen || "-"));
  check(kz[0] === "Eliminar: Organizar Buscar bandeja com 5S" && kz[1] === "-" && kz[3] === "-", "aplicada só no elemento que existe: " + kz.join(" | "));
  check((await txt("#ai-status")).includes("1 sugestão(ões) não aplicada(s): elemento renomeado ou apagado"), "avisa a sugestão do elemento renomeado");
  await p.click("#btn-ai-minimize");
  check(!(await pillShown()), "sem tarefa nem sugestões: sem selo");

  // 2) Sugestões presas ao estudo do pedido
  const b = study("Solda", [["Sem valor", "10", ""]]);
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.click("[data-ai=classify]");
  await p.click("#btn-ai-minimize");
  await p.setInputFiles("#input-import-json", { name: "b.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(b)) });
  await p.waitForFunction(() => LeanApp.state.study.processName === "Solda");
  await p.keyboard.press("Escape");
  await answer();
  await p.waitForFunction(() => document.getElementById("ai-pill-text").textContent.includes("prontas"));
  await p.click("#ai-pill-open");
  await p.waitForSelector("#ai-dialog[open]");
  check(await p.$eval("#btn-ai-apply", (x) => x.disabled), "outro estudo aberto: Aplicar desabilitado");
  check((await txt("#ai-status")).includes('Estas sugestões são do estudo "Minimizar Teste — Bancada"'), "avisa de qual estudo são as sugestões");
  await p.click("#btn-ai-minimize");
  check(await pillShown() && (await p.isVisible("#btn-ai-pill-discard")), "sugestões não aplicadas: selo continua, com descartar");
  await p.click("#btn-ai-pill-discard");
  check(!(await pillShown()), "descartar tira o selo");
  check(await p.evaluate(() => LeanApp.state.study.elements[0].value) === "", "nada aplicado no estudo errado");

  // 3) Falha com a janela minimizada
  fail = true;
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.click("[data-ai=notes]");
  await p.click("#btn-ai-minimize");
  await answer();
  await p.waitForFunction(() => document.getElementById("ai-pill").className.includes("ai-pill-error"));
  check((await txt("#ai-pill-text")) === "⚠ Falha na IA (Constatações) — ver detalhe", "falha: selo vermelho");
  await p.click("#ai-pill-open");
  await p.waitForSelector("#ai-dialog[open]");
  check((await txt("#ai-status")).startsWith("Falha na IA"), "detalhe da falha na janela");
  await p.click("#btn-ai-minimize");
  check(!(await pillShown()), "falha vista: selo some");

  // Celular: selo e avisos sem sobreposição e sem rolagem horizontal
  await p.setViewportSize({ width: 390, height: 844 });
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: sem rolagem horizontal");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
