/**
 * Teste de ponta a ponta do assistente de IA, com a API do Gemini SIMULADA
 * (Playwright intercepta as chamadas: não usa rede nem chave real).
 * Uso: npm start (outro terminal) e depois  node tests/e2e.ai.js http://127.0.0.1:8080/
 */
/* global LeanApp, LeanMfvApp */ // existem apenas dentro das páginas testadas
const { chromium } = require("playwright");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext()).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const sent = [];
  await p.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.headers()["x-goog-api-key"] !== "CHAVE-TESTE") return route.fulfill({ status: 400, json: { error: { message: "API key not valid" } } });
    if (url.includes("/models?")) {
      return route.fulfill({ json: { models: [
        { name: "models/gemini-teste-pro", displayName: "Gemini Teste Pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-teste-flash", displayName: "Gemini Teste Flash", supportedGenerationMethods: ["generateContent"] },
      ] } });
    }
    const prompt = JSON.parse(req.postData()).contents[0].parts[0].text;
    sent.push(prompt);
    let text;
    if (prompt.includes('{"grupos"')) {
      text = JSON.stringify({ grupos: [{ padrao: "Anotar OP", variantes: ["anotar a OP"] }] });
    } else if (prompt.includes("Pergunta:")) {
      text = "O elemento Anotar OP é o maior incidental do [CLIENTE]; padronize com quadro de OP.";
    } else if (prompt.includes("RESUMO EXECUTIVO")) {
      text = "• Situação: capacidade acima da demanda no [CLIENTE].\n• Gargalo: Montagem.";
    } else if (prompt.includes('"valor":"AG|NA|IN"')) {
      text = JSON.stringify({ itens: [
        { elemento: "Procurando peças do [CLIENTE]", valor: "NA", desperdicio: "movimentacao", justificativa: "Busca não agrega" },
        { elemento: "Anotar OP", valor: "IN", desperdicio: "processamento", justificativa: "Controle necessário" },
      ] });
    } else if (prompt.includes('"ecrs"')) {
      text = JSON.stringify({ itens: [{ elemento: "Procurando peças do [CLIENTE]", ecrs: "Eliminar", acao: "Endereçar peças com 5S" }] });
    } else {
      text = "PRINCIPAIS CONSTATAÇÕES:\n• Movimentação domina o ciclo no [CLIENTE].\nSOLUÇÕES PROPOSTAS:\n1. 5S e endereçamento.";
    }
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text }] } }] } });
  });

  console.log(`== IA (Gemini simulado) ${base}`);
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  await p.fill("#new-client", "Metal Alfa"); await p.fill("#new-process", "Montagem");
  await p.click("#new-study-form button[type=submit]");
  await p.waitForFunction(() => LeanApp.state.study);
  for (const [d, t] of [["Corte", "30"], ["Procurando peças do Metal Alfa", "50"], ["Anotar OP", "1:10"], ["anotar a OP", "1:20"]]) {
    await p.keyboard.type(d); await p.keyboard.press("Enter"); await p.keyboard.type(t); await p.keyboard.press("Enter"); await p.keyboard.press("Enter");
  }
  await p.selectOption("#chrono-tbody tr:nth-child(1) [data-field=value]", "AG");

  // Configuração
  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  check(await p.$eval("[data-ai=classify]", (b) => b.disabled), "sem chave: botões da IA desabilitados");
  await p.fill("#ai-key", "CHAVE-TESTE");
  await p.click("#btn-ai-models");
  await p.waitForFunction(() => document.querySelectorAll("#ai-model option").length === 2);
  check(await p.inputValue("#ai-model") === "gemini-teste-flash", "modelos da chave carregados; sugere o 'flash'");
  await p.click("#btn-ai-save");
  await p.waitForFunction(() => !document.querySelector("[data-ai=classify]").disabled, null, { timeout: 5000 }).catch(() => {});
  check(!(await p.$eval("[data-ai=classify]", (b) => b.disabled)), "com chave e modelo: botões habilitados");

  // 1) Classificação
  await p.click("[data-ai=classify]");
  await p.waitForSelector("#ai-results:not([hidden])");
  check(await p.$$eval("#ai-list li", (l) => l.length) === 2, "2 sugestões de classificação");
  check(!sent[0].includes("Metal Alfa") && sent[0].includes("[CLIENTE]"), "nome do cliente NÃO enviado (anonimizado)");
  check(!sent[0].includes('"elemento":"Corte"'), "elemento já classificado não é reenviado");
  await p.uncheck("#ai-list li:nth-child(2) input");
  await p.click("#btn-ai-apply");
  check(await p.inputValue("#chrono-tbody tr:nth-child(2) [data-field=value]") === "NA", "sugestão aceita aplicada (Não agrega)");
  check(await p.inputValue("#chrono-tbody tr:nth-child(2) [data-field=waste]") === "movimentacao", "desperdício aplicado (Movimentação)");
  check(await p.inputValue("#chrono-tbody tr:nth-child(3) [data-field=value]") === "", "sugestão desmarcada NÃO aplicada");

  // 2) Kaizen
  await p.click("[data-ai=kaizen]");
  await p.waitForSelector("#ai-results:not([hidden])");
  await p.click("#btn-ai-apply");
  check(await p.inputValue("#chrono-tbody tr:nth-child(2) [data-field=kaizen]") === "Eliminar: Endereçar peças com 5S", "ação Kaizen (ECRS) aplicada");

  // 3) Constatações
  await p.click("[data-ai=notes]");
  await p.waitForSelector("#ai-notes:not([hidden])");
  const draft = await p.inputValue("#ai-notes");
  check(draft.includes("Metal Alfa") && !draft.includes("[CLIENTE]"), "rascunho volta com o nome real do cliente");
  await p.click("#btn-ai-apply");
  check((await p.inputValue("#study-notes")).startsWith("PRINCIPAIS CONSTATAÇÕES"), "constatações aplicadas ao estudo");

  // 4) Padronizar nomes
  await p.click("[data-ai=names]");
  await p.waitForSelector("#ai-results:not([hidden])");
  check((await p.textContent("#ai-list")).includes('Renomear: "anotar a OP"'), "sugere padronizar 'anotar a OP' → 'Anotar OP'");
  await p.click("#btn-ai-apply");
  check(await p.inputValue("#chrono-tbody tr:nth-child(4) [data-field=description]") === "Anotar OP", "variante renomeada para o nome padrão");
  check(await p.$$eval("#summary-tbody tr", (r) => r.length) === 3, "resumo agrupa os nomes padronizados (3 elementos)");

  // 5) Pergunta livre
  await p.fill("#ai-question", "O que atacar primeiro no Metal Alfa?");
  await p.click("[data-ai=ask]");
  await p.waitForSelector("#ai-notes:not([hidden])");
  check((await p.inputValue("#ai-notes")).includes("Metal Alfa"), "resposta exibida com o nome real");
  check(sent[sent.length - 1].includes("Pergunta: O que atacar primeiro no [CLIENTE]?"), "pergunta enviada anonimizada");
  check(await p.isHidden("#btn-ai-apply") && (await p.isVisible("#btn-ai-append")), "resposta: só 'acrescentar às constatações'");

  // Persistência da configuração e do estudo
  await p.click("#btn-ai-close");
  await p.evaluate(() => LeanApp.flushSave());
  await p.reload();
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  check(await p.inputValue("#chrono-tbody tr:nth-child(2) [data-field=value]") === "NA", "classificação preservada após recarregar");
  await p.click("#btn-ai"); await p.waitForSelector("#ai-dialog[open]");
  check(await p.inputValue("#ai-key") === "CHAVE-TESTE", "chave lembrada neste navegador");
  const json = await p.evaluate(() => JSON.stringify(LeanApp.state.study));
  check(!json.includes("CHAVE-TESTE"), "chave NÃO gravada no arquivo do estudo");

  // 6) Resumo executivo do MFV (usa a mesma configuração da IA)
  await p.click("#btn-ai-close");
  await p.click(".app-nav a[href='mfv.html']");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Metal Alfa"); await p.fill("#new-family", "Suportes");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc);
  await p.fill("#demand-monthly", "8800");
  await p.click("#btn-add-manual-step");
  await p.fill("#steps-tbody tr:last-child [data-field=name]", "Montagem");
  await p.fill("#steps-tbody tr:last-child [data-field=tc]", "1");
  await p.click("#btn-mfv-ai");
  await p.waitForFunction(() => document.getElementById("mfv-ai-text").value.length > 0, null, { timeout: 8000 });
  check((await p.inputValue("#mfv-ai-text")).includes("Metal Alfa"), "MFV: resumo executivo gerado com o nome real");
  check(sent[sent.length - 1].includes("RESUMO EXECUTIVO") && !sent[sent.length - 1].includes("Metal Alfa"), "MFV: pedido anonimizado");
  await p.click("#btn-mfv-ai-append");
  check((await p.inputValue("#mfv-notes")).startsWith("• Situação"), "MFV: resumo aplicado às premissas");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
