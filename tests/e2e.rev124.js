/**
 * Teste de ponta a ponta da REV 1.24 (Playwright): fluxograma do processo (estado presente) no
 * MFV — desenho a partir das etapas e dos estoques, gargalo, Kaizen, etapa não medida, "Mostrar
 * dados", posição dos estoques, atualização automática e exportação em PNG. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev124.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanMfvApp */ // existe apenas dentro da página testada
const { chromium } = require("playwright");
const M = require("../js/mfv-calc.js");

const base = process.argv[2] || "http://127.0.0.1:8080/";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("dialog", (d) => d.accept());
  const txt = async (sel) => (await p.textContent(sel)).trim();
  console.log(`== REV 1.24 ${base}`);

  const d = M.createMfv({ clientName: "Jeans Teste", family: "Calças" });
  d.demandMonthly = "4400";
  d.workDaysMonth = "22";
  d.steps = [
    M.createStep({ name: "Bater uso nas calças", tcManualMin: 0.5, operators: "1" }),
    M.createStep({ name: "Grampear frente da calça", tcManualMin: 1.2, operators: "1", kaizen: true }),
    M.createStep({ name: "Desgastar barras e bolsos da calça", tcManualMin: 0.8, operators: "2" }),
    M.createStep({ name: "Lavar e secar calças", unmeasured: true }),
  ];
  d.inventories[0].quantity = "400";
  d.inventories.push(M.createInventory({ name: "Fila do grampo", quantity: "100" }));
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  check(/^REV 1\.(2[4-9]|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.24");
  await p.setInputFiles("#input-import-mfv", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(d)) });
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Calças");
  await p.waitForSelector("#flow-chart svg");

  const svgText = () => p.$eval("#flow-chart svg", (s) => Array.from(s.querySelectorAll("text")).map((t) => t.textContent).join(" | "));
  const t1 = await svgText();
  check(["1. Bater uso nas", "2. Grampear frente", "4. Lavar e secar", "Matéria-prima", "Produto acabado"].every((x) => t1.includes(x)), "etapas e estoques no desenho");
  check(t1.includes("Gargalo") && t1.includes("✸ Kaizen") && t1.includes("não medida"), "selos de gargalo, Kaizen e etapa não medida");
  check(t1.includes("TC: 1,200 min") && t1.includes("Nº ops: 2") && t1.includes("% do takt"), "dados das etapas (TC, Nº ops, % do takt)");
  check(t1.includes("400 pç") && t1.includes("2,00 dia(s)"), "estoque com quantidade e dias (400 ÷ 200/dia)");
  check(await p.$$eval("#flow-chart polygon", (l) => l.length) === 2, "2 estoques posicionados (△): matéria-prima e produto acabado");
  check(await p.$eval("#flow-chart rect[stroke='#dc2626']", (r) => !!r), "caixa do gargalo em vermelho");
  check(await p.$eval("#flow-chart rect[stroke-dasharray]", (r) => !!r), "etapa não medida tracejada");
  check((await txt("#flow-timeline")).includes("Lead time: 2,50 dia(s) em estoques + tempo de processamento 2,500 min"), "linha do tempo: " + (await txt("#flow-timeline")));
  check((await txt("#flow-unplaced")).includes("Fila do grampo"), "estoque sem posição avisado (não é desenhado)");

  // Posição do estoque: antes da etapa 3
  await p.selectOption("#inventory-tbody tr:nth-child(3) select.flow-pos", { label: "Antes de 3. Desgastar barras e bolsos da calça" });
  await p.waitForFunction(() => document.querySelectorAll("#flow-chart polygon").length === 3);
  check(await p.isHidden("#flow-unplaced"), "estoque posicionado: aviso some");
  const order = await p.evaluate(() => {
    const M2 = window.LeanMfv;
    return M2.flowchartModel(LeanMfvApp.state.computed).nodes.map((n) => (n.kind === "step" ? n.step.seq : n.inv.name)).join(",");
  });
  check(order === "Matéria-prima,1,2,Fila do grampo,3,4,Produto acabado", "ordem no fluxo: " + order);

  // Atualiza sozinho ao renomear a etapa; o seletor de posição acompanha
  await p.fill("#steps-tbody tr:nth-child(1) [data-field=name]", "Bater uso");
  await p.waitForFunction(() => document.querySelector("#flow-chart svg").textContent.includes("1. Bater uso"));
  check(!(await svgText()).includes("Bater uso nas"), "renomear a etapa atualiza o desenho");

  // Mostrar dados
  await p.uncheck("#flow-show-data");
  check(!(await svgText()).includes("TC:") && (await p.evaluate(() => LeanMfvApp.state.doc.flowShowData)) === false, "sem dados: só caixas, setas e estoques (opção salva no MFV)");
  await p.check("#flow-show-data");

  // PNG
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btn-flow-png")]);
  check(/^Fluxograma_Jeans_Teste_Calcas\.png$|^Fluxograma_Jeans_Teste_Cal.*\.png$/.test(dl.suggestedFilename()), "PNG exportado: " + dl.suggestedFilename());
  const buf = require("fs").readFileSync(await dl.path());
  check(buf.slice(1, 4).toString() === "PNG" && buf.length > 5000, "arquivo PNG válido (" + buf.length + " bytes)");

  // Celular: o desenho rola de lado, a página não
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(400);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular: página sem rolagem horizontal");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
