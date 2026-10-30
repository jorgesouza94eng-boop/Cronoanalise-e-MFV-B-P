/**
 * Teste de ponta a ponta da REV 1.20 (Playwright, Gemini SIMULADO): sugestão Kaizen da IA com
 * todos os produtos e etapas, resposta pelo id, novo pedido dos elementos que faltaram, "sem
 * ação", confiança baixa desmarcada, aplicação no elemento certo e ferramenta levada ao Plano
 * 5W2H. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev120.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanPlanoApp */ // existem apenas dentro das páginas testadas
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

  // Gemini simulado: 1ª chamada "esquece" o último id; a 2ª (só os faltantes) responde
  const sent = [];
  await p.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    if (req.url().includes("/models?")) {
      return route.fulfill({ json: { models: [{ name: "models/gemini-teste-flash", displayName: "Flash", supportedGenerationMethods: ["generateContent"] }] } });
    }
    const body = JSON.parse(req.postData());
    const prompt = body.contents[0].parts[0].text;
    sent.push(body);
    const items = JSON.parse(prompt.match(/ELEMENTOS: (\[.*\])\n/)[1]);
    const answer = (it) => {
      if (it.elemento === "Abrir a massa") return { id: it.id, sem_acao: false, ecrs: "Simplificar", ferramenta: "padronizado", acao: "Usar gabarito de espessura na laminação", justificativa: "Maior % do ciclo", confianca: "baixa" };
      if (it.elemento === "Modelar") return { id: it.id, sem_acao: true, falta_observar: "Filmar o método de outro operador" };
      return { id: it.id, sem_acao: false, ecrs: "Eliminar", ferramenta: "5s", acao: `Deixar bandejas junto à etapa ${it.etapa || "do posto"}`, justificativa: `${it.tempo_no_ciclo} s/pç`, confianca: "alta" };
    };
    const list = sent.length === 1 ? items.slice(0, -1) : items;
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ itens: list.map(answer) }) }] } }] } });
  });

  console.log(`== REV 1.20 ${base}`);
  const s = C.createStudy({ clientName: "Kaizen Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Pão", "Laminação", "Abrir a massa", "C", "10", "40", "AG"],
    ["Pão", "Laminação", "Pegar bandeja", "A", "1", "50", "NA"],
    ["Pão", "Enrolar", "Enrolar", "C", "10", "150", "AG"],
    ["Pão", "Enrolar", "Pegar bandeja", "A", "1", "200", "NA"],
    ["Rosca", "Laminação", "Pegar bandeja", "A", "1", "220", "IN"],
    ["Rosca", "Laminação", "Modelar", "C", "10", "300", ""],
  ].map(([product, etapa, description, type, quantity, videoTime, value]) => C.createElement({ product, etapa, description, type, quantity, videoTime, value }));
  s.filmPieces = { inicio: "10" };
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(2\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.20");
  await p.setInputFiles("#input-import-json", { name: "k.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study && LeanApp.state.study.processName === "Bancada");

  await p.click("#btn-ai");
  await p.waitForSelector("#ai-dialog[open]");
  await p.fill("#ai-key", "CHAVE-TESTE");
  await p.click("#btn-ai-models");
  await p.waitForFunction(() => document.querySelectorAll("#ai-model option").length === 1);
  await p.click("#btn-ai-save");
  await p.waitForFunction(() => !document.querySelector("[data-ai=kaizen]").disabled);

  // Padrão (só NA/IN): os 3 "Pegar bandeja" (2 do Pão, em etapas diferentes, e 1 da Rosca)
  await p.click("[data-ai=kaizen]");
  await p.waitForSelector("#ai-results:not([hidden])");
  await p.waitForFunction(() => document.getElementById("ai-status").textContent.includes("sugestão"));
  const status1 = await txt("#ai-status");
  check(sent.length === 2, "faltou 1 elemento na 1ª resposta: pediu de novo só ele (2 chamadas)");
  check(JSON.parse(sent[1].contents[0].parts[0].text.match(/ELEMENTOS: (\[.*\])\n/)[1]).length === 1, "2º pedido só com o elemento que faltou");
  check(sent[0].generationConfig.temperature === 0.2 && !!sent[0].generationConfig.responseSchema, "esquema JSON e temperatura 0,2");
  check(!JSON.stringify(sent).includes("Kaizen Teste"), "cliente não enviado (anonimização)");
  check(await p.$$eval("#ai-list li", (l) => l.length) === 3, "3 sugestões (uma por elemento, por produto e etapa)");
  check(status1.includes('2 "Agrega"') && status1.includes("1 sem classificação"), "status informa o que ficou fora: " + status1);
  check((await txt("#ai-list li:nth-child(1)")).includes("Pão • Laminação"), "sugestão mostra produto e etapa");
  await p.click("#btn-ai-apply");
  const kz = () => p.evaluate(() => LeanApp.state.study.elements.map((e) => (e.kaizen ? `${e.kaizen} [${e.kaizenTool}]` : "-")));
  const k1 = await kz();
  check(k1[1] === "Eliminar: Deixar bandejas junto à etapa Laminação [5s]" && k1[3] === "Eliminar: Deixar bandejas junto à etapa Enrolar [5s]" && k1[4].startsWith("Eliminar: Deixar bandejas junto à etapa Laminação"), "cada ação no seu elemento (Pão/Laminação, Pão/Enrolar, Rosca): " + k1.join(" | "));

  // Incluir Agrega e sem classificação: só os que ainda não têm ação
  sent.length = 0;
  await p.check("#ai-kaizen-all");
  await p.click("[data-ai=kaizen]");
  await p.waitForFunction(() => document.getElementById("ai-status").textContent.includes("sugestão"));
  const names = await p.$$eval("#ai-list li .ai-item-title", (l) => l.map((x) => x.textContent));
  check(names.length === 3 && names.some((n) => n.startsWith("Modelar")) && !names.some((n) => n.startsWith("Pegar bandeja")), "com a opção: Agrega e sem classificação; os com ação ficam fora: " + names.join(" | "));
  check((await txt("#ai-status")).includes("3 já com ação"), "status: 3 já com ação");
  const boxes = await p.$$eval("#ai-list li input", (l) => l.map((i) => `${i.checked ? 1 : 0}${i.disabled ? "d" : ""}`));
  const idx = (n) => names.findIndex((x) => x.startsWith(n));
  check(boxes[idx("Abrir a massa")] === "0" && boxes[idx("Modelar")] === "0d" && boxes[idx("Enrolar")] === "1", "confiança baixa desmarcada; sem ação desabilitada: " + boxes.join(","));
  check((await txt(`#ai-list li:nth-child(${idx("Modelar") + 1})`)).includes("Filmar o método de outro operador"), "sem ação mostra o que observar");
  await p.click("#btn-ai-apply");
  const k2 = await kz();
  check(k2[0] === "-" && k2[5] === "-" && k2[2].startsWith("Eliminar: Deixar bandejas junto à etapa Enrolar"), "só as marcadas aplicadas: " + k2.join(" | "));
  await p.click("#btn-ai-close");

  // Ação apagada: a ferramenta sai junto
  await p.fill("#chrono-tbody tr:nth-child(3) [data-field=kaizen]", "");
  check(await p.evaluate(() => LeanApp.state.study.elements[2].kaizenTool) === "", "ação apagada limpa a ferramenta");
  await p.evaluate(() => LeanApp.flushSave && LeanApp.flushSave());

  // Plano 5W2H recebe a ferramenta
  await p.goto(base + "plano.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.fill("#new-client", "Kaizen Teste");
  await p.click("#new-doc-form button[type=submit]");
  await p.waitForFunction(() => LeanPlanoApp.state.doc);
  await p.click("#btn-from-crono");
  await p.waitForSelector("#crono-dialog[open]");
  await p.click("#btn-crono-all");
  await p.click("#btn-crono-add");
  const tools = await p.evaluate(() => LeanPlanoApp.state.doc.actions.map((a) => a.tool));
  check(tools.length === 3 && tools.every((t) => t === "5s"), "ações no plano com a ferramenta 5S: " + tools.join(","));

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
