/**
 * Teste de ponta a ponta no navegador (Chromium via Playwright).
 * Não faz parte do "npm test" para manter o projeto sem dependências.
 *
 * Uso:
 *   npm install --no-save playwright && npx playwright install chromium
 *   npm start                                   # em outro terminal (http://127.0.0.1:8080)
 *   node tests/e2e.browser.js http://127.0.0.1:8080/index.html          # desktop + pasta simulada (OPFS)
 *   node tests/e2e.browser.js http://127.0.0.1:8080/index.html mobile   # modo celular
 *   node tests/e2e.browser.js                                            # abre via file://
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp */ // existe apenas dentro da página testada
const path = require("path");
const { chromium } = require("playwright");
const APP = path.resolve(__dirname, "..");
const base = process.argv[2] || "file://" + path.join(APP, "index.html");
const mobile = process.argv[3] === "mobile";
let failures = 0;
const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALHA ") + msg); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 } });
  if (mobile) await ctx.addInitScript(() => { delete window.showDirectoryPicker; delete Window.prototype.showDirectoryPicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());

  console.log(`== ${base} ${mobile ? "(modo celular)" : ""}`);
  await page.goto(base);
  await page.waitForSelector("#study-dialog[open]");
  check(await page.evaluate(() => document.activeElement.id) === "new-client", "1ª execução abre o gerenciador com foco em 'Empresa'");

  await page.keyboard.type("Indústria Metalúrgica Alfa");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Montagem Final - Posto 01");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#study-dialog:not([open])", { state: "attached" });
  const fileName = await page.evaluate(() => LeanApp.state.study.fileName);
  check(/^Crono_Industria_Metalurgica_Alfa_Montagem_Final_Posto_01_\d{4}-\d\d-\d\d_[0-9a-f]{8}\.json$/.test(fileName), "nome do arquivo: " + fileName);
  check(await page.evaluate(() => document.activeElement.dataset.field) === "description", "foco na descrição da linha 1");

  // Fluxo só teclado
  const typeRow = async (desc, time, pace) => {
    await page.keyboard.type(desc); await page.keyboard.press("Enter");
    await page.keyboard.type(time); await page.keyboard.press("Enter");
    if (pace !== undefined) { await page.keyboard.type(pace); }
    await page.keyboard.press("Enter");
  };
  await typeRow("Pegar peça", "12", "100");
  await typeRow("Soldar", "112", "110");
  check(await page.evaluate(() => document.activeElement.dataset.field === "description" && document.querySelectorAll("#chrono-tbody tr").length === 3), "Enter no ritmo cria a linha 3 e foca a descrição");
  const pace3 = await page.inputValue("#chrono-tbody tr:nth-child(3) [data-field=pace]");
  check(pace3 === "110", "nova linha herda o ritmo anterior (110)");

  // Linha 3: troca de caixa 1/50 (frequência via Tab)
  await page.keyboard.type("Trocar caixa");
  await page.keyboard.press("Tab"); // vai para freq
  check(await page.evaluate(() => document.activeElement.dataset.field) === "frequency", "Tab alcança a frequência");
  await page.keyboard.type("1/50"); await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement.dataset.field) === "videoTime", "Enter na frequência vai ao tempo final");
  await page.keyboard.type("212"); await page.keyboard.press("Enter");
  await page.keyboard.press("Control+a"); await page.keyboard.type("100"); await page.keyboard.press("Enter");

  const read = (sel) => page.textContent(sel).then((t) => t.trim());
  check(await read("#chrono-tbody tr:nth-child(2) [data-out=tsub]") === "1,000", "TS linha 2 = 1,000");
  check(await read("#chrono-tbody tr:nth-child(2) [data-out=tnorm]") === "1,100", "TN linha 2 = 1,100");
  check(await read("#chrono-tbody tr:nth-child(3) [data-out=tnorm]") === "0,020", "TN troca de caixa 1/50 = 0,020");
  check(await read("#chrono-tbody tr:nth-child(3) .tag-type") === "A", "linha 3 marcada como acíclica");
  check(await read("#total-tnorm") === "1,320", "ΣTN = 1,320");
  check(await read("#kpi-net-time") === "480,0", "TLD = 480,0");
  check(await read("#kpi-takt-time") === "2,00", "Takt = 2,00");
  check(await read("#kpi-cycle-time") === "1,39", "TP = 1,32 × 1,05 = 1,39");
  check(await read("#kpi-capacity") === "346", "Capacidade = ⌊480/1,386⌋ = 346");
  check(await read("#kpi-bottleneck") === "BALANCEADO", "status balanceado");

  // Erro de digitação "199" na linha 4
  await page.keyboard.type("Inspecionar"); await page.keyboard.press("Enter");
  await page.keyboard.type("199"); await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement.dataset.field) === "videoTime", "'199' bloqueia o avanço (foco permanece)");
  check((await read("#toast-region")).includes("Segundos"), "aviso de erro exibido");
  // Tempo menor que o anterior
  await page.keyboard.type("100"); await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement.dataset.field) === "videoTime", "tempo menor que o anterior bloqueia o avanço");
  check(await page.evaluate(() => document.querySelector("#chrono-tbody tr:nth-child(4)").classList.contains("row-error")), "linha 4 sinalizada em vermelho");
  await page.keyboard.type("312"); await page.keyboard.press("Enter");
  check(await page.evaluate(() => document.activeElement.dataset.field) === "pace", "corrigido: avança para o ritmo");
  await page.keyboard.press("Enter");

  // Gargalo: demanda 400 → takt 1,2
  await page.fill("#daily-demand", "400");
  check(await read("#kpi-bottleneck") === "GARGALO", "demanda 400 → GARGALO");
  await page.fill("#daily-demand", "0");
  check(await read("#kpi-bottleneck") === "Verificar", "demanda 0 → 'Verificar' (não gargalo)");
  await page.fill("#daily-demand", "240");

  // Ctrl+Del na linha 5 (vazia) e Ctrl+Enter
  await page.focus("#chrono-tbody tr:nth-child(5) [data-field=description]");
  await page.keyboard.press("Control+Delete");
  check(await page.$$eval("#chrono-tbody tr", (r) => r.length) === 4, "Ctrl+Del exclui a linha");
  await page.keyboard.press("Control+Enter");
  check(await page.$$eval("#chrono-tbody tr", (r) => r.length) === 5, "Ctrl+Enter cria linha");
  await page.keyboard.press("ArrowUp");
  check(await page.evaluate(() => document.activeElement.closest("tr").rowIndex) === 4, "Seta ↑ sobe uma linha");

  // Persistência: recarregar
  await page.evaluate(() => LeanApp.flushSave());
  await page.reload();
  await page.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  const tn = await read("#total-tnorm"); check(tn === "2,320", "após recarregar: dados preservados (ΣTN 0,2+1,1+0,02+1,0 = " + tn + ")");
  check(await page.inputValue("#client-name") === "Indústria Metalúrgica Alfa", "cliente preservado");

  // Exportar JSON
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export-json")]);
  check(dl.suggestedFilename() === fileName, "Exportar JSON baixa " + dl.suggestedFilename());
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export-csv")]);
  check(dl2.suggestedFilename().endsWith(".csv"), "Exportar CSV");

  const status = await read("#sync-status");
  if (mobile) {
    check(await page.isHidden("#btn-connect-folder"), "celular: botão de pasta oculto");
    check(/Salvo no navegador • exportado agora/.test(status), "celular: status '" + status + "'");
  } else {
    check(await page.isVisible("#btn-connect-folder"), "desktop: botão de pasta visível");
    check(/conecte a pasta/i.test(status), "desktop sem pasta: status '" + status + "'");

    if (base.startsWith("file:")) { console.log("  (teste de pasta via OPFS só roda em http://)"); } else {
    // Pasta simulada com OPFS (mesma API da File System Access)
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const k of root.keys()) await root.removeEntry(k);
      await LeanApp.useFolderHandle(root);
    });
    await page.waitForFunction(() => LeanApp.state.diskRevision === 1 && !LeanApp.state.dirty, null, { timeout: 8000 });
    check(/Salvo na pasta/.test(await read("#sync-status")), "pasta conectada: estudo gravado (revisão 1)");

    // Debounce: digitação não grava antes de 3 s
    await page.fill("#chrono-tbody tr:nth-child(5) [data-field=description]", "Embalar");
    await page.dispatchEvent("#chrono-tbody tr:nth-child(5) [data-field=description]", "input");
    await sleep(1500);
    check(await page.evaluate(() => LeanApp.state.diskRevision) === 1, "debounce: após 1,5 s ainda não gravou");
    await page.waitForFunction(() => LeanApp.state.diskRevision === 2, null, { timeout: 6000 });
    check(true, "debounce: gravou após ~3 s (revisão 2)");
    const diskDesc = await page.evaluate(async (fn) => {
      const root = await navigator.storage.getDirectory();
      const f = await (await root.getFileHandle(fn)).getFile();
      return JSON.parse(await f.text());
    }, fileName);
    check(diskDesc.elements[4].description === "Embalar" && diskDesc.revision === 2 && diskDesc.results.capacityPcsDay > 0, "arquivo na pasta contém a alteração e o resumo de resultados");

    // Renomear o cliente NÃO cria arquivo novo
    await page.fill("#client-name", "Alfa Renomeada");
    await page.waitForFunction(() => LeanApp.state.diskRevision === 3, null, { timeout: 6000 });
    const files = await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); const out = []; for await (const k of r.keys()) out.push(k); return out; });
    check(files.length === 1 && files[0] === fileName, "renomear cliente mantém 1 único arquivo");

    // Conflito: outro dispositivo grava revisão 4 na pasta
    await page.evaluate(async (fn) => {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle(fn);
      const data = JSON.parse(await (await fh.getFile()).text());
      data.revision = 4; data.updatedAt = new Date().toISOString(); data.elements[0].description = "Alterado no notebook B";
      const w = await fh.createWritable(); await w.write(JSON.stringify(data)); await w.close();
    }, fileName);
    await page.fill("#chrono-tbody tr:nth-child(1) [data-field=description]", "Alterado no notebook A");
    await page.waitForSelector("#conflict-banner:not([hidden])", { timeout: 6000 });
    check(true, "conflito detectado: aviso exibido");
    const after = await page.evaluate(async (fn) => {
      const root = await navigator.storage.getDirectory(); const out = [];
      for await (const k of root.keys()) out.push(k);
      const d = JSON.parse(await (await (await root.getFileHandle(fn)).getFile()).text());
      return { files: out, desc: d.elements[0].description };
    }, fileName);
    check(after.desc === "Alterado no notebook B", "arquivo do outro dispositivo NÃO foi sobrescrito");
    check(after.files.some((f) => f.includes("_conflito_")), "cópia de conflito criada: " + after.files.find((f) => f.includes("_conflito_")));
    check(/Conflito/.test(await read("#sync-status")), "status de conflito");

    await page.click("#btn-conflict-disk");
    await page.waitForSelector("#conflict-banner[hidden]", { state: "attached" });
    check(await page.inputValue("#chrono-tbody tr:nth-child(1) [data-field=description]") === "Alterado no notebook B", "'Usar versão da pasta' carrega a versão do outro dispositivo");

    // Gerenciador lista o estudo da pasta (ignora a cópia de conflito)
    await page.click("#btn-studies");
    await page.waitForSelector("#study-dialog[open]");
    const items = await page.$$eval(".study-row", (r) => r.length);
    check(items === 1, "gerenciador lista 1 estudo (cópia de conflito ignorada)");
    // Novo estudo
    await page.fill("#new-client", "Cliente Beta"); await page.fill("#new-process", "Posto 02");
    await page.click("#new-study-form button[type=submit]");
    await page.waitForFunction(() => LeanApp.state.study.clientName === "Cliente Beta" && LeanApp.state.diskRevision === 1, null, { timeout: 6000 });
    check(await page.inputValue("#daily-demand") === "240", "novo estudo herda parâmetros da jornada");
    const n = await page.evaluate(async () => { const r = await navigator.storage.getDirectory(); let c = 0; for await (const k of r.keys()) if (!k.includes("_conflito_")) c++; return c; });
    check(n === 2, "2 arquivos de estudo na pasta (1 por posto)");
    }
  }

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
