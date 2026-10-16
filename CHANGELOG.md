# Histórico de revisões — Lean Chrono & MFV

Controle de revisões do aplicativo de Cronoanálise e apoio ao Mapa de Fluxo de Valor (Programa Brasil Mais Produtivo).

| Revisão | Data | Situação |
|---|---|---|
| **REV 1.3** | 16/10/2026 | Início por filmagem, vários produtos no mesmo estudo e filtros |
| **REV 1.2** | 16/10/2026 | Comprovação da meta B+P: pç/HH real, payback e acíclicos por unidade |
| **REV 1.1** | 16/10/2026 | Assistente de IA (Gemini), opcional |
| **REV 1.0** | 16/10/2026 | Versão estável, validada com as planilhas B+P da Laje Forte |

---

## REV 1.3 — 16/10/2026 (filmagens, produtos e filtros)

### Novidades
- **Início da análise em cada filmagem:** o bloco *Filmagens do estudo* ganhou o campo **Início** para F1, F2, F3… A 1ª linha de cada filmagem passa a ser *tempo final − início*. Isso permite analisar um trecho no meio de qualquer vídeo, sem cortar o arquivo. O início da F1 é a Leitura inicial (campos sincronizados).
- **Vários produtos no mesmo estudo:** a opção *Vários produtos* mostra a coluna **Produto** na grade, e a linha nova repete o produto da anterior.
  - Resumo, compilação, gráficos e indicadores (ciclo, TP, capacidade, gargalo) ficam **separados por produto**, com um seletor no resumo.
  - As peças por filmagem são informadas por produto, e o setup de um produto é rateado só pelas peças dele.
  - No **MFV**, cada produto do estudo aparece como uma opção própria, com o seu TC.
- **Filtros na grade e no resumo:** por nome do elemento, produto, tipo, valor, desperdício, filmagem e linhas com erro, com aviso de filtro ativo e subtotal do que está visível.
  - O filtro só esconde linhas da tela: os cálculos usam sempre todas as linhas.
  - Com filtro ativo, não é possível incluir linhas, para proteger a sequência da leitura contínua. `↑`/`↓` pulam as linhas escondidas.
- **Excel simples:** filtro automático nos cabeçalhos da GERAL e da Listagem, coluna Produto e indicadores por produto. O CSV também ganhou a coluna Produto.
- **Excel no modelo B+P:**
  - o início de cada filmagem vai para a coluna *Tempo (Início)*;
  - com vários produtos, sai só o produto escolhido, com o nome do produto no arquivo;
  - novo aviso quando os acíclicos estão por unidade: a Listagem recebe o tempo do app, mas o ciclo da aba Análise (G3) continua com o tempo total do tipo A, porque é calculado pelas fórmulas da planilha.

### Compatibilidade
- Formato dos arquivos versão 3 (estudo e MFV). Os estudos e MFVs anteriores abrem com os **mesmos resultados**: sem produtos e com as filmagens começando em 00:00, como antes.
- Depois de salvo pela REV 1.3, o arquivo não abre numa versão anterior em cache. Basta recarregar a página nos aparelhos.

### Testes
- 119 testes de unidade (8 novos) e o novo teste de navegador `tests/e2e.rev13.js` (28 verificações). Os testes das revisões anteriores continuam passando.

---

## REV 1.2 — 16/10/2026 (comprovação da meta B+P)

### Novidades
- **Produtividade real (pç/HH)** no MFV: registro diário da produção, do nº de operadores e das horas trabalhadas. Linha de base (T1) × acompanhamento (T3), com a média do período = Σ produção ÷ Σ HH, o ganho em % e o semáforo contra a **meta de +20%** (editável). Há também o pç/HH projetado (opcional), como estimativa para o plano de ação.
- **Payback** no MFV: HH economizadas/mês = produção mensal × (1/pç/HH base − 1/pç/HH atual). Ganho mensal = HH × custo da HH + outros ganhos informados. Payback = investimento ÷ ganho mensal.
- **Peças produzidas por filmagem** na cronoanálise: com as peças de todas as filmagens, os elementos **tipo A** passam a entrar no ciclo como **Σtempo ÷ Σpeças** (tempo por unidade), em vez do tempo total observado. Isso corrige a comparação do TC com o takt. O painel mostra também o ciclo real observado de cada filmagem.
- O **resumo executivo da IA** (MFV) passa a considerar o pç/HH real e o payback quando existirem, deixando claro quando o valor é projetado.

### Compatibilidade
- Os arquivos passam para a versão 2 do formato (estudo e MFV). Os arquivos da REV 1.0/1.1 abrem normalmente; sem peças por filmagem, os resultados não mudam.
- O preenchimento do **modelo B+P** (Excel) continua com as fórmulas da planilha (tipo A = Σtempo). O Excel simples, o CSV e o JSON levam o tempo por unidade.

### Correções
- MFV no celular: a tabela de estoques não gera mais rolagem horizontal na página.

### Testes
- 111 testes de unidade (10 novos: filmagens, pç/HH e payback) e o novo teste de navegador `tests/e2e.rev12.js` (22 verificações, incluindo foco na digitação, persistência e celular).

---

## REV 1.1 — 16/10/2026 (assistente de IA)

Recurso **opcional**, que funciona só com internet e com a chave de API do próprio consultor (Google AI Studio).

### Novidades
- Botão **✨ IA** na barra da grade da cronoanálise:
  1. **Classificar valor e desperdício** dos elementos ainda sem classificação;
  2. **Sugerir ações Kaizen (ECRS)** para os elementos que não agregam ou são incidentais;
  3. **Redigir constatações e soluções** a partir dos números do estudo (rascunho editável);
  4. **Padronizar nomes dos elementos** ("anotar a OP" → "Anotar OP"). O app só aceita nomes que existem no estudo, e o resumo passa a agrupar corretamente;
  5. **Perguntas livres sobre o estudo** (ex.: "o que atacar primeiro?"), com resposta baseada só nos dados do estudo e opção de levar para as constatações.
- MFV: **✨ Resumo executivo (IA)**, um rascunho para a diretoria do cliente com takt × gargalo, operadores atuais × ideais, estoques e próximos passos. Pode ser acrescentado às premissas e usa a mesma configuração da IA.
- **Fora do escopo, por decisão do consultor:** análise de vídeo com IA.
- **A IA só sugere:** cada sugestão aparece com caixa de seleção e só é aplicada com aprovação, e apenas em campos vazios. Os cálculos (TS, TN, TP, takt, GBO) continuam sem IA.
- **Anonimização ligada por padrão:** o nome do cliente e do posto não são enviados. As respostas voltam com os nomes reais.
- **Chave guardada só no navegador do aparelho:** não vai para o GitHub, para a pasta do OneDrive nem para os arquivos do estudo. Há a opção de apagar.
- **Modelos carregados da própria chave**, com sugestão de um modelo "flash" estável, para não depender de nomes que mudam.
- Botões desabilitados sem internet.

### Testes
- 12 testes de unidade da IA (101 no total) e teste de navegador com a API **simulada** (25 verificações): anonimização, aplicação seletiva, renomeação, perguntas, resumo do MFV, persistência e chave fora do arquivo do estudo.
- O uso com a chave real do consultor deve ser conferido no primeiro acesso, porque o ambiente de testes não tem acesso aos servidores do Google.

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
