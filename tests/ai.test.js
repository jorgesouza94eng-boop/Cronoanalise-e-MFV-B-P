/**
 * Testes do assistente de IA (js/ai.js): pedidos, anonimização e leitura das respostas.
 * A API do Gemini é simulada (sem rede e sem chave real).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");
const A = require("../js/ai.js");

function study() {
  const s = C.createStudy({ clientName: "Laje Forte", processName: "Corte" });
  s.elements = [
    { description: "Corte das treliças", videoTime: "30", value: "AG" },
    { description: "Procurando peças da Laje Forte", videoTime: "50" },
    { description: "Transporte de material", videoTime: "1:10", type: "A", value: "NA", waste: "transporte" },
    { description: "Anotar OP", videoTime: "1:20", value: "IN" },
  ].map((e) => C.createElement(e));
  s.notes = "Cliente Laje Forte pediu foco em movimentação.";
  return s;
}

test("anonimização: troca só o nome completo do cliente (sem estragar descrições)", () => {
  const s = { clientName: "Laje Forte", processName: "Corte" };
  assert.equal(A.anonymizeText("Peças da LAJE  FORTE", s), "Peças da [CLIENTE]");
  assert.equal(A.anonymizeText("Preparação da forma de lajes", s), "Preparação da forma de lajes");
  assert.equal(A.anonymizeText("Corte das treliças", s), "Corte das treliças", "nome do posto não altera elementos");
});

test("classificação: envia só elementos sem valor e sem o nome do cliente", () => {
  const s = study();
  const p = A.buildClassifyPrompt(s, C.computeStudy(s), true);
  assert.equal(p.count, 1);
  assert.deepEqual(p.names, ["Procurando peças da Laje Forte"]);
  assert.ok(p.text.includes("Procurando peças da [CLIENTE]"));
  assert.ok(!/Laje Forte/i.test(p.text), "cliente não enviado");
  assert.ok(p.text.includes('"posto":"[POSTO]"'));
  const plain = A.buildClassifyPrompt(s, C.computeStudy(s), false);
  assert.ok(plain.text.includes("Laje Forte"), "sem anonimização envia o nome");
});

test("classificação: resposta validada e casada com o nome original", () => {
  const s = study();
  const reply = '```json\n{"itens":[{"elemento":"Procurando peças da [CLIENTE]","valor":"na","desperdicio":"movimentacao","justificativa":"Busca é desperdício"},' +
    '{"elemento":"Elemento inventado","valor":"AG"},{"elemento":"Procurando peças da [CLIENTE]","valor":"XX"}]}\n```';
  const out = A.parseClassify(reply, ["Procurando peças da Laje Forte"], s, true);
  assert.deepEqual(out, [{ name: "Procurando peças da Laje Forte", value: "NA", waste: "movimentacao", why: "Busca é desperdício" }]);
});

test("classificação: desperdício inválido é descartado; Agrega não leva desperdício", () => {
  const s = study();
  const out = A.parseClassify('{"itens":[{"elemento":"Anotar OP","valor":"AG","desperdicio":"espera"},{"elemento":"X","valor":"IN","desperdicio":"nada"}]}', ["Anotar OP", "X"], s, false);
  assert.deepEqual(out.map((o) => [o.value, o.waste]), [["AG", ""], ["IN", ""]]);
});

test("Kaizen: pede ações só para Não agrega/Incidental e lê ECRS", () => {
  const s = study();
  const p = A.buildKaizenPrompt(s, C.computeStudy(s), true);
  assert.deepEqual(p.names.sort(), ["Anotar OP", "Transporte de material"]);
  const out = A.parseKaizen('{"itens":[{"elemento":"Transporte de material","ecrs":"eliminar","acao":"Abastecer no ponto de uso com kanban"}]}', p.names, s, true);
  assert.deepEqual(out, [{ name: "Transporte de material", text: "Eliminar: Abastecer no ponto de uso com kanban" }]);
});

test("constatações: pedido com números da compilação, anotações anonimizadas e retorno com os nomes reais", () => {
  const s = study();
  const p = A.buildNotesPrompt(s, C.computeStudy(s), true);
  assert.ok(p.text.includes('"por_valor"') && p.text.includes("Transporte"));
  assert.ok(!/Laje Forte/i.test(p.text));
  assert.equal(A.restoreNames("Visita ao [CLIENTE], posto [POSTO].", s), "Visita ao Laje Forte, posto Corte.");
});

test("JSON: aceita bloco ```json e texto ao redor; erro claro quando inválido", () => {
  assert.deepEqual(A.extractJson('Segue:\n{"itens":[]}\nfim'), { itens: [] });
  assert.throws(() => A.extractJson("sem json"), /JSON válido/);
});

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  f.calls = calls;
  return f;
}

test("API: lista modelos de texto da chave e sugere um 'flash' estável", async () => {
  const f = fakeFetch(() => ({
    status: 200,
    body: {
      models: [
        { name: "models/gemini-x-pro", displayName: "Gemini X Pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-x-flash", displayName: "Gemini X Flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-x-flash-preview", displayName: "Preview", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-1", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
      ],
    },
  }));
  const models = await A.listModels("CHAVE", f);
  assert.deepEqual(models.map((m) => m.id), ["gemini-x-pro", "gemini-x-flash", "gemini-x-flash-preview"]);
  assert.equal(A.pickDefaultModel(models), "gemini-x-flash");
  assert.equal(f.calls[0].init.headers["x-goog-api-key"], "CHAVE", "chave no cabeçalho, não na URL");
  assert.ok(!f.calls[0].url.includes("CHAVE"));
});

test("API: generateContent com JSON e tratamento de erros", async () => {
  const ok = fakeFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '{"itens":[]}' }] } }] } }));
  const text = await A.generate({ apiKey: "K", model: "gemini-x-flash" }, "olá", { json: true }, ok);
  assert.equal(text, '{"itens":[]}');
  const body = JSON.parse(ok.calls[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.match(ok.calls[0].url, /models\/gemini-x-flash:generateContent$/);

  const bad = fakeFetch(() => ({ status: 400, body: { error: { message: "API key not valid" } } }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", {}, bad), /Chave de API inválida/);
  const quota = fakeFetch(() => ({ status: 429, body: {} }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", {}, quota), /Limite de uso/);
  const blocked = fakeFetch(() => ({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", {}, blocked), /bloqueado/);
  await assert.rejects(A.generate({ apiKey: "", model: "m" }, "x", {}, ok), /Cadastre a chave/);
});
