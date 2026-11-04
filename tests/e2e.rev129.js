/**
 * Teste de ponta a ponta da REV 1.29 (Playwright): empresa com grafias diferentes ("R F" ×
 * "R. F.") reconhecida como a mesma; renomear a empresa em todos os documentos ao mudar o
 * cliente no cabeçalho do MFV (com a pergunta) e pelo botão "Renomear empresa" da lista de
 * estudos. Dados fictícios.
 * Uso: npm start (outro terminal) e depois
 *   node tests/e2e.rev129.js http://127.0.0.1:8080/
 * Variável opcional: CHROMIUM_PATH=/caminho/do/chrome
 */
/* global LeanApp, LeanMfvApp, LeanStorage, DOMException */ // existem apenas dentro das páginas testadas
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
  const dialogs = [];
  let promptAnswer = "";
  let confirmAnswer = true;
  p.on("dialog", (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    if (d.type() === "prompt") return d.accept(promptAnswer);
    return d.type() === "confirm" && !confirmAnswer ? d.dismiss() : d.accept();
  });
  const txt = async (sel) => (await p.textContent(sel)).trim();
  const clients = () =>
    p.evaluate(async () => {
      const out = {};
      for (const st of [undefined, LeanStorage.STORE_MFV]) {
        (await LeanStorage.listLocal(st)).forEach((r) => (out[r.study.processName || r.study.family] = r.study.clientName));
      }
      return out;
    });
  console.log(`== REV 1.29 ${base}`);

  // Dois estudos da empresa "R F DE ASSIS" e um de outra empresa
  const study = (client, process) => {
    const s = C.createStudy({ clientName: client, processName: process });
    s.elements = [C.createElement({ description: "Modelar", videoTime: "10", quantity: "1", type: "C", value: "AG" })];
    return s;
  };
  const s1 = study("R F DE ASSIS", "Pães");
  const s2 = study("r f de assis", "Roscas");
  const s3 = study("Outra Indústria", "Corte");
  await p.goto(base + "index.html");
  await p.waitForSelector("#study-dialog[open]");
  check(/^REV 1\.(29|[3-9]\d)$/.test(await txt(".app-header .app-rev")), "rótulo da revisão REV 1.29");
  for (const s of [s3, s2, s1]) {
    await p.setInputFiles("#input-import-json", { name: "s.json", mimeType: "application/json", buffer: Buffer.from(C.serializeStudy(s)) });
    await p.waitForFunction((id) => LeanApp.state.study && LeanApp.state.study.id === id, s.id);
  }
  await p.evaluate(() => LeanApp.flushSave && LeanApp.flushSave());

  // A) MFV "R. F. DE ASSIS" com etapa do estudo "R F DE ASSIS": mesma empresa, sem aviso
  const d = M.createMfv({ clientName: "R. F. DE ASSIS", family: "Pães e Salgados" });
  d.steps = [M.createStep({ name: "Pães", studyId: s1.id, tcManualMin: 0.2 })];
  await p.goto(base + "mfv.html");
  await p.waitForSelector("#doc-dialog[open]");
  await p.setInputFiles("#input-import-mfv", { name: "m.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(d)) });
  await p.waitForFunction(() => window.LeanMfvApp && LeanMfvApp.state.doc && LeanMfvApp.state.doc.family === "Pães e Salgados");
  await p.waitForTimeout(400);
  check(!(await p.textContent("body")).includes("Etapa de outra empresa"), "A: \"R. F. DE ASSIS\" = \"R F DE ASSIS\" (sem aviso de outra empresa)");

  // B) Mudar o cliente no cabeçalho do MFV: "Cancelar" muda só o MFV
  confirmAnswer = false;
  await p.click("#mfv-client");
  await p.fill("#mfv-client", "R F de Assis Ltda");
  await p.press("#mfv-client", "Tab");
  await p.waitForFunction(() => true);
  await p.waitForTimeout(400);
  const ask = dialogs.find((x) => x.type === "confirm");
  check(!!ask && ask.message.includes('Aplicar "R F de Assis Ltda" também aos outros 2 documento(s)') && ask.message.includes("2 estudo(s)"), "B: pergunta com os 2 estudos da empresa: " + (ask ? ask.message.split("\n")[2] : "sem pergunta"));
  check(!ask.message.includes("Outra"), "B: estudo de outra empresa fora da lista");
  let c = await clients();
  check(c["Pães"] === "R F DE ASSIS" && c["Roscas"] === "r f de assis", "B: Cancelar = só o documento aberto muda");

  // Volta ao nome original (a empresa "Ltda" só tem o MFV aberto: nada a perguntar)
  dialogs.length = 0;
  await p.click("#mfv-client");
  await p.fill("#mfv-client", "R. F. DE ASSIS");
  await p.press("#mfv-client", "Tab");
  await p.waitForTimeout(400);
  check(!dialogs.length, "B: sem outros documentos da empresa antiga: sem pergunta");

  // B) OK renomeia os estudos (só a grafia muda); o MFV aberto grava pelo caminho normal
  confirmAnswer = true;
  dialogs.length = 0;
  await p.click("#mfv-client");
  await p.fill("#mfv-client", "R. F. de Assis");
  await p.press("#mfv-client", "Tab");
  await p.waitForFunction(() => document.querySelector("#study-picker") && true);
  await p.waitForTimeout(600);
  check(dialogs.some((x) => x.type === "alert" && x.message.includes("2 documento(s) renomeado(s)")), "B: aviso de 2 documentos renomeados");
  c = await clients();
  check(c["Pães"] === "R. F. de Assis" && c["Roscas"] === "R. F. de Assis" && c["Corte"] === "Outra Indústria", "B: estudos da empresa renomeados; outra empresa intacta: " + JSON.stringify(c));
  await p.evaluate(() => LeanMfvApp.flushSave && LeanMfvApp.flushSave());
  await p.waitForFunction(async () => (await LeanStorage.listLocal(LeanStorage.STORE_MFV)).some((r) => r.study.clientName === "R. F. de Assis"));
  check(!(await p.textContent("body")).includes("Etapa de outra empresa"), "B: MFV continua sem aviso de outra empresa");

  // C) Botão "Renomear empresa" na lista de estudos; o estudo aberto muda pelo campo
  await p.goto(base + "index.html");
  await p.waitForFunction(() => window.LeanApp && LeanApp.state.study);
  await p.click("#btn-studies");
  await p.waitForSelector("#study-dialog[open]");
  await p.waitForSelector("select.company-filter");
  check(await p.$$eval("select.company-filter option", (o) => o.length) === 3, "lista: 2 empresas (todas + 2)");
  check(await p.isHidden("button.btn-rename-company"), "C: botão escondido com o filtro em \"todas\"");
  const val = await p.$eval("select.company-filter", (s) => Array.from(s.options).find((o) => o.textContent.startsWith("R. F. de Assis")).value);
  await p.selectOption("select.company-filter", val);
  check(await p.isVisible("button.btn-rename-company"), "C: botão aparece com a empresa escolhida");
  const openId = await p.evaluate(() => LeanApp.state.study.id);
  promptAnswer = "RF Assis Panificadora";
  dialogs.length = 0;
  await p.click("button.btn-rename-company");
  await p.waitForFunction(() => document.getElementById("client-name").value === "RF Assis Panificadora");
  await p.evaluate(() => LeanApp.flushSave && LeanApp.flushSave());
  await p.waitForTimeout(400);
  c = await clients();
  check(c["Pães"] === "RF Assis Panificadora" && c["Roscas"] === "RF Assis Panificadora" && c["Pães e Salgados"] === "RF Assis Panificadora", "C: estudos e MFV renomeados: " + JSON.stringify(c));
  check(openId === s1.id && (await p.evaluate(() => LeanApp.state.study.clientName)) === "RF Assis Panificadora", "C: estudo aberto atualizado na tela");
  check(dialogs.some((x) => x.type === "confirm" && x.message.includes("MFV(s)")), "C: pergunta lista também o MFV");
  check(c["Corte"] === "Outra Indústria", "C: outra empresa intacta");

  // D) Pasta conectada (simulada): grava com revisão + 1 na subpasta nova, tira da antiga e
  //    deixa de fora arquivados e cópias de conflito
  const fs = await p.evaluate(async () => {
    const notFound = () => new DOMException("não encontrado", "NotFoundError");
    function makeDir(name) {
      const files = new Map();
      const dirs = new Map();
      const fh = (n) => ({
        kind: "file", name: n,
        async getFile() { const t = files.get(n); return { text: async () => t }; },
        async createWritable() { let b = ""; return { async write(x) { b += x; }, async close() { files.set(n, b); }, async abort() {} }; },
      });
      return {
        kind: "directory", name, files, dirs,
        async queryPermission() { return "granted"; },
        async requestPermission() { return "granted"; },
        async getFileHandle(n, o) { if (!files.has(n)) { if (!(o && o.create)) throw notFound(); files.set(n, ""); } return fh(n); },
        async getDirectoryHandle(n, o) { if (!dirs.has(n)) { if (!(o && o.create)) throw notFound(); dirs.set(n, makeDir(n)); } return dirs.get(n); },
        async removeEntry(n) { if (!files.delete(n)) throw notFound(); },
        async *values() { for (const n of files.keys()) yield fh(n); for (const x of dirs.values()) yield x; },
      };
    }
    const root = makeDir("B+P");
    const old = await root.getDirectoryHandle("Padaria_Sol", { create: true });
    const arq = await old.getDirectoryHandle("_Arquivo", { create: true });
    const doc = (id, file, rev) => JSON.stringify({ id, fileName: file, clientName: "Padaria Sol", processName: id, revision: rev, updatedAt: "2026-11-01T10:00:00Z", elements: [] });
    old.files.set("Crono_Padaria_Sol_Forno_2026-11-01_aaaa1111.json", doc("forno", "Crono_Padaria_Sol_Forno_2026-11-01_aaaa1111.json", 3));
    old.files.set("Crono_Padaria_Sol_Forno_2026-11-01_aaaa1111_conflito_20261101-1000.json", doc("forno", "x", 2));
    arq.files.set("Crono_Padaria_Sol_Velho_2026-10-01_bbbb2222.json", doc("velho", "Crono_Padaria_Sol_Velho_2026-10-01_bbbb2222.json", 1));
    root.files.set("Crono_Padaria_Sol_Mesa_2026-11-01_cccc3333.json", doc("mesa", "Crono_Padaria_Sol_Mesa_2026-11-01_cccc3333.json", 5)); // solto (versão anterior)
    await LeanStorage.useDirectoryHandle(root);
    const forno = JSON.parse(doc("forno", "Crono_Padaria_Sol_Forno_2026-11-01_aaaa1111.json", 3));
    await LeanStorage.putLocal({ id: "forno", study: forno, diskRevision: 3, dirty: false });
    const res = await LeanStorage.renameCompany("padaria sol", "Padaria do Sol");
    const nd = root.dirs.get("Padaria_do_Sol");
    const rec = await LeanStorage.getLocal("forno");
    await LeanStorage.deleteLocal("forno");
    return {
      count: res.count,
      errors: res.errors.length,
      newFiles: nd ? Array.from(nd.files.keys()).sort() : [],
      oldFiles: Array.from(old.files.keys()),
      forno: nd ? JSON.parse(nd.files.get("Crono_Padaria_Sol_Forno_2026-11-01_aaaa1111.json")) : null,
      archived: JSON.parse(arq.files.get("Crono_Padaria_Sol_Velho_2026-10-01_bbbb2222.json")).clientName,
      loose: root.files.size,
      local: { name: rec.study.clientName, diskRevision: rec.diskRevision, dirty: rec.dirty },
    };
  });
  check(fs.count === 2 && fs.errors === 0, "D: 2 documentos renomeados na pasta (estudo + arquivo solto)");
  check(fs.newFiles.join(",") === "Crono_Padaria_Sol_Forno_2026-11-01_aaaa1111.json,Crono_Padaria_Sol_Mesa_2026-11-01_cccc3333.json", "D: arquivos na subpasta nova Padaria_do_Sol: " + fs.newFiles.join(", "));
  check(fs.forno && fs.forno.clientName === "Padaria do Sol" && fs.forno.revision === 4, "D: nome novo e revisão 3 → 4");
  check(fs.oldFiles.length === 1 && fs.oldFiles[0].includes("_conflito_") && fs.loose === 0, "D: saíram da subpasta antiga e da principal; cópia de conflito fica");
  check(fs.archived === "Padaria Sol", "D: arquivado (_Arquivo) não muda");
  check(fs.local.name === "Padaria do Sol" && fs.local.diskRevision === 4 && !fs.local.dirty, "D: registro do navegador acompanha a revisão (sem conflito na próxima gravação)");

  check(errors.length === 0, "nenhum erro no console" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `${failures} FALHA(S)` : "TUDO OK");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
