/**
 * Modelo SINTÉTICO de cronoanálise EO_Cronoanálise v00_r05 (REV 1.28), com a mesma estrutura
 * do modelo real (abas, cabeçalhos, fórmulas e "macro"), sem dados de cliente. Usado nos
 * testes de unidade (rev128.test.js) e de navegador (e2e.rev128.js).
 */
"use strict";

const zlib = require("zlib");
const X = require("../js/xlsx.js");

const enc = new TextEncoder();
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sheet = (rows) => `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
const str = (ref, text, style) => `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t>${X.esc(text)}</t></is></c>`;
const num = (ref, v) => `<c r="${ref}"><v>${v}</v></c>`;

function deflated(name, text) {
  const data = typeof text === "string" ? enc.encode(text) : text;
  return { name, raw: { method: 8, compressed: new Uint8Array(zlib.deflateRawSync(data)), crc: X.crc32(data), size: data.length } };
}

/** Modelo r05 sintético. baseUnit vazio = consultor apagou a unidade base. */
function buildR05(baseUnit = "Peça") {
  const unidades =
    `<row r="7">${str("D7", "07/10/2026 - v00_r05")}</row>` +
    `<row r="8">${str("A8", "Tamanho do lote:")}${num("B8", 100)}</row>` +
    `<row r="9">${str("A9", "Unidade Base (Nome):")}${baseUnit ? str("B9", baseUnit) : '<c r="B9" s="4"/>'}</row>` +
    `<row r="11"><c r="A11"><f>IF(ISBLANK(B9),"",B9)</f></c><c r="B11"><f>IF(NOT(ISBLANK(B9)),1,"")</f></c></row>` +
    `<row r="12">${str("A12", "Lote")}<c r="B12"><f>B8</f><v>100</v></c></row>` +
    `<row r="15">${str("C15", "- Observações sobre o lote 1: exemplo", 7)}</row>`;
  const heads = ["Nº", "Elemento de Trabalho", "Tempo (início)", "Tempo (fim)", "Qtd. Intermed.", "Unidade", "Tipo", "Qtd. na Base", "Agrega?", "Tempo (unit.)", "Tempo", "Todos os Elementos sem Itens Duplicados"];
  let geral = `<row r="8">${heads.map((h, i) => str(`${String.fromCharCode(65 + i)}8`, h)).join("")}</row>`;
  for (let n = 9; n <= 12; n++) {
    geral += `<row r="${n}">${num(`A${n}`, n - 8)}${n === 9 ? str("B9", "Elemento de exemplo") : ""}<c r="H${n}"><f>IF(ISBLANK(F${n}),"",E${n}*VLOOKUP(F${n},Unid_Valor,2,FALSE))</f></c>` +
      `<c r="K${n}"><f>IF(B${n}="","",IFERROR(D${n}-C${n},""))</f><v>0</v></c></row>`;
  }
  const lheads = { A7: "Nº", B7: "Elemento", C7: "Tempo\n(s)", D7: "Qtd. (média)", E7: "Valor", F7: "Ação", G7: "Responsável", H7: "Data Conclusão", I7: "% Incidência da Ação Sobre o Tempo Futuro" };
  const listagem =
    `<row r="3">${str("Q3", "Agrega")}</row><row r="4">${str("Q4", "Não agrega")}</row><row r="5">${str("Q5", "Incidental")}</row>` +
    `<row r="7">${Object.entries(lheads).map(([r, h]) => str(r, h)).join("")}</row>` +
    `<row r="9">${num("A9", 1)}${str("E9", "Incidental")}${num("I9", 0.5)}<c r="J9"><f>IFERROR(C9*(1-I9),"")</f></c></row>` +
    `<row r="10">${num("A10", 2)}<c r="J10"><f>IFERROR(C10*(1-I10),"")</f></c></row>`;
  const compil = `<row r="34">${str("A34", "Observações e eventuais soluções")}</row><row r="35"><c r="B35" s="29"/></row>` +
    `<row r="14">${str("C14", "Agrega")}<c r="D14"><f>COUNTIF('Listagem de Elementos'!E9:E208,C14)</f><v>1</v></c></row>`;
  const names = ["UNIDADES", "GERAL", "Listagem de Elementos", "Compilação e Soluções"];
  const sheets = [unidades, geral, listagem, compil];
  return X.zip([
    deflated("[Content_Types].xml", "<Types/>"),
    deflated("xl/workbook.xml", `<?xml version="1.0"?><workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${X.esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029"/></workbook>`),
    deflated("xl/_rels/workbook.xml.rels", `<Relationships>${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    deflated("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS}></sst>`),
    ...sheets.map((rows, i) => deflated(`xl/worksheets/sheet${i + 1}.xml`, sheet(rows))),
    deflated("xl/vbaProject.bin", new Uint8Array([9, 8, 7, 6, 5])),
  ]);
}

module.exports = { buildR05 };
