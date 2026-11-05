/**
 * Testes da REV 1.31: pausas/refeição sem ":" em minutos (MFV) e modelo reserva da IA no erro 503.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/mfv-calc.js");
const A = require("../js/ai.js");

test("pausas e refeição: sem ':' = minutos; com ':' = HH:MM", () => {
  assert.equal(M.parseDuration("20").minutes, 20);
  assert.equal(M.parseDuration("90").minutes, 90);
  assert.equal(M.parseDuration("130").minutes, 130, "130 = 130 min (antes era 1:30)");
  assert.equal(M.parseDuration("1:30").minutes, 90);
  assert.equal(M.parseDuration("00:20").minutes, 20);
  assert.equal(M.parseDuration("20").asMinutes, true);
  assert.equal(M.parseDuration("1:00").asMinutes, false);
  assert.equal(M.parseDuration("").minutes, null);
  assert.ok(M.parseDuration("20 min").error);
  assert.ok(M.parseDuration("1:75").error);
  // Entrada e saída continuam como hora do relógio
  assert.equal(M.parseScheduleField("start", "730").minutes, 450);
  assert.equal(M.parseScheduleField("breaks", "730").error, null);
  assert.equal(M.parseScheduleField("breaks", "730").minutes, 730);
});

test("horário: '20' de pausa desconta 20 minutos (antes: 20 horas → dia com erro)", () => {
  const d = M.createMfv({ clientName: "X", family: "Y" });
  d.schedule.forEach((day, i) => Object.assign(day, i < 5 ? { start: "07:00", end: "17:00", breaks: "20", meal: "60" } : { start: "", end: "", breaks: "", meal: "" }));
  d.demandMonthly = "4400";
  d.workDaysMonth = "22";
  d.availabilityPct = "100";
  const r = M.computeMfv(d);
  assert.equal(r.days[0].net, 600 - 20 - 60, "10 h − 20 min − 60 min = 520 min");
  assert.equal(r.days[0].errors.length, 0);
  assert.equal(r.days[0].worked, true);
});

test("IA: ordem dos modelos reserva (flash estável → lite → outros → prévias), sem o escolhido", () => {
  const ids = ["gemini-2.5-flash", "gemini-3.0-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-3.1-flash-preview"];
  assert.deepEqual(A.fallbackModels(ids, "gemini-3.0-flash"), ["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
  assert.deepEqual(A.fallbackModels([{ id: "a-flash" }, { id: "b-pro" }], "a-flash"), ["b-pro"]);
  assert.deepEqual(A.fallbackModels([], "x"), []);
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
const ok = (text) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
const busy = { status: 503, body: { error: { message: "high demand" } } };

test("IA 503: esgotadas as tentativas, troca para o modelo reserva só neste pedido", async () => {
  const f = fakeFetch((url) => (url.includes("/models/gemini-a-flash:") ? busy : ok(`resposta de ${url.match(/models\/([^:]+):/)[1]}`)));
  const settings = { apiKey: "K", model: "gemini-a-flash", models: ["gemini-a-flash", "gemini-b-flash", "gemini-c-pro"] };
  const moves = [];
  const waits = [];
  const text = await A.generate(settings, "x", { sleep: async (ms) => waits.push(ms), onFallback: (a, b) => moves.push(`${a}→${b}`) }, f);
  assert.equal(text, "resposta de gemini-b-flash");
  assert.deepEqual(moves, ["gemini-a-flash→gemini-b-flash"]);
  assert.equal(f.calls.length, 4, "3 no escolhido + 1 no reserva");
  assert.deepEqual(waits, [3000, 8000]);
  assert.equal(settings.model, "gemini-a-flash", "a configuração não muda");
});

test("IA 503: sem lista guardada, consulta os modelos da chave; todos sobrecarregados → mensagem com os modelos", async () => {
  const f = fakeFetch((url) =>
    url.includes("/models?")
      ? { status: 200, body: { models: [{ name: "models/gemini-a-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-b-flash", supportedGenerationMethods: ["generateContent"] }] } }
      : busy
  );
  const moves = [];
  await assert.rejects(
    A.generate({ apiKey: "K", model: "gemini-a-flash" }, "x", { sleep: async () => {}, onFallback: (a, b) => moves.push(b) }, f),
    /erro 503\) nos modelos gemini-a-flash, gemini-b-flash/
  );
  assert.deepEqual(moves, ["gemini-b-flash"]);
  assert.equal(f.calls.filter((c) => c.url.includes("/models?")).length, 1, "lista consultada uma vez");
  assert.equal(f.calls.filter((c) => c.url.includes(":generateContent")).length, 3 + 2, "3 no escolhido + 2 no reserva");
});

test("IA: outros erros (429, chave) não trocam de modelo", async () => {
  const f = fakeFetch(() => ({ status: 429, body: {} }));
  await assert.rejects(A.generate({ apiKey: "K", model: "m", models: ["m", "n-flash"] }, "x", { sleep: async () => {} }, f), /Limite de uso/);
  assert.equal(f.calls.length, 1);
});
