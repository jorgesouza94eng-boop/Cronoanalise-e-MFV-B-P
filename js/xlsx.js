/**
 * ============================================================================
 * LEAN CHRONO & MFV — EXPORTAÇÃO EXCEL (.xlsx) NO LAYOUT DA PLANILHA B+P
 * ----------------------------------------------------------------------------
 * Gerador .xlsx próprio, sem bibliotecas externas (funciona offline e via
 * file://): monta o XML do Office Open XML e empacota em ZIP sem compressão.
 * Depende de: LeanCalc (calc.js). Também roda no Node (testes).
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./calc.js"));
  } else {
    root.LeanXlsx = factory(root.LeanCalc);
  }
})(typeof self !== "undefined" ? self : this, function (Calc) {
  "use strict";

  /* ==========================================================================
     ZIP (MÉTODO "STORE", SEM COMPRESSÃO) + CRC-32
     ========================================================================== */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /**
   * files: [{ name, data: Uint8Array }] → Uint8Array do arquivo .zip (sem compressão).
   * Uma entrada também pode vir já compactada, copiada de outro ZIP sem alteração:
   * { name, raw: { method, compressed, crc, size } } — usado para preservar o modelo B+P.
   */
  function zip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
    const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

    files.forEach((f) => {
      const name = enc.encode(f.name);
      const method = f.raw ? f.raw.method : 0;
      const payload = f.raw ? f.raw.compressed : f.data;
      const crc = f.raw ? f.raw.crc : crc32(f.data);
      const size = f.raw ? f.raw.size : f.data.length;
      const csize = payload.length;
      // Cabeçalho local (bit 11 = nomes em UTF-8; data fixa 01/01/2026)
      const header = [
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0x5c21),
        ...u32(crc), ...u32(csize), ...u32(size), ...u16(name.length), ...u16(0),
      ];
      chunks.push(Uint8Array.from(header), name, payload);
      central.push([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0x5c21),
        ...u32(crc), ...u32(csize), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ], name);
      offset += header.length + name.length + csize;
    });

    let centralSize = 0;
    const centralChunks = [];
    for (let i = 0; i < central.length; i += 2) {
      const head = Uint8Array.from(central[i]);
      centralChunks.push(head, central[i + 1]);
      centralSize += head.length + central[i + 1].length;
    }
    const end = Uint8Array.from([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(centralSize), ...u32(offset), ...u16(0),
    ]);

    const all = chunks.concat(centralChunks, [end]);
    const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let pos = 0;
    all.forEach((c) => {
      out.set(c, pos);
      pos += c.length;
    });
    return out;
  }

  /* ==========================================================================
     PLANILHA (OFFICE OPEN XML)
     ========================================================================== */

  /** Estilos disponíveis (índice em cellXfs do styles.xml). */
  const STYLE = { default: 0, title: 1, header: 2, text: 3, time: 4, num1: 5, pct: 6, num3: 7, label: 8, notes: 9, int: 10, subtitle: 11 };

  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/><numFmt numFmtId="165" formatCode="0.0"/>' +
    '<numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="0.000"/></numFmts>' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right>' +
    '<top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="12">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  function esc(v) {
    return String(v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colName(i) {
    let s = "";
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  /**
   * sheet = { name, cols: [larguras], rows: [[célula]], merges: ["A1:F1"], height: {linha: altura} }
   * célula = valor simples ou { v, s: "estilo" }. Números viram número; o resto, texto.
   */
  function sheetXml(sheet) {
    const rowsXml = sheet.rows
      .map((row, r) => {
        if (!row) return "";
        const cells = row
          .map((cell, c) => {
            if (cell == null || cell === "") return "";
            const obj = typeof cell === "object" ? cell : { v: cell };
            if (obj.v == null || obj.v === "") {
              return obj.s ? `<c r="${colName(c)}${r + 1}" s="${STYLE[obj.s]}"/>` : "";
            }
            const ref = `${colName(c)}${r + 1}`;
            const s = obj.s ? ` s="${STYLE[obj.s]}"` : "";
            if (typeof obj.v === "number" && Number.isFinite(obj.v)) return `<c r="${ref}"${s}><v>${obj.v}</v></c>`;
            return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(obj.v)}</t></is></c>`;
          })
          .join("");
        const ht = sheet.height && sheet.height[r + 1] ? ` ht="${sheet.height[r + 1]}" customHeight="1"` : "";
        return `<row r="${r + 1}"${ht}>${cells}</row>`;
      })
      .join("");
    const cols = (sheet.cols || [])
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
      .join("");
    const merges = (sheet.merges || []).length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
      : "";
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
      (cols ? `<cols>${cols}</cols>` : "") +
      `<sheetData>${rowsXml}</sheetData>${sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : ""}${merges}</worksheet>`
    );
  }

  /** sheets → Uint8Array (.xlsx) */
  function buildWorkbook(sheets) {
    const enc = new TextEncoder();
    const sheetEntries = sheets
      .map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("");
    const rels = sheets
      .map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("");
    // Filtro automático: o Excel guarda a área filtrada no nome oculto _FilterDatabase
    const absRef = (ref) => ref.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
    const names = sheets
      .map((s, i) =>
        s.autoFilter
          ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.slice(0, 31))}'!${absRef(s.autoFilter)}</definedName>`
          : ""
      )
      .join("");
    const filterNames = names ? `<definedNames>${names}</definedNames>` : "";
    const files = [
      {
        name: "[Content_Types].xml",
        xml:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets
            .map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
            .join("") +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        xml:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/workbook.xml",
        xml:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets>${sheetEntries}</sheets>${filterNames}</workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        xml:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          rels +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          "</Relationships>",
      },
      { name: "xl/styles.xml", xml: STYLES_XML },
    ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s) })));
    return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.xml) })));
  }

  /* ==========================================================================
     LAYOUT DA PLANILHA B+P (REV2): GERAL • LISTAGEM • COMPILAÇÃO • ANÁLISE
     Tempos em SEGUNDOS, como na planilha.
     ========================================================================== */

  function buildBPSheets(study) {
    const r = Calc.computeStudy(study);
    const qtyMode = r.mode === "quantidade";
    const sec = (min) => (min == null || !Number.isFinite(min) ? "" : Math.round(min * 60 * 1000) / 1000);
    const day = (min) => (min == null ? "" : min / 1440); // fração de dia (formato de hora do Excel)
    const H = (v) => ({ v, s: "header" });
    const T = (v) => ({ v: v == null ? "" : v, s: "text" });
    const N = (v, s) => ({ v, s: s || "num1" });
    const head = (title) => [
      [{ v: title, s: "title" }],
      // Rótulo e valor na mesma célula: o texto se estende pelas colunas vizinhas vazias.
      [{ v: `Empresa / Cliente: ${study.clientName || "—"}`, s: "label" }],
      [{ v: `Posto / Operação: ${study.processName || "—"}`, s: "label" }],
      [{ v: `Gerado em: ${new Date().toLocaleString("pt-BR")} • Lean Chrono & MFV`, s: "label" }],
      null,
    ];
    const valueLabel = (k) => (Calc.VALUES[k] ? Calc.VALUES[k].label : "");

    // ---- GERAL -------------------------------------------------------------
    const multi = r.multiProduct;
    const P = (v) => (multi ? [T(v)] : []); // coluna Produto só em estudos com vários produtos
    const geral = head("ANÁLISE DE VALOR AGREGADO — APONTAMENTO (GERAL)");
    const geralHeader = geral.length + 1;
    geral.push([
      H("Nº"), ...(multi ? [H("Produto")] : []), H("Elemento"), H("Tempo (Início)"), H("Tempo (Fim)"), H("Filmagem"),
      H(qtyMode ? "Quantidade" : "Frequência"), H("Valor"), H("Tipo"), H("Tempo/un (s)"), H("Tempo (s)"),
      H("Ritmo (%)"), H("Tempo normal (s)"), H("Desperdício"), H("Ação Kaizen (ECRS)"), H("Erros"),
    ]);
    study.elements.forEach((el, i) => {
      const row = r.rows[i];
      const start = row.hasReading ? row.timeMinutes - row.subtractedTime : null;
      geral.push([
        N(row.seq, "int"), ...P(row.product || "(sem produto)"), T(el.description), { v: day(start), s: "time" }, { v: day(row.timeMinutes), s: "time" },
        N(row.film, "int"), qtyMode ? N(row.quantity == null ? "" : row.quantity) : T(el.frequency), T(valueLabel(el.value)), T(row.type),
        N(row.hasReading ? sec(row.unitTime) : ""), N(row.hasReading ? sec(row.subtractedTime) : ""), N(Calc.parsePace(el.pace).value || "", "int"),
        N(row.hasReading ? sec(row.normalTime) : ""), T(Calc.WASTES[el.waste] || ""), T(el.kaizen), T(row.errors.join(" | ")),
      ]);
    });
    const geralLast = geral.length;
    geral.push(null, [
      { v: "Totais observados", s: "label" }, ...(multi ? [""] : []), "", "", "", N(r.filmCount, "int"), "", "", "", "",
      N(sec(r.totals.sumSubtracted)), "", N(sec(r.totals.sumNormal)),
    ]);

    // ---- LISTAGEM DE ELEMENTOS --------------------------------------------
    const listagem = head("ANÁLISE DE VALOR AGREGADO — LISTAGEM DE ELEMENTOS");
    listagem.push([
      { v: qtyMode ? `Tipo C: Σtempo ÷ Σquantidade (média por unidade) • Tipo A: ${r.summary.acyclic === "por-unidade" ? `Σtempo ÷ ${r.films.piecesTotal} peças das filmagens` : "Σtempo"}` : "Modo frequência: média das ocorrências", s: "subtitle" },
    ]);
    const listHeader = listagem.length + 1;
    listagem.push([
      H("Nº"), ...(multi ? [H("Produto")] : []), H("Elemento"), H("Tempo (s)"), H("Qt."), H("Valor"), H("Ação"), H("Desperdício"),
      H("Tipo"), H("Ocorrências"), H("Tempo total (s)"), H("% do ciclo"), H("Observação"),
    ]);
    // Vários produtos: a listagem traz todos os produtos (filtre pela coluna Produto)
    const listProducts = multi ? r.products : [r.product];
    listProducts.forEach((pr) => pr.summary.elements.forEach((g) => {
      listagem.push([
        N(g.seq, "int"), ...P(pr.name), T(g.name), N(sec(g.cycleTime)), N(Math.round(g.avgQuantity * 1000) / 1000, "num3"), T(valueLabel(g.value)),
        T(g.action), T(g.waste ? Calc.WASTES[g.waste] : ""), T(g.type), N(g.occurrences, "int"), N(sec(g.sumNormal)),
        N(g.sharePct / 100, "pct"), T(g.conflicts.length ? `Classificação divergente (${g.conflicts.join(", ")})` : ""),
      ]);
    }));
    const listLast = listagem.length;
    listagem.push(null);
    listProducts.forEach((pr) =>
      listagem.push([{ v: `Tempo normal do ciclo (s)${multi ? ` — ${pr.name}` : ""}`, s: "label" }, ...(multi ? [""] : []), "", N(sec(pr.summary.cycleNormal))])
    );

    // ---- COMPILAÇÃO E SOLUÇÕES --------------------------------------------
    const comp = r.compilation;
    const compil = head("ANÁLISE DE VALOR AGREGADO — COMPILAÇÃO E SOLUÇÕES");
    compil.push([{ v: `Por atividade e por tempo (valor agregado)${multi ? ` — ${r.product.name}` : ""}`, s: "subtitle" }]);
    compil.push([H("Valor"), H("Nº de elementos"), H("Tempo no ciclo (s)"), H("% do tempo")]);
    comp.byValue.forEach((v) => compil.push([T(v.label), N(v.count, "int"), N(sec(v.time)), N(v.pct / 100, "pct")]));
    compil.push([
      { v: "Total", s: "label" }, N(comp.elementCount, "int"), N(sec(comp.total)), N(comp.total > 0 ? 1 : 0, "pct"),
    ]);
    compil.push(null, [{ v: "Por desperdício (8 desperdícios Lean)", s: "subtitle" }]);
    compil.push([H("Desperdício"), H("Nº de elementos"), H("Tempo no ciclo (s)"), H("% do tempo")]);
    if (comp.byWaste.length) {
      comp.byWaste.forEach((w) => compil.push([T(w.label), N(w.count, "int"), N(sec(w.time)), N(w.pct / 100, "pct")]));
    } else {
      compil.push([T("Nenhum desperdício classificado")]);
    }
    compil.push(null, [{ v: "Constatações e soluções", s: "subtitle" }]);
    const notesRow = compil.length + 1;
    compil.push([{ v: study.notes || "", s: "notes" }, { v: "", s: "notes" }, { v: "", s: "notes" }, { v: "", s: "notes" }]);
    const notesLines = Math.max(4, String(study.notes || "").split("\n").length + 1);

    // ---- ANÁLISE (INDICADORES) --------------------------------------------
    const k = r.kpis;
    const p = study.shiftParams;
    const analise = head("ANÁLISE — INDICADORES LEAN");
    analise.push([H("Indicador"), H("Valor"), H("Unidade")]);
    [
      ["Jornada bruta", p.shiftTimeMin, "min/dia"],
      ["Paradas planejadas", p.plannedStopsMin, "min/dia"],
      ["Tempo líquido disponível", k.netTime, "min/dia"],
      ["Demanda do cliente", p.dailyDemandPcs, "pçs/dia"],
      ["Takt time", sec(k.taktTime), "s/pç"],
      ["Tempo normal do ciclo", sec(k.sumNormal), "s/pç"],
      ["Tolerância / fadiga", p.tolerancePct, "%"],
      ["Tempo padrão do ciclo", sec(k.standardTime), "s/pç"],
      ["Capacidade produtiva", k.capacity == null ? "" : k.capacity, "pçs/dia"],
      ["Status", Calc.STATUS_LABELS[k.status], ""],
      ["Tempo observado (todas as filmagens)", sec(r.totals.sumSubtracted), "s"],
      ["Filmagens", r.filmCount, ""],
      ["Elementos (resumo)", r.summary.elements.length, ""],
      ["Linhas com erro (fora dos totais)", r.errorCount, ""],
      ["Lançamento", qtyMode ? "Quantidade (planilha B+P)" : "Frequência", ""],
    ].forEach(([a, b, c]) => analise.push([T(a), typeof b === "number" ? N(b) : T(b == null ? "" : b), T(c)]));
    if (multi) {
      analise.splice(6, 0, [T("Produto (indicadores acima)"), T(r.product.name), T("")]);
      analise.push(null, [{ v: "Por produto", s: "subtitle" }]);
      analise.push([H("Produto"), H("Tempo normal (s/pç)"), H("Tempo padrão (s/pç)"), H("Demanda (pçs/dia)"), H("Carga (min/dia)")]);
      const mix = r.mix;
      r.products.forEach((pr, i) =>
        analise.push([
          T(pr.name), N(sec(pr.kpis.sumNormal)), N(sec(pr.kpis.standardTime)),
          pr.demand == null ? T("") : N(pr.demand), mix.items[i].load == null ? T("") : N(Math.round(mix.items[i].load * 100) / 100),
        ])
      );
      analise.push(null, [{ v: "Carga do posto (mix)", s: "subtitle" }]);
      [
        ["Tempo líquido disponível", mix.netTime, "min/dia"],
        ["Carga total", mix.load, "min/dia"],
        ["Ocupação do posto", mix.occupancyPct == null ? "" : Math.round(mix.occupancyPct * 10) / 10, "%"],
        ["Takt misto (tempo líquido ÷ Σ demandas)", sec(mix.taktMix), "s/pç"],
        ["TC ponderado pelo mix", sec(mix.weightedTP), "s/pç"],
        ["Status", { atende: "Atende o mix", sobrecarga: "Sobrecarga (acima de 100%)", incompleto: "Incompleto (falta demanda ou tempo)" }[mix.status], ""],
      ].forEach(([a, b, c]) => analise.push([T(a), typeof b === "number" ? N(b) : T(b == null ? "" : b), T(c)]));
    }
    const lastCol = (n) => colName(n - 1);

    return [
      {
        name: "GERAL",
        rows: geral,
        cols: multi ? [6, 18, 42, 13, 13, 10, 11, 13, 7, 13, 11, 10, 15, 24, 32, 30] : [6, 42, 13, 13, 10, 11, 13, 7, 13, 11, 10, 15, 24, 32, 30],
        merges: ["A1:H1"],
        autoFilter: `A${geralHeader}:${lastCol(multi ? 16 : 15)}${Math.max(geralLast, geralHeader + 1)}`,
      },
      {
        name: "Listagem de Elementos",
        rows: listagem,
        cols: multi ? [6, 18, 46, 11, 8, 13, 18, 24, 7, 12, 15, 11, 34] : [6, 46, 11, 8, 13, 18, 24, 7, 12, 15, 11, 34],
        merges: ["A1:H1", "A6:H6"],
        autoFilter: `A${listHeader}:${lastCol(multi ? 13 : 12)}${Math.max(listLast, listHeader + 1)}`,
      },
      {
        name: "Compilação e Soluções",
        rows: compil,
        cols: [34, 16, 18, 12],
        merges: ["A1:D1", `A${notesRow}:D${notesRow}`],
        height: { [notesRow]: Math.min(400, notesLines * 15) },
      },
      { name: "Análise", rows: analise, cols: multi ? [38, 18, 18, 18, 14] : [38, 16, 12], merges: ["A1:C1"] },
    ];
  }

  function buildBPWorkbook(study) {
    return buildWorkbook(buildBPSheets(study));
  }

  return { buildWorkbook, buildBPSheets, buildBPWorkbook, crc32, zip, colName, esc };
});
