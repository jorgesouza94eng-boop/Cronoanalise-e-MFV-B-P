# Histórico de revisões — Lean Chrono & MFV

Controle de revisões do aplicativo de Cronoanálise e apoio ao Mapa de Fluxo de Valor (Programa Brasil Mais Produtivo).

| Revisão | Data | Situação |
|---|---|---|
| **REV 1.1** | 16/10/2026 | Em desenvolvimento: assistente de IA (Gemini) |
| **REV 1.0** | 16/10/2026 | Versão estável, validada com as planilhas B+P da Laje Forte |

---

## REV 1.0 — 16/10/2026 (versão estável)

Primeira versão completa, conferida com a cronoanálise REV2.0 e com o MFV Simplificado REV1 da Laje Forte.

### Cronoanálise
- Digitação 100% pelo teclado: `132` → 01:32 em minutos centesimais, com o fluxo `Enter` Descrição → Tempo final → Ritmo → nova linha. Atalhos `Ctrl+Enter`, `Ctrl+Del`, `↑`/`↓` e `Ctrl+S`.
- Leitura contínua: tempo subtraído = tempo final − leitura anterior, com validação de digitação (`199`, tempo menor que o anterior).
- **Várias filmagens no mesmo estudo**, que equivalem às células amarelas da planilha: a pergunta automática, `Alt+N` ou o toque no nº da linha marcam o início do vídeo; o vídeo recomeça em 00:00, com as etiquetas F1, F2…
- Padrão da planilha B+P: lançamento por **Quantidade** (ou Frequência), tipo **C/A** manual, **valor agregado** (Agrega / Não agrega / Incidental) e os **8 desperdícios** Lean.
- **Resumo por elemento**, que equivale à aba Listagem: C = Σtempo ÷ Σquantidade, A = Σtempo, e ação automática Manter / Eliminar / Reduzir.
- **Compilação e soluções**: gráficos por atividade, tempo e desperdício (Pareto) e o campo de constatações.
- Indicadores: tempo líquido disponível, takt, tempo padrão = ΣTN × (1 + tolerância) (OIT), capacidade e gargalo.
- Unidade de exibição em segundos, minutos ou horas. Ritmo e tolerância opcionais (padrão 100% e 0%).

### MFV — estado presente
- Página própria (`mfv.html`), com um arquivo por cliente e família.
- Horário por dia da semana, demanda mensal, disponibilidade da família e takt.
- GBO com as etapas **ligadas aos estudos de cronoanálise** (TC = tempo padrão, editável) e gráfico de balanceamento com a linha do takt.
- Gargalo, operadores atuais × ideais (com o total da linha opcional), capacidade, produtividade, processo Kaizen e atravessamento.

### Armazenamento (local-first)
- Salvamento no navegador (IndexedDB) e na pasta do **OneDrive** (File System Access API), com debounce de 3 s.
- Nome de arquivo fixo com ID único e **proteção contra conflito** entre notebooks: controle de revisão e cópia `_conflito_`.
- Modo celular: Exportar/Importar JSON. PWA offline quando publicado (GitHub Pages).

### Exportação
- **Excel no modelo B+P do consultor**: preenche a planilha de cronoanálise (`.xlsm`) e a do MFV (abas EP/EF), preservando fórmulas, gráficos, macros e formatação. Modelos guardados no navegador e na pasta `_Modelos`.
- **Excel simples**, CSV (Excel pt-BR) e JSON.

### Validação
- Cronoanálise: 149 lançamentos e 9 filmagens deram os 28/28 elementos e o ciclo de **7.681 s** idênticos aos da planilha REV2.0. Depois do preenchimento, as fórmulas da própria planilha recalcularam para os mesmos valores.
- MFV: os resultados da aba EP (takt, capacidade, produtividade, operadores ideais, atravessamento) ficaram idênticos aos do MFV da Laje Forte.
- 89 testes automáticos e testes de navegador (computador, celular e arquivo local).

### Histórico de desenvolvimento (commits)
| Commit | Descrição |
|---|---|
| `7f8c811` | Versão consolidada (MVP): cálculo, teclado, armazenamento e conflito |
| `096b26c` | Preparação para o GitHub Pages |
| `18edcea` | Nova filmagem (vários vídeos no mesmo estudo) |
| `d831510` | Padrão da planilha: quantidade, tipo C/A, valor agregado e resumo por elemento |
| `f22a4a4` | Compilação com gráficos e Excel simples |
| `8c8a718` | MFV — estado presente |
| `942ee99` | Excel no modelo B+P (cronoanálise) |
| `aa0c567` | Excel no modelo B+P (MFV) e nº total de operadores |
