/**
 * ============================================================================
 * LEAN CHRONO & MFV — PREENCHIMENTO DO MODELO EXCEL B+P (CRONOANÁLISE REV2)
 * ----------------------------------------------------------------------------
 * Abre a planilha-modelo do consultor (.xlsm/.xlsx), preenche SOMENTE as células
 * de entrada e preserva todo o resto: fórmulas, gráficos, macros (VBA), cores,
 * comentários e abas ocultas. As partes não alteradas do arquivo são copiadas
 * byte a byte; o Excel recalcula tudo ao abrir.
 *
 * Mapeamento (planilha "01_Cronoanalise_das_Atividades_REV2.0"):
 *   GERAL (linhas 10–300): B Nº | C Elemento | D Tempo (Início) | E Tempo (Fim) |
 *                          G Quantidade | I Tipo | L lista de elementos | S observações
 *   Listagem de Elementos (linhas 9–134): B Elemento | C Tempo (s) | D Qt. | E Valor | G Desperdício
 *   Compilação e Soluções: B55 constatações e soluções
 *   Análise: C16 identificação do estudo
 *
 * Depende de: LeanCalc (calc.js) e LeanXlsx (xlsx.js). Também roda no Node (testes).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"), require("./xlsx.js"));
  } else {
    root.LeanXlsxTemplate = factory(root.LeanCalc, root.LeanXlsx);
  }
})(typeof self !== "undefined" ? self : this, function (Calc, Xlsx) {
  "use strict";

  const LIMITS = { geralFirst: 10, geralLast: 300, listFirst: 9, listLast: 134, analiseSum: 40 };
  const SHEETS = { geral: "GERAL", listagem: "Listagem de Elementos", compilacao: "Compilação e Soluções", analise: "Análise", bd: "BD" };

  /* ==========================================================================
     LEITURA DO ZIP (.xlsx/.xlsm)
     ========================================================================== */

  /** Descompactação "deflate-raw": nativa do navegador (sem bibliotecas). */
  async function browserInflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Lê o diretório central do ZIP. Não descompacta nada ainda. */
  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("Arquivo não é um Excel válido (.xlsx/.xlsm)");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Estrutura do arquivo Excel corrompida");
      const method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      entries.push({ name, method, crc, size, compressed: bytes.subarray(start, start + csize) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function entryText(entry, inflate) {
    const data = entry.method === 0 ? entry.compressed : await inflate(entry.compressed);
    return new TextDecoder().decode(data);
  }

  /* ==========================================================================
     XML DA PLANILHA (EDIÇÃO CIRÚRGICA DE CÉLULAS)
     ========================================================================== */

  function unescapeXml(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, "&");
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) =>
      unescapeXml(Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((t) => t[1]).join(""))
    );
  }

  function colIndex(ref) {
    const letters = ref.match(/^[A-Z]+/)[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /** Divide o XML da planilha em linhas: { head, rows: Map<nº, xml>, order: [nº], tail }. */
  function splitRows(xml) {
    const open = xml.search(/<sheetData\s*\/>|<sheetData>/);
    if (open < 0) throw new Error("Planilha sem dados");
    if (/^<sheetData\s*\/>/.test(xml.slice(open))) {
      const end = xml.indexOf("/>", open) + 2;
      return { head: xml.slice(0, open) + "<sheetData>", rows: new Map(), order: [], tail: "</sheetData>" + xml.slice(end) };
    }
    const start = open + "<sheetData>".length;
    const end = xml.indexOf("</sheetData>", start);
    const rows = new Map();
    for (const m of xml.slice(start, end).matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)) {
      rows.set(Number(m[0].match(/\br="(\d+)"/)[1]), m[0]);
    }
    return { head: xml.slice(0, start), rows, order: Array.from(rows.keys()), tail: xml.slice(end) };
  }

  function joinRows(parts) {
    const nums = Array.from(parts.rows.keys()).sort((a, b) => a - b);
    return parts.head + nums.map((n) => parts.rows.get(n)).join("") + parts.tail;
  }

  function rowCells(rowXml) {
    const m = rowXml.match(/^<row\b([^>]*?)(\/?)>/);
    const attrs = m[1];
    const inner = m[2] === "/" ? "" : rowXml.slice(m[0].length, rowXml.length - "</row>".length);
    const cells = new Map();
    for (const c of inner.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      cells.set(c[0].match(/\br="([A-Z]+\d+)"/)[1], c[0]);
    }
    return { attrs, cells };
  }

  /** Texto atual de uma célula (número, texto compartilhado ou texto embutido). */
  function cellText(cellXml, sst) {
    if (!cellXml) return "";
    const t = (cellXml.match(/\bt="([^"]+)"/) || [])[1];
    if (t === "inlineStr") {
      return unescapeXml(Array.from(cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => x[1]).join(""));
    }
    const v = (cellXml.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    if (v == null) return "";
    return t === "s" ? sst[Number(v)] || "" : unescapeXml(v);
  }

  function getCell(parts, ref, sst) {
    const row = parts.rows.get(Number(ref.match(/\d+/)[0]));
    return row ? cellText(rowCells(row).cells.get(ref), sst) : "";
  }

  /**
   * Aplica alterações: updates = Map<"C10", valor>. Valor: número, texto ou null (limpa
   * mantendo a formatação da célula). Fórmulas nunca são alteradas.
   */
  function applyUpdates(parts, updates) {
    const byRow = new Map();
    updates.forEach((value, ref) => {
      const n = Number(ref.match(/\d+/)[0]);
      if (!byRow.has(n)) byRow.set(n, []);
      byRow.get(n).push([ref, value]);
    });
    byRow.forEach((list, n) => {
      const existing = parts.rows.get(n);
      // Linha inexistente e nada a gravar: não cria linha vazia.
      if (!existing && list.every(([, v]) => v == null || v === "")) return;
      const { attrs, cells } = existing ? rowCells(existing) : { attrs: ` r="${n}"`, cells: new Map() };
      list.forEach(([ref, value]) => {
        const old = cells.get(ref);
        if (old && /<f[\s>/]/.test(old)) return; // nunca sobrescreve fórmula
        if (!old && (value == null || value === "")) return; // nada a limpar
        const style = old ? (old.match(/\bs="(\d+)"/) || [])[0] : null;
        const s = style ? ` ${style}` : "";
        if (value == null || value === "") cells.set(ref, `<c r="${ref}"${s}/>`);
        else if (typeof value === "number" && Number.isFinite(value)) cells.set(ref, `<c r="${ref}"${s}><v>${value}</v></c>`);
        else cells.set(ref, `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${Xlsx.esc(value)}</t></is></c>`);
      });
      const sorted = Array.from(cells.entries()).sort((a, b) => colIndex(a[0]) - colIndex(b[0]));
      // "spans" é só uma dica de desempenho; removida porque as colunas podem mudar.
      const head = attrs.replace(/\s+spans="[^"]*"/, "");
      parts.rows.set(n, `<row${head}>${sorted.map((c) => c[1]).join("")}</row>`);
    });
  }

  /** Remove os resultados guardados das fórmulas, para que o Excel/LibreOffice recalcule. */
  function dropCachedFormulaValues(xml) {
    return xml.replace(/<c\b([^>]*?)>(<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>))(?:<v>[\s\S]*?<\/v>|<v\/>)?<\/c>/g, (m, attrs, f) => {
      const a = attrs.replace(/\s+t="(?:str|b|e|n)"/, "");
      return `<c${a}>${f}</c>`;
    });
  }

  /* ==========================================================================
     MODELO: CARREGAR E RECONHECER
     ========================================================================== */

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  /**
   * Abre o modelo e confere se é a planilha de cronoanálise B+P.
   * @returns {Promise<object>} modelo pronto para preencher
   * @throws Error com a explicação, se não for reconhecido
   */
  async function loadTemplate(bytes, options) {
    const inflate = (options && options.inflate) || browserInflate;
    const entries = readZip(bytes);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const text = async (name) => (byName.has(name) ? entryText(byName.get(name), inflate) : null);

    const workbook = await text("xl/workbook.xml");
    const rels = await text("xl/_rels/workbook.xml.rels");
    if (!workbook || !rels) throw new Error("Arquivo não é uma pasta de trabalho do Excel");
    const relTarget = new Map(
      Array.from(rels.matchAll(/<Relationship\b[^>]*>/g)).map((m) => [
        (m[0].match(/\bId="([^"]+)"/) || [])[1],
        (m[0].match(/\bTarget="([^"]+)"/) || [])[1],
      ])
    );
    const sheetPath = new Map();
    for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
      const name = unescapeXml((m[0].match(/\bname="([^"]+)"/) || [])[1] || "");
      const target = relTarget.get((m[0].match(/\br:id="([^"]+)"/) || [])[1]);
      if (target) sheetPath.set(name, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
    const missing = [SHEETS.geral, SHEETS.listagem, SHEETS.compilacao].filter((n) => !sheetPath.has(n));
    if (missing.length) throw new Error(`Modelo não reconhecido: faltam as abas ${missing.join(", ")}`);

    const sst = parseSharedStrings(await text("xl/sharedStrings.xml"));
    const sheets = {};
    for (const [key, name] of Object.entries(SHEETS)) {
      if (sheetPath.has(name)) sheets[key] = { name, path: sheetPath.get(name), parts: splitRows(await text(sheetPath.get(name))) };
    }

    // Cabeçalhos (linha 8) que identificam a REV2
    const expectGeral = { C8: "elemento", D8: "tempo (inicio)", E8: "tempo (fim)", G8: "quantidade", I8: "tipo", L8: "todos elementos" };
    const expectList = { B8: "elemento", C8: "tempo (s)", D8: "qt.", E8: "valor" };
    const bad = [];
    Object.entries(expectGeral).forEach(([ref, label]) => {
      if (norm(getCell(sheets.geral.parts, ref, sst)) !== label) bad.push(`GERAL!${ref} ≠ "${label}"`);
    });
    Object.entries(expectList).forEach(([ref, label]) => {
      if (norm(getCell(sheets.listagem.parts, ref, sst)) !== label) bad.push(`Listagem!${ref} ≠ "${label}"`);
    });
    if (bad.length) throw new Error(`Layout diferente da REV2 (${bad.slice(0, 3).join("; ")}). Envie o modelo para ajustar o mapeamento.`);

    // Rótulos exatos usados pelas fórmulas da planilha (aba BD e quadro de desperdícios)
    const valueLabels = { AG: "Agrega", NA: "Não agrega", IN: "Incidental" };
    if (sheets.bd) {
      ["AG", "NA", "IN"].forEach((k, i) => {
        const v = getCell(sheets.bd.parts, `A${i + 1}`, sst);
        if (v) valueLabels[k] = v;
      });
    }
    const wasteLabels = {};
    for (let r = 39; r <= 60; r++) {
      const label = getCell(sheets.compilacao.parts, `D${r}`, sst);
      if (!label) break;
      const key = Object.keys(Calc.WASTES).find((k) => norm(Calc.WASTES[k]).startsWith(norm(label)));
      if (key) wasteLabels[key] = label; // mantém o texto exato (inclusive espaços) usado no CONT.SE
    }

    return { kind: "crono-rev2", entries, sst, sheets, workbook, valueLabels, wasteLabels, macro: byName.has("xl/vbaProject.bin") };
  }

  /* ==========================================================================
     PREENCHIMENTO
     ========================================================================== */

  /** Gera o .xlsm/.xlsx preenchido. Retorna { bytes, warnings }. */
  function fillTemplate(tpl, study) {
    const r = Calc.computeStudy(study);
    const warnings = [];
    const qtyMode = r.mode === "quantidade";
    const geral = tpl.sheets.geral.parts;
    const listagem = tpl.sheets.listagem.parts;

    // ---- GERAL: só linhas com leitura válida (como na planilha: elemento + início + fim)
    const lines = [];
    let skipped = 0;
    study.elements.forEach((el, i) => {
      const row = r.rows[i];
      if (!row.hasReading || !row.valid) {
        if (el.description || el.videoTime) skipped += 1;
        return;
      }
      const qty = qtyMode ? row.quantity : row.frequency > 0 ? 1 / row.frequency : 1;
      lines.push({
        name: String(el.description || "").trim().replace(/\s+/g, " ") || `(linha ${row.seq})`,
        start: (row.timeMinutes - row.subtractedTime) / 1440, // fração de dia (hh:mm:ss no Excel)
        end: row.timeMinutes / 1440,
        qty,
        type: row.type,
      });
    });
    if (skipped) warnings.push(`${skipped} linha(s) sem tempo ou com erro não foram exportadas.`);
    if (!qtyMode) warnings.push("O estudo está no modo Frequência: a planilha usa Quantidade (exportado como 1 ÷ frequência).");
    const capacity = LIMITS.geralLast - LIMITS.geralFirst + 1;
    if (lines.length > capacity) throw new Error(`O estudo tem ${lines.length} lançamentos; o modelo comporta ${capacity} (linhas ${LIMITS.geralFirst}–${LIMITS.geralLast}).`);

    // Nomes iguais aos do resumo, para os SOMASE/CONT.SE da planilha agruparem igual ao app
    const canonical = new Map(r.summary.elements.map((g) => [g.key, g.name]));
    lines.forEach((l) => (l.name = canonical.get(Calc.elementKey(l.name)) || l.name));
    const elements = r.summary.elements.filter((g) => !g.key.startsWith("#"));
    const listCap = LIMITS.listLast - LIMITS.listFirst + 1;
    if (elements.length > listCap) throw new Error(`O estudo tem ${elements.length} elementos; a Listagem do modelo comporta ${listCap}.`);
    if (elements.length > LIMITS.analiseSum) {
      warnings.push(`Atenção: a aba Análise da planilha soma só ${LIMITS.analiseSum} elementos (T25:T64); com ${elements.length}, o "tempo de ciclo unitário" dela sairá menor que o do app.`);
    }

    const g = new Map();
    for (let n = LIMITS.geralFirst; n <= LIMITS.geralLast; n++) {
      const l = lines[n - LIMITS.geralFirst];
      const u = elements[n - LIMITS.geralFirst];
      g.set(`C${n}`, l ? l.name : null);
      g.set(`D${n}`, l ? l.start : null);
      g.set(`E${n}`, l ? l.end : null);
      g.set(`G${n}`, l ? l.qty : null);
      g.set(`I${n}`, l ? l.type : null);
      g.set(`L${n}`, u ? u.name : null);
      g.set(`S${n}`, null); // observações de revisões anteriores do modelo
    }
    applyUpdates(geral, g);

    // ---- Listagem de Elementos (valores do resumo do app; a coluna F "Ação" é fórmula)
    const missingWaste = new Set();
    const lst = new Map();
    for (let n = LIMITS.listFirst; n <= LIMITS.listLast; n++) {
      const e = elements[n - LIMITS.listFirst];
      lst.set(`B${n}`, e ? e.name : null);
      lst.set(`C${n}`, e ? Math.round(e.cycleTime * 60 * 1000) / 1000 : null);
      lst.set(`D${n}`, e ? Math.round(e.avgQuantity * 1000) / 1000 : null);
      lst.set(`E${n}`, e && e.value ? tpl.valueLabels[e.value] : null);
      let waste = null;
      if (e && e.waste) {
        waste = tpl.wasteLabels[e.waste] || Calc.WASTES[e.waste];
        if (!tpl.wasteLabels[e.waste]) missingWaste.add(Calc.WASTES[e.waste]);
      }
      lst.set(`G${n}`, waste);
    }
    applyUpdates(listagem, lst);
    if (missingWaste.size) {
      warnings.push(`Desperdício(s) sem linha no quadro da planilha (não entram no gráfico dela): ${Array.from(missingWaste).join(", ")}.`);
    }

    // ---- Compilação (constatações) e Análise (identificação)
    applyUpdates(tpl.sheets.compilacao.parts, new Map([["B55", study.notes || null]]));
    if (tpl.sheets.analise) {
      applyUpdates(
        tpl.sheets.analise.parts,
        new Map([
          ["C16", `${study.clientName || "Cliente"} — ${study.processName || "Posto"} (${r.filmCount} filmagem(ns), exportado pelo Lean Chrono)`],
          ["F15", null], // comentário da revisão anterior do modelo
        ])
      );
    }

    // ---- Monta o arquivo: partes alteradas sem compressão; demais copiadas byte a byte
    const enc = new TextEncoder();
    const changed = new Map();
    Object.values(tpl.sheets).forEach((sh) => {
      if (sh === tpl.sheets.bd) return;
      changed.set(sh.path, dropCachedFormulaValues(joinRows(sh.parts)));
    });
    // Excel recalcula todas as fórmulas (e os gráficos) ao abrir
    changed.set(
      "xl/workbook.xml",
      /<calcPr\b/.test(tpl.workbook)
        ? tpl.workbook.replace(/<calcPr\b([^>]*?)\s*(\/?)>/, (m, a, sl) => `<calcPr${a.replace(/\s+fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${sl ? "/" : ""}>`)
        : tpl.workbook.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')
    );
    const files = tpl.entries.map((e) =>
        changed.has(e.name)
          ? { name: e.name, data: enc.encode(changed.get(e.name)) }
          : { name: e.name, raw: { method: e.method, compressed: e.compressed, crc: e.crc, size: e.size } }
      );
    return { bytes: Xlsx.zip(files), warnings, lines: lines.length, elements: elements.length };
  }

  /** O preenchimento altera as linhas do modelo carregado: sempre trabalhar numa cópia. */
  async function fillFromBytes(templateBytes, study, options) {
    const tpl = await loadTemplate(templateBytes, options);
    return fillTemplate(tpl, study);
  }

  function exportFileName(study, templateName) {
    const ext = /\.xlsm$/i.test(templateName || "") ? "xlsm" : "xlsx";
    const date = new Date().toISOString().slice(0, 10);
    return `Crono_${Calc.slugify(study.clientName, "Cliente")}_${Calc.slugify(study.processName, "Posto")}_${date}.${ext}`;
  }

  return { LIMITS, readZip, loadTemplate, fillTemplate, fillFromBytes, exportFileName, parseSharedStrings, dropCachedFormulaValues };
});
