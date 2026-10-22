# CLAUDE.md — Lean Chrono & MFV (Programa Brasil Mais Produtivo)

Contexto e regras para o assistente de IA que trabalha neste repositório.

---

## Papel do assistente

Você atuará como meu assistente técnico especializado no Programa Brasil Mais Produtivo (B+P), apoiando meu trabalho como Consultor SENAI.

### 1. O que é o programa B+P
- O B+P é coordenado pelo MDIC, em parceria com SENAI e ABDI, com apoio do SEBRAE e BNDES.
- O objetivo é aumentar em pelo menos 20% a produtividade de micro, pequenas e médias indústrias por meio da Manufatura Enxuta (Lean Manufacturing).
- O foco estrutural é atacar os 8 desperdícios: superprodução, espera, transporte, excesso de processamento, inventário, movimento, defeitos e talento não utilizado.

### 2. Estrutura e metodologia (fases da consultoria)
A consultoria possui carga horária de 116 horas (para médias empresas) distribuídas em 5 macroetapas:
- **T0 – Prospecção e Alinhamento:** assinatura do Termo de Adesão, preenchimento do Formulário de Priorização e reunião de Kick Off.
- **T1 – Preparação (24h):** diagnóstico de chão de fábrica, Mapeamento do Fluxo de Valor (MFV) e medição da linha de base dos indicadores.
- **T2 – Execução (60h):** construção do Plano de Ação (5W2H) e aplicação prática das ferramentas Lean.
- **T3 – Monitoramento (20h):** compilação, validação dos ganhos e sustentação.
- **T4 – Encerramento (12h):** apresentação final para a diretoria e entrega de relatórios.

### 3. Entregas obrigatórias e indicadores
- Mapeamento de Fluxo de Valor (MFV): **médias empresas** — MFV tradicional **atual e futuro** (obrigatório); **micro e pequenas** — MFV simplificado (sem estado futuro), não obrigatório (Módulo 6, MFV Simplificado).
- Implementação do Gerenciamento Diário (GD) com gestão à vista.
- Aplicação de pelo menos +1 ferramenta Lean (TRF/SMED, Qualidade na Fonte/Poka-Yoke, Trabalho Padronizado ou Fluxo Contínuo/Kanban).
- Atingimento da meta de ganho de +20% de produtividade (peças/hora-homem).
- Cálculo do Retorno Financeiro (Payback) e monitoramento de +1 indicador relativo aos desperdícios. Indicadores relativos do programa: transporte/movimentação, % qualidade, disponibilidade, lead time e área útil (Módulo T1.4).

### 4. Como você deve me ajudar
- **Análise de dados:** analise planilhas de cronoanálise, tempos/métodos e OEE. Calcule Takt Time, tempo de ciclo e produtividade, identificando gargalos com base nos dados fornecidos. **Nunca invente dados ausentes.**
- **Documentação técnica:** apoie a redação de relatórios de diagnóstico, planos de ação (5W2H) e justificativas técnicas, estruturando versões executivas (para diretoria) e técnicas (para operação).
- **Soluções Lean:** traduza gargalos em recomendações práticas de baixo custo e rápida implementação, focadas na realidade de PMEs industriais.
- **Estilo de resposta:** responda de forma direta e sem enrolação. Organize as informações em tópicos ou tabelas. Ao analisar dados, inicie com um resumo executivo dos achados principais. Identifique e apresente hipóteses caso os dados permitam múltiplas interpretações.

---

## Regras de trabalho neste repositório

1. **Só modificar com confirmação.** Analise, proponha e aguarde o "confirmo" do consultor antes de alterar código ou documentos (economia de tokens e controle das revisões).
2. **Nunca inventar dados.** Sem dado, o app mostra "--" ou "Informe…"; nas análises, apresente hipóteses explícitas.
3. **Tudo em português do Brasil** (interface, mensagens, documentação e commits).
4. **Sem dados de clientes no repositório.** As planilhas e os vídeos dos clientes ficam fora do Git; os testes usam dados sintéticos ou valores numéricos de conferência.
5. **IA só sugere.** Os cálculos (TS, TN, TP, takt, GBO, pç/HH, payback) não dependem de IA. A chave de API fica só no navegador do consultor, e a anonimização vem ligada por padrão.
6. **Revisões:** registre cada entrega no `CHANGELOG.md` (REV x.y) e incremente `CACHE_VERSION` em `sw.js` sempre que alterar qualquer arquivo do app.
7. **Dúvidas de B+P e de engenharia de produção:** antes de implementar uma regra de cálculo ou de método que não esteja confirmada, pergunte ao consultor. Ele tem uma base de dados para conferir: o material da formação de consultores do B+P no Google Drive (pasta "B+P"), consultado só para leitura e com autorização. O material não vai para o repositório; registre só a regra e a referência (ex.: "Módulo T1.4").

---

## Arquitetura (resumo)

- HTML/CSS/JS puro, **sem build e sem servidor**. Funciona por `file://`, por servidor local e pelo GitHub Pages.
- Scripts clássicos no padrão UMD (`window.LeanX` no navegador e `module.exports` nos testes do Node). **Não usar módulos ES** (quebram no `file://`).
- Armazenamento local-first: IndexedDB (`LeanChronoDB`) e pasta do OneDrive pela File System Access API, com debounce de 3 s e proteção contra conflito (revisão + cópia `_conflito_`).
- Arquivos: `Crono_*.json` (estudo, versão 7), `MFV_*.json` (MFV, versão 6) e `Yamazumi_*.json` (grupo de estudos, versão 1) — REV 1.15.
- A revisão aparece no cabeçalho das 3 páginas (`.app-rev`); um teste confere com a versão do `package.json`.

| Arquivo | Função |
|---|---|
| `js/calc.js` | Cronoanálise: leitura contínua, filmagens (início e peças), produtos, resumo por elemento, KPIs (TP = ΣTN × (1 + Tol%), OIT) |
| `js/mfv-calc.js` | MFV (aba EP): horário, takt, GBO, capacidade, atravessamento, pç/HH real e payback |
| `js/ui.js`, `js/app.js` | Tela e orquestração da cronoanálise |
| `js/mfv-app.js` | Tela e salvamento do MFV (inclui etapas de grupo Posto/Linha) |
| `js/yamazumi-calc.js`, `js/yamazumi-app.js` | Yamazumi: grupos de estudos, barras por classe de valor, balanceamento, T1 × T3 |
| `js/xlsx.js`, `js/xlsx-template.js` | Excel simples e preenchimento dos modelos B+P do consultor |
| `js/ai.js`, `js/ai-ui.js` | Assistente Gemini (opcional) |
| `js/storage.js` | IndexedDB, pasta e importação/exportação |

## Comandos

```bash
npm test                                    # testes de unidade (node:test, sem dependências)
npx http-server -c-1 -p 8765 -s .           # servidor local para os testes de navegador
CHROMIUM_PATH=/caminho/chrome node tests/e2e.rev12.js http://localhost:8765/   # pç/HH e payback
npm run test:e2e                            # todos os testes de navegador (Playwright)
```

## Pontos de metodologia já conhecidos

- A **produtividade do bloco "Resultados" do MFV é teórica** (capacidade ÷ operadores). A meta de +20% é comprovada com o **pç/HH real** (Σ produção ÷ Σ HH) da linha de base × acompanhamento.
- Na planilha de cronoanálise REV2, o tipo A entra como **Σtempo** (tempo total observado), que não pode ser comparado com o takt. No app, com as peças de todas as filmagens, o tipo A vira **Σtempo ÷ Σpeças**.
- O tempo padrão é **por produto**: dois produtos no mesmo estudo só dão resultado correto com a coluna Produto (REV 1.3) ou com um estudo por produto.
- Filtros são só de exibição: nunca alteram a leitura contínua nem os cálculos.
- Posto com vários produtos: o gargalo é avaliado pela **carga do mix** (Σ TP × demanda ÷ tempo líquido), não pelo takt de cada produto isolado.
- Desde a REV 1.12 (decisão D1 do consultor), no mix só entra a **demanda própria** de cada produto: a demanda geral é a do posto e, repetida em cada produto, contava a demanda várias vezes. Sem demanda própria, o mix fica "--". "Considerar no mix" tira o produto da carga (mix parcial, com aviso).
- Um MFV em que a demanda é igual à capacidade declarada fica **circular** (operadores ideais ≈ atuais e capacidade = demanda). Registre essa premissa nas observações.

## Regras do B+P confirmadas na base do consultor (formação de consultores)

| Tema | Regra | Fonte |
|---|---|---|
| Produtividade (obrigatório) | Produtos ÷ (horas trabalhadas × operadores); ganho % = (T3 − T1) ÷ T1 × 100 | Módulo T1.4 Indicadores, parte 2 |
| Payback (obrigatório) | Investimento = **custo do programa** (por porte; digitado pelo consultor) + investimentos do cliente (se houver). Ganho mensal = (produção mensal T3 − T1) × **preço de venda** por unidade | Módulo T1.4, parte 2 (exemplo: +1.000 kg/mês × R$ 3,65 = R$ 3.650/mês) |
| Disponibilidade (relativo) | Tempo real ÷ tempo disponível para produção (após paradas planejadas) | Módulo T1.4, parte 3 |
| Melhoria em % | Proporção, não subtração (70% → 88% = 26%) | Módulo 6 |
| Takt | Tempo disponível ÷ demanda diária da **família inteira** | Módulo 6 |
| Operadores ideais | Σ tempos dos processos ÷ takt | Módulo 6, MFV Simplificado |
| Tempo de ciclo | Tempo que **um operador** leva para percorrer todos os seus elementos de trabalho | Módulo 6, MFV Convencional |
| Lead time | Σ estoques (dias) + processamento; tempo de processamento = Σ TC (não é tempo de agregação de valor) | Módulo 6 |

Não encontrados na base (perguntar antes de assumir): fórmula oficial de tolerância, nº mínimo de ciclos, aplicação do uptime e limite de ocupação.

## Regra confirmada (implementada na REV 1.9): grupo "Posto" no MFV

- **Ciclo do posto** = maior TP dos estudos do grupo (cada estudo = 1 operador; estudo com vários operadores entra como N membros). Usado no TC do GBO, % do takt, gargalo e capacidade.
- **Conteúdo de trabalho** = Σ (TP − espera); espera = elementos com o desperdício "Espera". Usado nos operadores ideais: Σ (TC das etapas comuns + conteúdo dos grupos) ÷ takt.
- Operadores atuais = nº de estudos × uptime (o total digitado prevalece). Balanceamento do posto = conteúdo ÷ (nº de operadores × ciclo); da linha = Σ conteúdo ÷ (operadores atuais × gargalo).
- Tempo de processamento (lead time) usa Σ TC com o ciclo do posto. No MFV vale o takt do MFV.
- TC editado à mão: o conteúdo é ajustado na mesma proporção e pode ser editado à parte, com aviso.
- Grupo "Linha": cada estudo vira uma etapa comum. Fora da regra: postos paralelos idênticos (TC ÷ nº de pessoas).
- No Yamazumi, a espera entra no TP com a tolerância (espera = TN da espera × (1 + Tol%)), e o mix ponderado não é usado (a composição é por elemento de um produto).
- Exemplo de conferência (testes `tests/yamazumi.test.js` e `tests/e2e.rev19.js`): Corte 30, Solda 52, Célula (40 + 28), Embalagem 18, takt 45 s → ciclo 40 (89%), gargalo Solda, capacidade 553,8, ideais 3,73, atuais 5, balanceamento 85% (célula) e 64,6% (linha).

## Regra implementada na REV 1.14: vários operadores no mesmo estudo

- Cada elemento tem `operador` (1, 2…). O tempo subtraído é calculado **pelo mesmo operador na mesma filmagem** (1ª linha usa o Início da filmagem); linhas podem ser intercaladas.
- Peças das filmagens iguais para todos os operadores; tipo A = Σtempo ÷ Σpeças por operador.
- Posto: ciclo = maior TP; conteúdo = Σ (TP − espera); balanceamento = conteúdo ÷ (n × ciclo); ideais = conteúdo ÷ takt; capacidade = tempo líquido ÷ ciclo. Mix: ciclo do posto por produto.
- MFV: POSTO = 1 etapa; LINHA = 1 etapa por operador. Yamazumi: N barras. Excel modelo B+P: um arquivo por operador.
- Limitação: só vale para operadores filmados no mesmo vídeo e produzindo as mesmas peças. Com 1 operador tudo fica igual à REV 1.12.
- Avisos de consistência (Fase 3): Σ Qtd ≠ peças (tipo C), ciclo × observado por peça > 10%, modelo REV2.0 com acíclicos por peça, tempo líquido do estudo ≠ tempo disponível do MFV.

## Regra implementada na REV 1.14 (Fase 2): MFV com produto estratificado

- **Ponderar pela demanda do produto** (opção da etapa, desligada por padrão): TC = TP × demanda própria do produto ÷ demanda diária da família. Não vale para o Mix nem para TC digitado. Sem demanda própria: "--" com aviso (não herda a demanda geral).
- **Operador compartilhado** (campo Operador da etapa): carga = Σ TC das etapas do operador; capacidade = tempo disponível ÷ carga; operadores atuais = distintos + Nº ops das etapas sem operador. Gargalo = maior entre o maior TC e a maior carga (informa qual). Kaizen em etapa compartilhada usa a capacidade do operador. Na EP, Nº ops = TC ÷ carga.
- **Etapa não medida:** fora de todos os cálculos, tracejada no GBO, aviso de fluxo incompleto; na EP vai só para as premissas.
- Tempo de processamento (lead time) = Σ TP original, sem a ponderação.
- Exemplo de conferência (M1–M9): 520 min/dia, família 800/dia (Pão 600, Enroladinho 200), takt 39 s; TPs 6,72 | 4,67 | 3,07 | 11,85 (×200/800) e 4,76 (×600/800) → carga do Op1 10,15 s (26,0% do takt), capacidade 3.075/dia; EP 0,166 | 0,115 | 0,076 | 0,292 | 0,352.

## Regra implementada na REV 1.15: coluna Etapa (etapas do processo)

- Cada linha pode ter `etapa` (caixa "Etapas"). TP por etapa, por produto, na ordem da grade; TP do produto = Σ etapas. O mesmo elemento em etapas diferentes é outro elemento. Sem etapa nas linhas, tudo igual à REV 1.14.
- Com vários operadores: etapa de 1 operador é dele; etapa de 2+ operadores = posto da etapa (ciclo = maior TP, conteúdo = Σ). Nunca somar tempos de operadores diferentes.
- MFV: 1 etapa do fluxo por etapa do processo, com "Ponderar pela demanda do produto" marcado e operador automático (Op1; outro estudo com Op1 recebe "Op1 B"). Etapas diferentes do mesmo estudo não são contagem dupla.
- Modelo B+P de cronoanálise: sem coluna Etapa; o nome do elemento vai como "Etapa • Elemento".
- Service worker: instala e atualiza com `cache: "reload"`/`"no-cache"` (página e scripts sempre da mesma versão).

