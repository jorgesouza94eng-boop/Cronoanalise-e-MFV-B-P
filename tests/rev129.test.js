/**
 * Testes da REV 1.29: chave da empresa (Calc.companyKey) igual à regra do nome da subpasta.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../js/calc.js");

test("companyKey: pontos, acentos, maiúsculas e espaços não separam empresas", () => {
  const k = C.companyKey("R F DE ASSIS");
  ["R. F. DE ASSIS", "r f de assis", "R.F. de Assis", "  R  F  De  Assis "].forEach((n) => assert.equal(C.companyKey(n), k, n));
  assert.equal(C.companyKey("Indústria Ação & Cia."), "industria acao cia");
  assert.notEqual(C.companyKey("R F DE ASSIS LTDA"), k, "nome diferente continua outra empresa");
  assert.equal(C.companyKey(""), "");
  assert.equal(C.companyKey(null), "");
});

test("companyKey: mesma empresa ⇔ mesma subpasta (companyDirName = slugify)", () => {
  const pairs = [["R. F. DE ASSIS", "R F DE ASSIS"], ["Padaria São João", "padaria sao joao"], ["Metal-Alfa", "Metal Alfa"]];
  pairs.forEach(([a, b]) => {
    assert.equal(C.companyKey(a), C.companyKey(b));
    assert.equal(C.slugify(a).toLowerCase(), C.slugify(b).toLowerCase());
  });
});
