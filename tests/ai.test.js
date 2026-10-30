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

test("Kaizen (REV 1.20): por padrão só Não agrega/Incidental; opção inclui Agrega e sem classificação; ação já digitada fica de fora", () => {
  const s = study();
  const p = A.buildKaizenPrompt(s, C.computeStudy(s), true);
  assert.deepEqual(p.targets.map((t) => [t.id, t.name]), [[1, "Transporte de material"], [2, "Anotar OP"]]);
  assert.deepEqual(p.stats, { sent: 2, withAction: 0, ag: 1, unclassified: 1 });
  assert.match(A.kaizenStatsText(p.stats), /1 "Agrega", 1 sem classificação — marque "Incluir Agrega/);
  assert.equal(p.temperature, 0.2);
  assert.ok(p.schema.properties.itens.items.properties.ferramenta.enum.includes("smed"));
  assert.ok(!/Laje Forte/i.test(p.text), "cliente não enviado");
  const all = A.buildKaizenPrompt(s, C.computeStudy(s), true, { includeAll: true });
  assert.equal(all.count, 4);
  assert.ok(all.text.includes('"elemento":"Procurando peças da [CLIENTE]"') && all.text.includes('"valor":"sem classificação"'));
  s.elements[3].kaizen = "Simplificar: quadro de OP";
  const p2 = A.buildKaizenPrompt(s, C.computeStudy(s), true, { includeAll: true });
  assert.equal(p2.count, 3);
  assert.equal(p2.stats.withAction, 1);
});

test("Kaizen (REV 1.20): todos os produtos e etapas; mesmo nome em etapas diferentes = elementos distintos; vizinhos e takt no pedido", () => {
  const s = C.createStudy({ clientName: "Empresa Teste", processName: "Bancada" });
  s.shiftParams = { shiftTimeMin: 480, plannedStopsMin: 0, dailyDemandPcs: 200, tolerancePct: 0 };
  s.elements = [
    ["Pão", "Laminação", "Abrir a massa", "C", "10", "40", "AG"],
    ["Pão", "Laminação", "Pegar bandeja", "A", "1", "50", "NA"],
    ["Pão", "Enrolar", "Enrolar", "C", "10", "150", "AG"],
    ["Pão", "Enrolar", "Pegar bandeja", "A", "1", "200", "NA"],
    ["Rosca", "", "Pegar bandeja", "A", "1", "220", "NA"],
    ["Rosca", "", "Modelar", "C", "10", "300", "AG"],
  ].map(([product, etapa, description, type, quantity, videoTime, value]) => C.createElement({ product, etapa, description, type, quantity, videoTime, value, waste: value === "NA" ? "movimentacao" : "" }));
  s.filmPieces = { inicio: "10" };
  const p = A.buildKaizenPrompt(s, C.computeStudy(s), true);
  assert.deepEqual(
    p.targets.map((t) => [t.product, t.etapa, t.name, t.prev, t.next]),
    [
      ["Pão", "Laminação", "Pegar bandeja", "Abrir a massa", "Enrolar"],
      ["Pão", "Enrolar", "Pegar bandeja", "Enrolar", ""],
      ["Rosca", "(sem etapa)", "Pegar bandeja", "", "Modelar"],
    ]
  );
  assert.equal(new Set(p.targets.map((t) => `${t.productKey}|${t.groupKey}`)).size, 3);
  assert.ok(p.text.includes('"produto":"Rosca"') && p.text.includes('"diferenca_tp_menos_takt"'));
  assert.ok(p.text.includes("exatamente um item para cada id recebido (3 no total)"));
});

test("Kaizen (REV 1.20): resposta lida pelo id; sem ação, ferramenta e confiança; ids inválidos/repetidos descartados; faltantes", () => {
  const s = study();
  const p = A.buildKaizenPrompt(s, C.computeStudy(s), true);
  const reply = JSON.stringify({
    itens: [
      { id: 1, sem_acao: false, ecrs: "eliminar", ferramenta: "layout", acao: "Levar o material do [CLIENTE] para junto da bancada", justificativa: "Transporte 20 s/pç", confianca: "média" },
      { id: 1, sem_acao: false, ecrs: "Combinar", acao: "repetido" },
      { id: 9, sem_acao: false, acao: "id inventado" },
    ],
  });
  const out = A.parseKaizen(reply, p.targets, s);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].name, out[0].text, out[0].tool, out[0].confidence], ["Transporte de material", "Eliminar: Levar o material do Laje Forte para junto da bancada", "layout", "media"]);
  assert.deepEqual(A.missingTargets(p.targets, out).map((t) => t.name), ["Anotar OP"]);
  const again = A.buildKaizenPrompt(s, C.computeStudy(s), true, { targets: A.missingTargets(p.targets, out) });
  assert.equal(again.count, 1);
  assert.ok(again.text.includes('"id":2'));
  const none = A.parseKaizen('{"itens":[{"id":2,"sem_acao":true,"falta_observar":"Medir quantas OPs por turno","ferramenta":"inexistente"}]}', p.targets, s);
  assert.deepEqual([none[0].noAction, none[0].why, none[0].tool], [true, "Medir quantas OPs por turno", ""]);
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

test("API (REV 1.17): erro 503 tenta de novo mais 2 vezes e avisa; persistindo, mensagem em português", async () => {
  let n = 0;
  const flaky = fakeFetch(() => (++n < 3 ? { status: 503, body: { error: { message: "high demand" } } } : { status: 200, body: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } }));
  const waits = [];
  const retries = [];
  const opts = { sleep: async (ms) => waits.push(ms), onRetry: (a, t) => retries.push(`${a}/${t}`) };
  assert.equal(await A.generate({ apiKey: "K", model: "m" }, "x", opts, flaky), "ok");
  assert.equal(flaky.calls.length, 3);
  assert.deepEqual(waits, [3000, 8000]);
  assert.deepEqual(retries, ["2/3", "3/3"]);
  const down = fakeFetch(() => ({ status: 503, body: { error: { message: "high demand" } } }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", { sleep: async () => {} }, down), /Gemini sobrecarregado no momento \(erro 503\).*outro modelo/);
  assert.equal(down.calls.length, 3, "1 + 2 novas tentativas");
  const quota = fakeFetch(() => ({ status: 429, body: {} }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", { sleep: async () => {} }, quota), /Limite de uso/);
  assert.equal(quota.calls.length, 1, "429 (limite da chave) não é repetido");
});

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

  // REV 1.20: esquema JSON e temperatura; modelo que recusa o esquema → repete sem ele
  const schema = { type: "OBJECT", properties: {} };
  let first = true;
  const noSchema = fakeFetch((url, init) =>
    JSON.parse(init.body).generationConfig.responseSchema && first ? ((first = false), { status: 400, body: { error: { message: "schema" } } }) : { status: 200, body: { candidates: [{ content: { parts: [{ text: "{}" }] } }] } }
  );
  assert.equal(await A.generate({ apiKey: "K", model: "m" }, "x", { json: true, schema, temperature: 0.2 }, noSchema), "{}");
  assert.equal(noSchema.calls.length, 2);
  const g1 = JSON.parse(noSchema.calls[0].init.body).generationConfig;
  assert.deepEqual([g1.temperature, g1.responseSchema], [0.2, schema]);
  assert.equal(JSON.parse(noSchema.calls[1].init.body).generationConfig.responseSchema, undefined);

  const bad = fakeFetch(() => ({ status: 400, body: { error: { message: "API key not valid" } } }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", {}, bad), /Chave de API inválida/);
  const quota = fakeFetch(() => ({ status: 429, body: {} }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", {}, quota), /Limite de uso/);
  const blocked = fakeFetch(() => ({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m" }, "x", {}, blocked), /bloqueado/);
  await assert.rejects(A.generate({ apiKey: "", model: "m" }, "x", {}, ok), /Cadastre a chave/);
});

test("padronizar nomes: envia todos os elementos e só aceita grupos com nomes existentes", () => {
  const s = study();
  s.elements.push(C.createElement({ description: "Transp. material", videoTime: "1:40" }));
  s.elements.push(C.createElement({ description: "transporte de materiais", videoTime: "1:50" }));
  const p = A.buildNamesPrompt(s, C.computeStudy(s), true);
  assert.ok(p.count >= 2 && p.text.includes('"grupos"') && !/Laje Forte/i.test(p.text));
  const reply = JSON.stringify({ grupos: [
    { padrao: "Transporte de material", variantes: ["Transp. material", "transporte de materiais", "Inventado"] },
    { padrao: "Nome que não existe", variantes: ["Anotar OP"] },
    { padrao: "Anotar OP", variantes: [] },
  ] });
  assert.deepEqual(A.parseNames(reply, p.names, s, true), [
    { to: "Transporte de material", from: ["Transp. material", "transporte de materiais"] },
  ]);
});

test("pergunta livre: inclui dados do estudo e a pergunta anonimizada", () => {
  const s = study();
  const p = A.buildQuestionPrompt(s, C.computeStudy(s), "O que fazer primeiro na Laje Forte?", true);
  assert.equal(p.count, 1);
  assert.ok(p.text.includes("Pergunta: O que fazer primeiro na [CLIENTE]?"));
  assert.ok(p.text.includes('"por_valor"') === false && p.text.includes("Compilação por valor"));
  assert.equal(A.buildQuestionPrompt(s, C.computeStudy(s), "  ", true).count, 0);
});

test("resumo executivo do MFV: números do EP, gargalo e cliente anonimizado", () => {
  const M = require("../js/mfv-calc.js");
  const d = M.createMfv({ clientName: "Laje Forte", family: "Lajes" });
  d.demandMonthly = "8800";
  d.steps = [M.createStep({ name: "Corte", tcManualMin: 0.75, operators: "2" }), M.createStep({ name: "Solda", tcManualMin: 1.5, operators: "1", kaizen: true })];
  const p = A.buildMfvSummaryPrompt(d, M.computeMfv(d), true);
  assert.equal(p.count, 2);
  assert.ok(p.text.includes('"takt_min":1.3') && p.text.includes('"gargalo":{"etapa":"Solda"'));
  assert.ok(!/Laje Forte/.test(p.text) && p.text.includes('"cliente":"[CLIENTE]"'));
});
