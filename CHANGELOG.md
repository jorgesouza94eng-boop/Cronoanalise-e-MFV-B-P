# Histórico de revisões — Lean Chrono & MFV

Controle de revisões do aplicativo de Cronoanálise e apoio ao Mapa de Fluxo de Valor (Programa Brasil Mais Produtivo).

| Revisão | Data | Situação |
|---|---|---|
| **REV 1.22** | 30/10/2026 | Peças = 0 para filmagem que continua outra (sem peças novas) |
| **REV 1.21** | 30/10/2026 | Minimizar o assistente de IA enquanto ele trabalha |
| **REV 1.20** | 30/10/2026 | IA: sugestão Kaizen para todos os produtos e etapas, com pedido mais assertivo |
| **REV 1.19** | 28/10/2026 | Plano de Ação 5W2H por cliente, com as ações Kaizen da cronoanálise |
| **REV 1.18** | 28/10/2026 | Classificação copiada para as linhas do mesmo elemento |
| **REV 1.17** | 22/10/2026 | IA: nova tentativa automática quando o Gemini está sobrecarregado (erro 503) |
| **REV 1.16** | 22/10/2026 | Arquivar estudos, MFVs e grupos (tirar da lista sem apagar) |
| **REV 1.15** | 22/10/2026 | Coluna Etapa na cronoanálise: TP por etapa do processo, que vira etapa do MFV já ponderada |
| **REV 1.14** | 22/10/2026 | Vários operadores no mesmo estudo, MFV com produto estratificado e avisos de consistência |
| *REV 1.13 (revertida)* | 22/10/2026 | Desfeita a pedido do consultor; o app voltou à REV 1.12 |
| **REV 1.12** | 21/10/2026 | "Considerar no mix" por produto, demanda geral não repetida no mix e nome do vídeo por filmagem |
| **REV 1.11** | 21/10/2026 | Conferência dos vínculos do MFV (contagem dupla, mix, avisos e demanda) |
| **REV 1.10** | 20/10/2026 | Sair da janela inicial sem abrir um documento |
| **REV 1.9** | 20/10/2026 | Yamazumi (grupos de estudos), grupo Posto no MFV e comparação T1 × T3 |
| **REV 1.8** | 20/10/2026 | Payback no padrão B+P e regras do programa no CLAUDE.md |
| **REV 1.7** | 17/10/2026 | Família sugerida no Novo MFV |
| **REV 1.6** | 17/10/2026 | Suporte à planilha de cronoanálise REV2.1 da equipe |
| **REV 1.5** | 16/10/2026 | Preencher o produto para baixo |
| **REV 1.4** | 16/10/2026 | Carga do posto com vários produtos e ligação Cronoanálise → MFV |
| **REV 1.3** | 16/10/2026 | Início por filmagem, vários produtos no mesmo estudo e filtros |
| **REV 1.2** | 16/10/2026 | Comprovação da meta B+P: pç/HH real, payback e acíclicos por unidade |
| **REV 1.1** | 16/10/2026 | Assistente de IA (Gemini), opcional |
| **REV 1.0** | 16/10/2026 | Versão estável, validada com as planilhas B+P da Laje Forte |

---

## REV 1.22 — 30/10/2026

Opção **A** do consultor: filmagem que é **continuação** de outra (ex.: um segundo vídeo só com a preparação da massa da mesma fornada).

- O campo **Peças** da filmagem passa a aceitar **0** = continuação de outra filmagem, sem peças novas. Antes, só aceitava número maior que zero, e a filmagem sem peças deixava os acíclicos do produto como tempo total.
- A filmagem com 0 conta como preenchida, e os **acíclicos (tipo A)** do produto passam a ser **Σtempo ÷ peças das demais filmagens**, incluindo o tempo da continuação. Ex.: F4 = 280 peças e F3 = 0 → acíclicos da F3 e da F4 ÷ 280.
- Na tela, a filmagem mostra "continuação (sem peças novas)". O aviso informa "Tipo A = Σtempo ÷ 280 peças (1 filmagem de continuação, com 0 peças)", e o **ciclo real observado** passa a incluir o tempo da continuação.
- Todas as filmagens com 0: o app avisa que falta informar as peças na filmagem em que foram produzidas (os acíclicos continuam como tempo total). Número negativo continua inválido.
- Os elementos tipo C não mudam (Σtempo ÷ Σqtd). O conferidor "Σ quantidade ≠ peças" ignora elemento que só aparece na continuação.
- Service worker v30. Testes: `tests/calc.test.js` (REV 1.22) e `tests/e2e.rev122.js`.

---

## REV 1.21 — 30/10/2026

Opção **A** do consultor: minimizar o assistente de IA enquanto ele trabalha.

- Botão **"−" (Minimizar)** na janela da IA. Fechar com "×" ou Esc durante uma tarefa também minimiza. A grade fica livre para trabalhar enquanto a IA responde.
- **Selo no canto da tela** com o andamento: "✨ IA trabalhando… (Kaizen, 14 elemento(s))". Ao terminar, fica verde ("Sugestões prontas — abrir") e aparece um aviso na tela. Em caso de falha, fica vermelho ("Falha na IA — ver detalhe"). Um clique reabre a janela com as sugestões ou com o detalhe do erro.
- **Sugestões presas ao estudo do pedido:** se outro estudo estiver aberto, o botão Aplicar fica desabilitado e o app informa de qual estudo são as sugestões. O "×" do selo descarta as sugestões não aplicadas.
- **Edições durante a espera:** as sugestões continuam valendo para o elemento certo. Se o elemento for renomeado ou apagado, aquela sugestão não é aplicada e o app informa quantas ficaram de fora.
- **Uma tarefa por vez:** enquanto a IA trabalha, os botões da IA ficam bloqueados, para não gastar a cota duas vezes nem misturar respostas.
- Vale para classificar, Kaizen, constatações, padronizar nomes e pergunta livre. No celular, o selo ocupa a largura da tela e os avisos sobem para não ficar por baixo dele.
- Nenhum cálculo muda. Service worker v29. Teste: `tests/e2e.rev121.js` (Gemini simulado com resposta segurada).

---

## REV 1.20 — 30/10/2026

Decisão do consultor: **A + B1 + prompt novo** para o botão "Sugerir ações Kaizen (ECRS)" do assistente de IA.

**A — correções (antes, alguns elementos ficavam sem sugestão):**
- Vão para a IA os elementos de **todos os produtos, etapas e operadores** do estudo. Antes, ia só o produto (e o operador) selecionado no Resumo.
- Cada elemento leva um **número (id)** e a resposta volta pelo id. Antes, a ligação era pelo nome, e o mesmo nome em etapas ou produtos diferentes recebia uma ação só, na 1ª linha.
- A ação é gravada no **elemento certo** (mesmo produto, operador, etapa e nome), na 1ª linha dele. Ação já digitada continua não sendo substituída.
- Se a IA deixar elementos sem resposta, o app **pede de novo só esses** (1 vez). Se ainda faltar algum, a mensagem lista quais.
- A mensagem informa o que ficou fora do pedido: elementos já com ação, "Agrega" e sem classificação.

**B1 — caixa "Kaizen: incluir também os elementos Agrega e os sem classificação"** (desmarcada por padrão). Sem ela, vão só os Não agrega e Incidental, como antes.

**Prompt novo (mais assertivo):**
- Contexto completo: produto, etapa, operador, posição na sequência, elemento anterior e seguinte, tipo, ocorrências, tempo no ciclo, % do ciclo, valor e desperdício. Por produto: takt, tempo padrão, diferença TP − takt e situação.
- Regras: ordem ECRS (Eliminar → Combinar → Reorganizar → Simplificar); baixo custo e sem automação; ação = verbo + o quê + onde (até 25 palavras); uso dos vizinhos para Combinar e Reorganizar; tabela desperdício → ferramenta (práticas usuais de Lean, não regra oficial do B+P); justificativa citando dado do estudo; proibido inventar medidas e custos; Agrega nunca é eliminado.
- Exemplo de ação boa e de ação ruim.
- Resposta com ferramenta Lean (lista do Plano 5W2H), justificativa, confiança (alta / média / baixa) e **"sem ação"** com o que falta observar, em vez de ação inventada.
- Esquema JSON obrigatório do Gemini (`responseSchema`) e temperatura 0,2. Modelo que não aceita o esquema: o app repete o pedido sem ele.

**Na tela:** cada sugestão mostra produto • etapa • operador, a ferramenta, a confiança e a justificativa. Confiança baixa vem desmarcada; "sem ação" não é aplicável e mostra o que observar.

**Plano 5W2H:** a ferramenta sugerida fica guardada na linha (`kaizenTool`, campo opcional do estudo; sai junto quando a ação é apagada) e vai para a coluna Ferramenta Lean ao usar "+ Ações da cronoanálise".

- Nenhum cálculo muda. A anonimização continua ligada por padrão e a IA continua só sugerindo. Service worker v28.
- Testes: `tests/ai.test.js` (Kaizen REV 1.20 e esquema), `tests/plano-rev119.test.js` (P9) e `tests/e2e.rev120.js`.

---

## REV 1.19 — 28/10/2026

Opção **A** do consultor: novo módulo **Plano de Ação (5W2H)** (`plano.html`), no menu das 4 páginas.

- **Um plano por cliente** (`Plano_<cliente>_<data>_<id>.json`, formato v1), salvo no navegador e na pasta do OneDrive como os outros módulos (revisão, cópia `_conflito_`, Arquivar para `_Arquivo`).
- **Cabeçalho = cabeçalho do modelo 5W2H do B+P:** objetivo (padrão "Aumentar a produtividade (pç/HH) em 20%"), meta (%), indicador, data da criação, responsável, data da revisão e responsável pela revisão.
- **Colunas do 5W2H:** O que, Como, Quem, Quando (início e fim), Onde, Por que, Quanto (R$) e % completo (digitado). **Campos extras:** prioridade, status, tipo ECRS, desperdício atacado, ferramenta Lean e origem.
- **"+ Ações da cronoanálise":** lista as ações digitadas na coluna "Ação sugerida / Kaizen (ECRS)" dos estudos do cliente (o mesmo elemento com a mesma ação em várias linhas = 1 ação), **da maior para a menor parcela do ciclo** (Pareto). As marcadas viram ações com O que ("Eliminar — Buscar bandeja"), Como (texto da ação), Onde (processo — produto — etapa — operador), Por que (valor / desperdício e s/pç com o % do ciclo), tipo ECRS, desperdício e prioridade. **Quem, Quando, Quanto e % ficam em branco** para o consultor (nada é inventado). Ação já incluída aparece desabilitada.
- **Status calculado** (não digitado): Concluída (% = 100), Atrasada (fim já passou e % < 100), Em andamento (% > 0 ou início já chegou), Não iniciada. % fora de 0–100 é aviso e não conclui a ação. Filtro por status.
- **Indicadores:** nº de ações, atrasadas, concluídas, % médio do plano, próximo prazo e **Σ Quanto**.
- **Origem conferida:** se a ação ou o elemento mudar (ou sair) da cronoanálise, a ação mostra ⚠ e um aviso; o texto do plano não é alterado sozinho.
- **MFV:** no payback, ao lado de "Investimentos do cliente", aparece a **referência** do Σ Quanto do plano do mesmo cliente. **Não é somado** ao investimento: o consultor digita só o que o cliente investiu de fato.
- **Exportar Excel:** com o **modelo 5W2H** do consultor (Planos → Modelo Excel, guardado também em `_Modelos`), preenche a aba 5W2H (cabeçalho e linhas 8 a 24, **17 ações por arquivo**; mais ações = mais arquivos `_parte2`…), sem alterar o layout, e acrescenta a aba **"Plano (app)"** com todas as ações e os campos extras. Sem modelo: Excel simples com todas as colunas. Também Imprimir e Exportar JSON.
- Os cálculos da cronoanálise, do MFV e do payback não mudam. Menu dos módulos quebra linha no celular. IndexedDB v4 (store "planos"). Service worker v27.
- Testes: `tests/plano-rev119.test.js` (status, resumo, ECRS, ações da cronoanálise, JSON, Excel e modelo 5W2H sintético) e `tests/e2e.rev119.js`.

---

## REV 1.18 — 28/10/2026

- **Classificação copiada para as linhas do mesmo elemento:** ao escolher o **Tipo**, o **Valor** ou o **Desperdício** numa linha, as outras linhas com o mesmo nome de elemento (no mesmo produto e na mesma etapa) recebem a mesma classificação.
  - Linhas **sem classificação**: preenchidas na hora, com o aviso "… aplicado em N linha(s) de "Elemento" (03, 07)".
  - Linhas **já classificadas com outro valor**: o app pergunta ("… também aparece nas linhas 04 (Agrega) … Trocar essas linhas?"). OK troca; Cancelar mantém.
  - Valor vazio ("—") não é copiado, para não apagar as outras linhas. Com **filtro ativo**, só a linha editada muda (como no Produto e na Etapa).
  - Evita a "classificação divergente", em que valia só a 1ª ocorrência.
- Continua valendo a cópia no sentido inverso (REV 1.0): ao digitar o nome de um elemento já classificado, a linha nova copia tipo, valor e desperdício.
- Nenhum cálculo muda. Service worker v26. Testes: `tests/classificacao-rev118.test.js` e `tests/e2e.rev118.js`.

---

## REV 1.17 — 22/10/2026

- **Assistente de IA (Gemini):** quando o Google responde **503** (modelo sobrecarregado, em geral passageiro), o app tenta de novo sozinho mais **2 vezes**, depois de ~3 s e ~8 s. Durante a espera, mostra "Servidor do Gemini ocupado, tentando de novo (2/3)...". Vale para a Cronoanálise (✨ IA) e para o Resumo executivo do MFV.
- Se o 503 persistir, a mensagem fica em português: "Gemini sobrecarregado no momento (erro 503). Tente em alguns minutos ou escolha outro modelo em ✨ IA → configuração."
- Os outros erros (chave inválida, limite da chave 429, filtro) não são repetidos. Nenhum cálculo muda, e o envio de dados e a anonimização continuam iguais.
- Service worker v25. Teste: `tests/ai.test.js` (nova tentativa, mensagem e 429 sem repetição).

---

## REV 1.16 — 22/10/2026

Opção **A** do consultor: **Arquivar**, sem exclusão definitiva.

- Botão **"Arquivar"** em cada item das listas de **Estudos** (Cronoanálise), **MFVs** e **Grupos** (Yamazumi). O documento aberto não pode ser arquivado.
- **Com a pasta conectada:** o arquivo vai para a subpasta **`_Arquivo`** da pasta (o OneDrive sincroniza) e sai da lista e do navegador. Nada é apagado. Para trazer de volta, mova o arquivo de `_Arquivo` para a pasta. Se já houver um arquivado com o mesmo nome, o novo recebe a data no nome. Vai a versão mais recente (navegador ou pasta).
- **Sem pasta (celular ou navegador sem pasta):** o app baixa o `.json` (backup) e tira o item do navegador. Para trazer de volta: "Importar JSON".
- Na Cronoanálise, o botão **"Remover"** fica só para o estudo que existe apenas no navegador. Antes ele também aparecia para estudos da pasta, mas só tirava a cópia do navegador e o estudo continuava na lista.
- Arquivar não altera os outros documentos. Um MFV com etapa de um estudo arquivado mantém o último TC. Um grupo do Yamazumi com estudo arquivado mostra "estudo não encontrado".
- Service worker v24. Teste: `tests/e2e.rev116.js`, com a pasta simulada.

---

## REV 1.15 — 22/10/2026

Coluna **Etapa** na cronoanálise, para o produto estratificado em etapas do processo (ex.: Laminação, Queijo, Enrolar), sem precisar de um estudo por etapa nem usar a coluna Produto como etapa. Decisões do consultor: ponderação **marcada** nas etapas que vêm da coluna Etapa; **operador automático**; correção do service worker incluída.

### Cronoanálise
- Caixa **"Etapas"** (ao lado de "Vários produtos") mostra a coluna **Etapa** antes do elemento. Sem a caixa marcada e sem etapa nas linhas, a grade e os resultados ficam iguais aos da REV 1.14.
- A linha nova repete a etapa da anterior; ao confirmar uma etapa, ela é **preenchida para baixo** nas linhas vazias (ou o bloco é trocado, com confirmação), como no Produto. Enter: Produto → Etapa → Elemento.
- **TP por etapa**, por produto, na ordem em que as etapas aparecem na grade (nota do Resumo: "Etapas (3): 1. Laminação TP 5,0 | 2. Queijo TP 3,0 | 3. Enrolar TP 13,0"). O TP do produto = Σ das etapas.
- O mesmo elemento em etapas diferentes é outro elemento no resumo ("[Laminação] Pegar bandeja" e "[Enrolar] Pegar bandeja"). Linhas sem etapa ficam em "(sem etapa)".
- Filtro **Etapa** (só exibição).
- Com vários operadores: por etapa e por operador. Etapa de um só operador é dele; etapa de 2+ operadores vira posto (ciclo = maior TP, conteúdo = Σ). Nunca soma tempos de operadores diferentes.
- A demanda continua por produto (a do estudo ou a do quadro Carga do posto) e o mix por produto continua valendo.

### MFV
- O estudo com etapas aparece como "(N etapa(s))" e vira **uma etapa do fluxo por etapa do processo**, na ordem da grade, com:
  - **Ponderar pela demanda do produto já marcado** (TP × demanda do produto ÷ demanda da família);
  - **operador automático**: "Op1" (ou o operador da etapa); etapa de 2+ operadores entra como posto (TC = ciclo, Nº ops = N, conteúdo). Se outro estudo já usa "Op1", recebe "Op1 B", "Op1 C"… (o consultor pode renomear para juntar ou separar as cargas).
- "Atualizar TCs" atualiza o TP, o conteúdo, o Nº ops e a demanda de cada etapa. Etapa renomeada ou removida no estudo mantém o último TC, com aviso.
- **Contagem dupla:** etapas diferentes do mesmo estudo não são contagem dupla. Continuam sendo: a mesma etapa duas vezes, o produto inteiro junto com uma etapa dele, o Mix junto com outra etapa, e produtos diferentes do mesmo posto **sem** ponderação e operador.
- Avisos de qualidade do estudo aparecem só na 1ª etapa dele (antes repetiam em todas).
- MFV versão 6 com o campo `studyEtapa` por etapa (MFVs da REV 1.14 abrem iguais).

### Excel, CSV e JSON
- Excel simples: coluna "Etapa" na GERAL e quadro "Etapas do processo" na Análise. CSV: coluna "Etapa" e bloco "ETAPAS DO PROCESSO". JSON: campo `etapa` por linha, `settings.multiEtapa` e `results.etapas`.
- Excel no modelo B+P: o modelo não tem coluna Etapa; o nome de cada elemento vai com a etapa ("Laminação • Abrir a massa"), para as fórmulas da planilha agruparem igual ao app (aviso na exportação).

### Correções
- **Service worker (v23):** ao atualizar, baixa os arquivos direto do servidor (sem o cache HTTP do navegador). Evita a página nova com o código antigo (colunas do MFV deslocadas, visto na REV 1.14).
- Números exibidos sem o resíduo da conta binária (0,7499999… aparecia "0,7"; agora "0,8"). Os cálculos não mudam.
- Mensagem do Novo MFV conta as etapas criadas (antes contava os estudos).

### Arquivos e compatibilidade
- Estudo passa para a **versão 7** (campo `etapa`). Estudos da REV 1.14 abrem iguais. Um estudo salvo na REV 1.15 não abre em app da REV 1.14.
- Testes: `tests/etapas-rev115.test.js` (E1–E8) e `tests/e2e.rev115.js`.

---

## REV 1.14 — 22/10/2026

As três fases da especificação: Fase 1 (vários operadores no mesmo estudo), Fase 2 (MFV com produto estratificado) e Fase 3 (avisos de consistência). A Fase 2 entrou na mesma revisão a pedido do consultor (service worker v22).

### Fase 1 — vários operadores no mesmo estudo
- Parâmetro **Nº de operadores** (padrão 1; com 1 tudo fica igual à REV 1.12) e **Tipo** (POSTO, padrão, ou LINHA) a partir de 2 operadores.
- Cada linha pertence a um operador: etiqueta **Op1, Op2…** no nº da linha (sem coluna nova na grade). Troca por **Alt+1…Alt+9** ou clicando na etiqueta (menu com "+ Novo operador" e "Dar nome ao OpN…"). Sem limite de operadores; acima de 9, só pela etiqueta. Linha nova repete o operador da anterior.
- Nome do operador é opcional e **não vai para a IA** (ela recebe só "OpN").
- **Tempo subtraído pelo mesmo operador na mesma filmagem** (a 1ª linha de cada operador usa o Início da filmagem). As linhas podem ser intercaladas; a validação ("tempo final menor que a leitura anterior do OpX") é por operador.
- As peças das filmagens valem para todos os operadores; acíclicos (tipo A) = Σtempo ÷ Σpeças por operador.
- Dica fixa: "Atividade feita em paralelo por mais de um operador: a Qtd de cada um é a produção do posto no trecho."
- Avisos: "OpX termina em mm:ss; a filmagem termina em mm:ss" e, a partir de 5 operadores, "Muitos operadores no mesmo vídeo: confira a linha do tempo de cada um."
- Seletor **Operador** no resumo (Todos = posto) e filtro por operador na grade (só exibição).
- Posto: **ciclo = maior TP**, conteúdo = Σ (TP − espera), balanceamento = conteúdo ÷ (n × ciclo), operadores ideais = conteúdo ÷ takt, capacidade = tempo líquido ÷ ciclo, status pelo ciclo. Com vários produtos, o mix usa o ciclo do posto de cada produto. Na compilação do posto, a % é sobre a soma dos tempos de todos os operadores.
- MFV: tipo POSTO = 1 etapa (TC = ciclo, Nº ops, conteúdo do posto); tipo LINHA = 1 etapa por operador. A conferência dos vínculos aceita os operadores de um mesmo estudo em etapas diferentes (LINHA) e acusa contagem dupla quando o mesmo operador (ou o posto inteiro e um operador) aparece duas vezes.
- Yamazumi: estudo com N operadores vira N barras; aviso de contagem dupla quando o mesmo estudo entra duas vezes no grupo.
- Excel no modelo B+P: **um arquivo por operador** (e por produto), com sufixo `_OpN`. Excel simples, CSV e JSON ganham o campo "Operador" e os resultados por operador e do posto.
- Limitação: os operadores precisam aparecer no **mesmo vídeo** e produzir as **mesmas peças** do trecho filmado.

### Fase 2 — MFV com produto estratificado
- **Ponderar pela demanda do produto** (caixa na Origem do TC da etapa de estudo): TC = TP × demanda própria do produto ÷ demanda diária da família (a do MFV). Desligada por padrão; não se aplica ao Mix (já ponderado) nem ao TC digitado. A origem mostra "TP 6,72 × 200/800 → 1,68". Produto sem demanda própria: TC em "--" e aviso, sem herdar a demanda geral. A demanda própria vem do estudo (estudo de 1 produto = demanda do estudo) e é atualizada com "Atualizar TCs". Etapa ponderada não gera o aviso de demanda diferente da família.
- **Operador compartilhado entre etapas** (coluna Operador da tabela de etapas, com autocompletar): etapas com o mesmo operador são do mesmo posto. Carga do operador = Σ TC das etapas dele; a conferência mostra carga, % do takt e capacidade (tempo disponível ÷ carga). Operadores atuais = operadores distintos + Nº ops das etapas sem operador. **Gargalo** = maior entre o maior TC de etapa e a maior carga de operador, informando qual dos dois. Kaizen em etapa de operador compartilhado usa a capacidade do operador. Ops efet. da linha mostra a fração do operador (TC ÷ carga). Linha vermelha "Carga do OpX" no GBO.
- **Etapa não medida** (opção na etapa manual): só nome e posição no fluxo; barra tracejada "não medida" no GBO; fora de todos os cálculos; aviso "Fluxo incompleto: N etapa(s) sem TC. Gargalo e capacidade valem só para as etapas medidas."
- **Tempo de processamento** (lead time) = Σ TP original, sem a ponderação.
- **Exportação EP:** etapa não medida fica fora da tabela de processos; Nº ops da etapa de operador compartilhado = TC ÷ carga (a soma do operador dá 1); premissas acrescentadas com o operador (etapas, carga, % do takt e capacidade), a ponderação, as etapas não medidas e o aviso "A aba EP calcula gargalo e produção do processo Kaizen pelo TC da linha; com operador compartilhado, considerar a capacidade do operador informada aqui."
- MFV passa para a **versão 6** do arquivo (campos `weighted`, `studyDemand`, `operatorTag` e `unmeasured` por etapa). MFVs da REV 1.12 abrem com resultados iguais.

### Fase 3 — avisos de consistência
- 8.1: Σ quantidade de um elemento tipo C diferente das peças das filmagens em que ele aparece.
- 8.2: tempo do ciclo × tempo observado por peça com diferença acima de **10%**.
- 8.3: ao exportar no modelo REV2.0 com acíclicos por peça, aviso para usar o modelo REV2.1 (a aba Análise do REV2.0 soma os acíclicos sem dividir pelas peças).
- 8.4: no MFV, tempo disponível diferente do tempo líquido dos estudos vinculados (diferença acima de 0,5 min/dia).
- 8.5: a exportação para a aba EP continua gravando o uptime como fração na coluna G (90% → 0,9); a planilha calcula os operadores efetivos na coluna H (F × G). O uptime não altera TC nem capacidade.

### Arquivos e compatibilidade
- Estudo passa para a **versão 6** (campo `operador` por elemento e `numOperadores`, `tipoOperadores`, `nomesOperadores`, `operadorExibido` nas configurações) e MFV para a **versão 6**. Arquivos da REV 1.12 abrem iguais. Um estudo ou MFV salvo na REV 1.14 não abre em app da REV 1.12.
- Service worker v22 (v21 foi a primeira publicação da REV 1.14, sem a Fase 2). Depois de atualizar, use **Ctrl+F5** (ou feche e abra o app no celular) para carregar a nova revisão.
- Testes: `tests/operadores-rev114.test.js` (T1–T12, A1–A4), `tests/mfv-estratificado-rev114.test.js` (M1–M9), `tests/template.test.js` (A3, T12, M5), `tests/e2e.rev114.js` e `tests/e2e.rev114-mfv.js`.

---

## Reversão da REV 1.13 — 22/10/2026

- A pedido do consultor, o app voltou à **REV 1.12** (commit de reversão do `2eae6a6`; o histórico da REV 1.13 continua no Git e pode ser reaplicado).
- Saíram: coluna e resumo por macro-etapa na cronoanálise, coluna Ocupação e quadro "Ocupação dos recursos" no MFV, barras por macro-etapa no Yamazumi e a grade mais larga.
- Service worker v20, para os aparelhos que já tinham a REV 1.13 receberem a versão restaurada.
- **Atenção:** um estudo com macro-etapas, se for salvo na REV 1.12, perde as macro-etapas (o campo não existe nesta revisão). Os demais dados não mudam.

---

## REV 1.12 — 21/10/2026 (considerar no mix e nome do vídeo)

### Novidades
- **"Considerar no mix"** por produto, no quadro **Carga do posto**. Vem marcado por padrão.
  - O produto desmarcado sai da carga, da ocupação, do takt misto e do TC ponderado.
  - Ele continua com TP, resumo, gráficos, capacidade e takt próprios.
  - A linha fica em cinza, com a etiqueta "fora do mix" e "--" em demanda, carga e % do tempo.
- **Avisos do mix:**
  - "Mix parcial: ocupação do posto subestimada, produto(s) X fora da carga". O status ganha "(mix parcial)";
  - "Informe a demanda ou inclua um produto no mix" quando nenhum produto está incluído.
- **Nome do vídeo** por filmagem, no bloco "Filmagens do estudo". Aparece:
  - na etiqueta F1, F2… e no filtro de filmagem;
  - na coluna "Vídeo" do Excel simples e do CSV;
  - no JSON.
- **MFV:**
  - a opção "Mix (TC ponderado)" usa só os produtos incluídos;
  - o produto fora do mix continua selecionável, com o aviso "produto fora do mix na Cronoanálise";
  - a etapa Mix avisa quando o mix é parcial;
  - uma etapa Mix cujo mix ficou incompleto mantém o último TC e avisa.
- **Exportações:** coluna "Considerar no mix" no Excel simples e no CSV; `considerarNoMix` por produto e a nota de mix parcial no resumo do JSON.
- **Revisão no cabeçalho** das três páginas (REV 1.12). Se não aparecer, recarregue com Ctrl+F5.

### Mudança de regra (decisão D1 do consultor)
- Com vários produtos, o produto **sem demanda própria não herda mais a demanda geral** no mix. A demanda geral é a do posto e, repetida em cada produto, contava a demanda uma vez por produto (exemplo: 594/dia virava 1.188/dia com 2 produtos).
- Sem demanda própria, carga, ocupação, takt misto e TC ponderado ficam em "--", com o aviso "informe a demanda ou desmarque 'Considerar no mix'".
- **Estudos já salvos afetados:** só os com vários produtos e sem a demanda de algum produto. O quadro do mix passa a "--", e o TP, o resumo e o takt de cada produto não mudam. A tela explica a mudança.

### Sem mudança
- Estudos de um produto só; estudos com a demanda de todos os produtos; Yamazumi (não usa o mix); modelo B+P da cronoanálise (um arquivo por produto).

### Compatibilidade
- Estudo no formato versão 5. Arquivos anteriores abrem com todos os produtos no mix e sem nome de vídeo.

### Testes
- 154 testes de unidade (11 novos em `tests/mix-rev112.test.js`, incluindo T1 a T7 e o rótulo da revisão). Novo teste de navegador `tests/e2e.rev112.js`. Os testes da REV 1.4 e 1.11 foram ajustados à decisão D1.

---

## REV 1.11 — 21/10/2026 (conferência dos vínculos do MFV)

Só avisos: nenhum cálculo do MFV muda.

### Novidades
- **Contagem dupla:** o MFV avisa e pede confirmação quando o mesmo posto entra mais de uma vez. Isso acontece em três casos:
  - **Mix e produto** do mesmo estudo;
  - dois produtos do mesmo estudo;
  - um estudo que já está num grupo do Yamazumi e também em outra etapa.
  - No **Novo MFV**, o aviso aparece enquanto você marca os estudos.
- **Mix sem demanda por produto:** aviso de **pesos iguais** (média simples) quando os produtos do estudo não têm demanda própria. Quando só parte não tem, o aviso diz quais produtos.
- **Avisos do estudo levados à etapa:**
  - acíclicos (tipo A) como tempo total, sem as peças das filmagens;
  - elementos sem classificação de valor;
  - tipo ou valor divergente;
  - linhas com erro;
  - avisos dos grupos do Yamazumi.
  - No Novo MFV, o estudo com aviso aparece com ⚠ (passe o mouse para ver).
- **Ordem das etapas:** no Novo MFV, as etapas seguem a **ordem em que os estudos são marcados** (1º, 2º, 3º…), e não a ordem alfabética.
- **Demanda da família:** aviso quando a demanda diária usada nos estudos é diferente da demanda diária do MFV (tolerância de 1%). O takt do MFV usa a demanda da família inteira (Módulo 6).

### Testes
- 143 testes de unidade (4 novos em `tests/mfv-checks.test.js`). Novo teste de navegador `tests/e2e.rev111.js`.

---

## REV 1.10 — 20/10/2026 (sair da janela inicial)

### Correções
- Sem documento aberto, a janela inicial (estudos, MFVs ou grupos) prendia o usuário: o × ficava escondido, o Esc era bloqueado e a janela cobria o menu. Agora:
  - o menu **Cronoanálise · MFV · Yamazumi** aparece também no cabeçalho da janela;
  - o **×** e o **Esc** fecham a janela sempre;
  - sem documento aberto, a página mostra só "Nenhum … aberto" e o botão para abrir ou criar (os campos e tabelas ficam escondidos).
- Ctrl+Enter (nova linha) não age sem estudo aberto.

### Testes
- Novo teste de navegador `tests/e2e.rev110.js` (as 3 páginas sem documento). Nenhuma mudança nos cálculos nem nos arquivos.

---

## REV 1.9 — 20/10/2026 (Yamazumi e grupo Posto no MFV)

### Novidades
- **Página Yamazumi** (`yamazumi.html`, no menu de todas as páginas). Um grupo junta estudos de cronoanálise, e cada estudo = 1 operador:
  - **Posto:** vários operadores no mesmo posto. Vira **1 etapa** no MFV.
  - **Linha:** estudos em sequência. Cada estudo vira **1 etapa** no MFV.
- **Gráfico de barras empilhadas** com o TP de cada estudo e a linha do takt:
  - por **classe de valor**: Agrega, Incidental, Não agrega, Espera, Sem classificação e Tolerância;
  - ou **por elemento**, com a cor da classe.
- **Indicadores do grupo:**
  - ciclo (maior TP) e % do takt;
  - conteúdo de trabalho = Σ (TP − espera);
  - balanceamento = conteúdo ÷ (nº de estudos × ciclo);
  - operadores ideais = conteúdo ÷ takt;
  - capacidade, HH/pç e pç/HH teórico.
- **Takt do grupo** editável, pré-preenchido com o do 1º estudo. Vale só no Yamazumi; no MFV vale o takt do MFV.
- **Avisos:** estudo não encontrado, empresas diferentes, tolerâncias diferentes, produtos diferentes no posto, peças das filmagens incompletas, elementos sem classificação e linhas com erro.
- **Comparação T1 × T3** (antes × depois) com outro grupo da empresa:
  - indicadores: ciclo, conteúdo, operadores, HH/pç, pç/HH, balanceamento, % Não agrega e movimentação + transporte;
  - variação = (T3 − T1) ÷ T1, com o resultado "melhora", "piora" ou "igual".
- **Exportação:**
  - Excel simples com as abas Yamazumi, Elementos (com filtro) e T1 x T3;
  - impressão;
  - JSON.
  - Botão **"→ MFV"**, que inclui o grupo no MFV da empresa.
- **Grupo Posto no MFV** (regra confirmada, ver CLAUDE.md):
  - TC = ciclo do posto; nº de operadores = nº de estudos;
  - operadores ideais = Σ (TC das etapas comuns + conteúdo dos grupos) ÷ takt;
  - novo **balanceamento da linha** = Σ conteúdo ÷ (operadores atuais × gargalo);
  - TC do posto editado à mão: o conteúdo é ajustado na mesma proporção e pode ser digitado à parte, com aviso;
  - "Atualizar TCs" também atualiza os grupos.
- Exportação para o modelo MFV B+P: aviso de que a planilha calcula os operadores ideais por ΣTC.

### Correções
- Formulário "Novo grupo" limpo depois de criar (não carrega as marcações do grupo anterior).
- Botões de exportação quebram linha no celular.

### Compatibilidade
- MFV no formato versão 5 (campos da etapa de grupo). Os arquivos anteriores abrem com os mesmos resultados; sem grupos, os operadores ideais continuam ΣTC ÷ takt.
- Armazenamento do navegador na versão 3 (store nova de grupos). Os estudos e MFVs já salvos são mantidos.

### Testes
- 139 testes de unidade (10 novos no Yamazumi, incluindo o exemplo de conferência da regra). Novo teste de navegador `tests/e2e.rev19.js`.

---

## REV 1.8 — 20/10/2026 (payback no padrão B+P)

### Novidades
- **Payback no padrão do programa** (Módulo T1.4 Indicadores), agora o método padrão dos MFVs novos:
  - investimento = **custo do programa B+P** (preenchido pelo consultor) + investimentos do cliente;
  - ganho mensal = (produção mensal T3 − T1) × **preço de venda**;
  - sem a produção T3 medida, ela é **estimada** pelo ganho de pç/HH (mesmas HH) e aparece identificada como estimativa.
- O método da **mão de obra** (HH economizadas × custo da HH) continua disponível. Os MFVs das revisões anteriores com payback preenchido continuam nesse método.
- Aviso na tela: pelo preço de venda, o ganho é de faturamento e só vale se a produção a mais for vendida.
- **CLAUDE.md:**
  - regra de perguntar antes de implementar uma regra de B+P não confirmada;
  - correção das entregas do MFV (atual e futuro só para médias empresas);
  - regras do programa confirmadas na base do consultor, com o módulo de referência;
  - regra do grupo "Posto" no MFV, confirmada e a implementar.

### Compatibilidade
- MFV no formato versão 4 (campos novos do payback). Os arquivos anteriores abrem com os mesmos resultados.

### Testes
- 129 testes de unidade (2 novos, incluindo o exemplo do módulo do programa: 3,8 meses). Teste de navegador do pç/HH e payback ampliado com os dois métodos.

---

## REV 1.7 — 17/10/2026 (família sugerida no Novo MFV)

### Novidades
- O campo **Família / Produto** do Novo MFV sugere os produtos dos estudos da empresa e as famílias dos MFVs que ela já tem.
- Pelo botão **"→ MFV"** com um produto selecionado no resumo, a família já vem preenchida com o nome do produto (editável). Sem produto (ou com a opção Mix), o campo continua em branco: a família é decisão do consultor.

### Testes
- Teste de navegador da REV 1.4 ampliado (3 verificações novas). Sem mudança no formato dos arquivos.

---

## REV 1.6 — 17/10/2026 (planilha de cronoanálise REV2.1)

### Planilha REV2.1 da equipe (arquivo à parte, fora do repositório)
- Feita a partir da REV2.0, **em branco**: lançamentos, listagens, constatações, observações, caminho da pasta do atendimento e valores guardados removidos.
- Mesmo layout, gráficos e macros (código VBA idêntico ao da REV2.0).
- **Correções:**
  - acíclico por unidade (peças em GERAL!D7);
  - Análise!G3 com todos os elementos (antes, só 40);
  - tempo exato, sem truncar segundos;
  - alerta de tipo divergente;
  - ritmo por linha (GERAL!F);
  - tolerância e tempo padrão (Análise!K6:L8);
  - planilha vazia sem "QUAL TIPO?" e #DIV/0!.
- Aba **Controle de Revisão** com a lista de mudanças.

### App
- Reconhece a REV2.1 ao carregar o modelo e preenche o ritmo de cada linha, as peças das filmagens (D7) e a tolerância (L6). A REV2.0 continua aceita.
- Com a REV2.0, novo aviso quando há ritmo diferente de 100% (a planilha não tem a coluna).

### Validação
- 149 lançamentos da Laje Forte na REV2.1, recalculados no LibreOffice:
  - sem peças: G3 = 7.681 s (igual à REV2.0);
  - com peças (126): G3 = 60,960 s, igual ao app;
  - com peças, ritmo 110% e tolerância 10%: G3 = 62,752 s e TP = 69,027 s, iguais ao app.
- Exportação pela tela do app conferida (modelo reconhecido como REV2.1, sem avisos).
- 127 testes de unidade (3 novos).
- Pendente: abrir no Microsoft Excel e testar os botões das macros (Filtrar/Copiar elementos e Salvar PDF).

---

## REV 1.5 — 16/10/2026 (preencher o produto para baixo)

### Novidades
- **Coluna Produto com preenchimento para baixo**, útil ao ligar "Vários produtos" num estudo já lançado:
  - produto digitado numa linha **vazia** é copiado para as linhas vazias abaixo, até a próxima linha com produto, sem confirmação;
  - produto **trocado** pergunta se troca também o bloco seguido com o produto antigo (`Enter` = sim · `Esc` = só esta linha);
  - com **filtro ativo**, só a linha editada muda.
- `Enter` no campo Produto segue para a descrição.
- Ao entrar no campo Produto, o texto fica selecionado: digitar substitui o produto, inclusive o que acabou de ser preenchido.

### Compatibilidade
- Sem mudança no formato dos arquivos: só a tela foi alterada.

### Testes
- 124 testes de unidade (2 novos, da regra de preenchimento) e o novo teste de navegador `tests/e2e.rev15.js` (13 verificações).

---

## REV 1.4 — 16/10/2026 (carga do mix e ligação com o MFV)

### Novidades
- **Demanda por produto:** com vários produtos, cada produto tem a sua demanda diária (vazio = demanda geral). Jornada, paradas e tolerância continuam uma vez por estudo, porque são do posto.
- **Carga do posto (mix):** quadro com TP × demanda de cada produto, ocupação do posto (Σ cargas ÷ tempo líquido), takt misto e TC ponderado pelo mix.
  - O status do posto passa a ser avaliado pelo mix: 🟢 até 100% (atende o mix) · 🔴 acima de 100% (sobrecarga).
  - O quadro também sai no Excel simples e no CSV.
- **Cronoanálise → MFV:**
  - **Novo MFV com a empresa dos estudos:** o campo sugere as empresas já usadas e grava o MFV com a mesma grafia dos estudos.
  - **Estudos da empresa no Novo MFV:** os estudos marcados viram etapas com o TC preenchido, inclusive a opção "Mix (TC ponderado)".
  - **Botão "→ MFV"** na cronoanálise: abre o MFV da empresa e inclui o estudo (ou o produto exibido) como etapa, sem duplicar. Se a empresa não tiver MFV, abre o Novo MFV já preenchido. Funciona também abrindo o app direto do computador.
  - **Aviso de TC atualizado:** a atualização automática dos TCs ao abrir o MFV, que antes era silenciosa, passa a mostrar o que mudou, com a opção **Desfazer** (mantém o valor anterior como TC editado).

### Compatibilidade
- Estudos no formato versão 4 (demanda por produto). Os arquivos anteriores abrem com os mesmos resultados. O formato do MFV não mudou.

### Testes
- 122 testes de unidade (3 novos) e o novo teste de navegador `tests/e2e.rev14.js` (21 verificações). O botão "→ MFV" também foi conferido abrindo o app direto do arquivo (file://).

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
