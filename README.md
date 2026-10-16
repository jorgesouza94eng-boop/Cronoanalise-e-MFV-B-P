# Lean Chrono & MFV — Cronoanálise e apoio ao Mapa de Fluxo de Valor

Aplicação web **local-first** e **100% sem servidor** para cronoanálise de vídeos de operação, voltada a consultorias de produtividade industrial (Programa **Brasil Mais Produtivo**).

- **Digitação sem mouse:** o consultor assiste ao vídeo e digita só o instante de término de cada elemento (leitura contínua).
- **Cálculo Lean em tempo real:** tempo subtraído, tempo normal, tempo padrão, takt time, capacidade e semáforo de gargalo.
- **Funciona sem internet:** os dados ficam no navegador e na pasta do OneDrive do consultor, em arquivos `.json`.
- **Sem build e sem dependências:** HTML5, CSS3 e JavaScript puro.

![Tela no notebook](docs/tela-desktop.png)

---

## 1. Como abrir

| Forma | Como fazer | Recursos disponíveis |
|---|---|---|
| **Direto no navegador** | Dar duplo clique em `index.html` (abre como `file://`) | Cálculo, teclado, salvamento no navegador, exportar/importar JSON e CSV. O botão "Conectar pasta" aparece no Chrome/Edge. |
| **Servidor local** | `python -m http.server 8080` ou `npm start` na pasta do projeto e abrir `http://localhost:8080` | Tudo, inclusive o modo offline (PWA) |
| **GitHub Pages (recomendado para o celular)** | GitHub → *Settings → Pages* → publicar a branch principal (pasta raiz) | Tudo. No celular, use "Adicionar à tela inicial": depois do primeiro acesso, o app abre **sem internet**. |

> Os scripts são carregados como scripts clássicos (sem módulos ES). Por isso o app abre via `file://` sem erro de CORS. O manifesto e o *service worker* só são ativados quando o app é servido por `http/https`.

---

## 2. Fluxo de trabalho

1. Clique em **Estudos → Novo estudo** e informe a **Empresa** e o **Posto/Operação**. Cada posto gera um arquivo.
2. Preencha os **parâmetros da jornada**: jornada bruta (min), paradas planejadas (min), demanda (pçs/dia) e tolerância (%).
3. Se o vídeo não começa em 00:00, informe a **Leitura inicial**.
4. Para cada elemento: **Descrição → `Enter` → Tempo final → `Enter` → Ritmo → `Enter`**. A próxima linha é criada automaticamente.

### Atalhos de teclado

| Tecla | Ação |
|---|---|
| `Enter` | Fluxo rápido: Descrição → Tempo final → Ritmo → próxima linha (cria uma nova se for a última) |
| `Tab` / `Shift+Tab` | Percorre todos os campos, inclusive **Frequência** e **Kaizen** |
| `↑` / `↓` | Mesma coluna, linha anterior/seguinte |
| `Ctrl+Enter` | Nova linha no final da grade |
| `Alt+N` | Marca ou desmarca a linha atual como **início de uma nova filmagem** (também funciona tocando no nº da linha) |
| `Ctrl+Del` | Exclui a linha atual (pede confirmação se houver conteúdo) |
| `Ctrl+S` | Grava imediatamente (sem esperar os 3 s) |

### Digitação do tempo final

| Digitado | Resultado | Minutos centesimais |
|---|---|---|
| `90` | 01:30 | 1,500 |
| `132` | 01:32 | 1,533 |
| `10532` ou `1:05:32` | 1:05:32 | 65,533 |
| `199` | **Recusado**: segundos ≥ 60 (erro de digitação) | — |
| Valor menor que a leitura anterior | **Recusado**: a linha fica em vermelho e o foco permanece no campo | — |

### Padrão da planilha B+P (REV2)

Um estudo novo já abre no padrão da planilha: **lançamento por Quantidade**, tempos em **segundos**, **ritmo 100%** e **tolerância 0%**. Nesse padrão, o resultado é igual ao da planilha. Conferi com as 149 linhas e 9 filmagens da cronoanálise da Laje Forte: deram os mesmos 28 elementos e os mesmos 7.681 s.

| Coluna | Como preencher (teclado) |
|---|---|
| **Tipo** | `C` = cíclico (média por unidade) · `A` = acíclico (soma dos tempos) |
| **Qtd.** | Unidades produzidas no trecho (tempo/un = tempo ÷ qtd). No modo **Frequência**, a mesma coluna recebe `1`, `0,02` ou `1/50` |
| **Valor** | `A` Agrega · `N` Não agrega · `I` Incidental |
| **Desperdício** | Inicial de um dos 8 desperdícios Lean: Superprodução, Espera, Transporte, Processamento excessivo, Estoque, Movimentação, Defeitos, Intelecto |

- **Lançamento** (barra da grade): *Quantidade* (padrão planilha) ou *Frequência* (cronoanálise clássica).
- **Unidade** (barra da grade): *Segundos*, *Minutos* ou *Horas*. Muda a grade, o resumo, o painel e o CSV. A jornada continua em minutos.
- **Mesmo nome = mesmo elemento.** A descrição sugere os nomes já usados e ignora diferenças de maiúsculas e de espaços. Um elemento repetido herda o tipo, o valor e o desperdício da 1ª ocorrência.

### Resumo por elemento (aba "Listagem de Elementos")

Abaixo da grade, o app agrupa as linhas pelo nome do elemento:

| Modo | Tipo C | Tipo A |
|---|---|---|
| **Quantidade** (planilha) | Σtempo ÷ Σquantidade (média por unidade) | Σtempo |
| **Frequência** | média das ocorrências | média das ocorrências (a frequência já rateia) |

O resumo mostra:
- ocorrências e quantidade total;
- tempo total e tempo no ciclo;
- % do ciclo;
- valor, desperdício e **ação automática**: Agrega → *Manter*, Não agrega → *Eliminar*, Incidental → *Reduzir*.

Classificações divergentes no mesmo elemento aparecem com ⚠. O **tempo normal do ciclo** é a soma do resumo, e é ele que alimenta o tempo padrão, o Takt e o gargalo.

![Resumo por elemento](docs/tela-resumo.png)

### Compilação e soluções (aba "Compilação e Soluções")

Abaixo do resumo, três gráficos de barras, sempre com rótulo e valor em cada barra:
- **Por atividade:** nº de elementos que Agregam, Não agregam e são Incidentais.
- **Por tempo:** tempo no ciclo e % do total para cada valor.
- **Por desperdício:** os desperdícios classificados, do maior para o menor (Pareto).

O campo **Constatações e soluções** é salvo no estudo e vai para o Excel.

![Compilação](docs/tela-compilacao.png)

### Exportar Excel

O botão **Exportar Excel** tem dois modos:

| Modo | Quando | Resultado |
|---|---|---|
| **Modelo B+P** | Há um modelo carregado (em *Estudos → Modelo Excel → Carregar modelo*) | A **sua própria planilha** (`.xlsm`/`.xlsx`) preenchida. Fórmulas, gráficos, macros, logotipos, cores e abas ocultas ficam preservados, e o Excel recalcula tudo ao abrir |
| **Excel simples** | Sem modelo, ou pelo botão *Exportar Excel simples* | Layout próprio do app (GERAL, Listagem, Compilação, Análise), só com valores |

**Como funciona o modelo:**
- **Carregar uma vez.** O app reconhece a REV2 pelos cabeçalhos da linha 8 e guarda o modelo no navegador e na pasta **`_Modelos`** do OneDrive. O outro notebook encontra o modelo sozinho ao conectar a pasta.
- **Células preenchidas:**
  - GERAL (linhas 10–300): Elemento, Início, Fim (00:00 nas novas filmagens), Quantidade, Tipo e a lista de elementos;
  - Listagem (linhas 9–134): Elemento, Tempo (s), Qt., Valor e Desperdício, com os textos exatos da planilha;
  - Compilação: constatações em B55;
  - Análise: identificação em C16.
- **Limpeza:** dados e observações deixados no modelo por estudos anteriores são apagados nas áreas preenchidas.
- **Limites vigiados:** 291 lançamentos e 126 elementos. Há um aviso quando passa de 40 elementos, porque a aba Análise da planilha soma só T25:T64.
- **Arquivo gerado:** `Crono_<Cliente>_<Posto>_<data>.xlsm`.

O fluxo foi conferido com a planilha real da Laje Forte (149 lançamentos, 9 filmagens). Depois do recálculo, as fórmulas da própria planilha chegaram a **7.681 s** (Análise!G3) e os gráficos de pizza se atualizaram.

> Dica: use como modelo uma cópia **em branco** da planilha. O app limpa as áreas que preenche, mas abas ocultas como "Listagem de Elementos (2)" e textos fora dessas áreas ficam como estão no modelo.

### Várias filmagens no mesmo estudo

Cada vídeo novo começa em 00:00, como as células amarelas de "Tempo (Início)" na planilha REV2. Para registrar isso no app, há três formas:

1. **Automática:** digite o tempo do novo vídeo normalmente. Como ele é menor que a leitura anterior, o app pergunta *"Esta linha é o início de uma nova filmagem?"*. `Enter` confirma; `Esc` volta para corrigir o tempo.
2. **`Alt+N`** na linha. É necessário quando o 1º tempo do novo vídeo é **maior** que o último do vídeo anterior, porque nesse caso o app não tem como perceber a troca sozinho.
3. **Toque no número da linha**, no celular.

A linha marcada ganha uma faixa amarela e a etiqueta **F2**, **F3**, e assim por diante. O rodapé mostra o total de filmagens. A *Leitura inicial* vale só para a 1ª filmagem.

![Várias filmagens](docs/tela-filmagens.png)

- **Frequência:** `1` = uma vez por peça; `1/50` ou `0,02` = uma vez a cada 50 peças. Com frequência menor que 1, o elemento é marcado como **A** (acíclico).
- **Ritmo:** de 50% a 150%. A nova linha herda o ritmo da linha anterior.

---

## 2.1 MFV — Estado presente (`mfv.html`)

O link **MFV** no cabeçalho abre o Mapa de Fluxo de Valor, que reproduz a aba **EP** da planilha "MFV Simplificado". Há **um arquivo por cliente e família** (`MFV_<cliente>_<família>_<data>_<id>.json`), salvo na mesma pasta do OneDrive e com a mesma proteção contra conflito dos estudos.

| Bloco | O que faz |
|---|---|
| **Horário de trabalho** | Entrada, saída, pausas e refeição por dia da semana. Mostra o efetivo por dia e a média por dia trabalhado |
| **Demanda e disponibilidade** | Demanda mensal ÷ dias úteis = demanda diária. Disponibilidade da família (%), unidade do produto (pç, m², kg) e unidade de tempo (s, min, h) |
| **Takt** | Tempo disponível por dia ÷ demanda diária |
| **GBO** | Cada etapa vem de um **estudo de cronoanálise**: o TC é o tempo padrão do estudo. O TC é **editável** (vira "✎ editado", com a opção **↺ usar estudo**). Também é possível criar etapas manuais. Cada etapa tem nº de operadores, uptime (%) e % do takt. **Atualizar TCs** relê os estudos |
| **Gráfico GBO** | Barras por etapa com a linha do takt. Barras acima do takt ficam em vermelho e o processo Kaizen fica tracejado |
| **Resultados** | Gargalo (maior TC), operadores atuais × ideais (ΣTC ÷ takt), capacidade da linha (tempo disponível ÷ maior TC), produtividade (/dia/op e /h/op) e o processo Kaizen marcado |
| **Atravessamento** | Estoques ÷ demanda diária = dias. A soma dá o lead time |

Conferência com o MFV real da Laje Forte (aba EP): deram os mesmos 440 min/dia, a mesma demanda de 206,67 m²/dia, o takt de 0,035484 h, a capacidade de 206,67 m²/dia, a produtividade de 14,09 m²/h/op, 1,00 operador ideal e 8 dias de atravessamento.

> Na planilha, a "Capacidade de Produção Diária da Linha" (K46) usa as horas sem descontar a disponibilidade da família, enquanto o setor Kaizen (N46) desconta. O app usa o **tempo disponível com a disponibilidade** nos dois casos. Com disponibilidade de 100%, os resultados são idênticos.

**Nº total de operadores:** se a mesma equipe faz várias etapas (como na Laje Forte), informe o total da linha em *Demanda e disponibilidade*, como no K37 da planilha. Vazio = soma dos operadores das etapas.

### Exportar Excel do MFV (modelo B+P)

Em **MFVs → Modelo Excel → Carregar modelo**, escolha a planilha "MFV Simplificado". O botão **Exportar Excel (modelo B+P)** passa a preencher:

| Aba | Células |
|---|---|
| **EP** | Empresa e família (D5:D6), horário (C22:F28), disponibilidade (K28), demanda e dias úteis (O21, O26), unidades (P21:P27, D54, I46:I51), etapas (B39:G51: Kaizen, etapa, TC, nº ops, uptime), total de operadores (K37), estoques (B55:D64) e premissas (B76:B95) |
| **EF** | Mesmos dados gerais do EP, com as etapas e os estoques em branco, para você montar o estado futuro |

**Como os dados são tratados:**
- Os TCs vão em **horas** ("HORAS / peça"). É a única unidade em que todas as fórmulas da planilha (O27, K46, N46, U45) calculam de forma consistente. O takt sai na unidade escolhida no app.
- Contas digitadas pelo consultor em células de entrada (ex.: demanda `=1240/6*26`) são substituídas pelo valor do app. As **fórmulas de cálculo** da planilha são preservadas.
- Onde o modelo não tem a fórmula das horas do dia (ex.: sábado da aba EF), o app grava as horas calculadas.
- O **fluxograma** é uma imagem do modelo e precisa ser atualizado manualmente.

Conferido com o MFV real da Laje Forte: depois do recálculo, 20 de 22 células de resultado ficaram idênticas à planilha original. As duas restantes diferem só pela ordem dos estoques digitados no teste, e o total de 8 dias de atravessamento bateu.

![MFV](docs/tela-mfv.png)

## 3. Regras de cálculo

| Indicador | Fórmula |
|---|---|
| Tempo subtraído (TS) | Tempo final da linha − última leitura válida (a primeira linha usa a leitura inicial; a linha de **nova filmagem** usa 00:00) |
| Tempo normal da linha (TN) | TS × (Ritmo / 100) [× Frequência, no modo frequência] |
| Tempo do elemento (resumo) | Quantidade: C = ΣTN ÷ ΣQtd · A = ΣTN — Frequência: média das ocorrências |
| Tempo normal do ciclo | Σ tempos dos elementos do resumo |
| Tempo padrão (TP) | Tempo normal do ciclo × (1 + Tolerância / 100), método multiplicativo da OIT |
| Tempo líquido disponível (TLD) | Jornada bruta − Paradas planejadas |
| Takt time | TLD ÷ Demanda diária |
| Capacidade | ⌊TLD ÷ TP⌋ peças/dia |
| Gargalo | TP > Takt → 🔴 **GARGALO** · TP ≤ Takt → 🟢 **BALANCEADO** |

- Todos os tempos estão em **minutos centesimais**. Os cálculos usam precisão total; o arredondamento é só na exibição.
- Linhas com erro ficam **fora dos totais** e o painel informa quantas são.
- Com demanda zero ou paradas maiores que a jornada, o painel mostra **"Verificar"**, não "gargalo".
- Arquivos `.json` de versões anteriores abrem no modo *Frequência* em *minutos*, preservando os resultados de antes.

---

## 4. Armazenamento e sincronização

### Notebook (Chrome/Edge): pasta do OneDrive

1. Clique em **Conectar pasta (OneDrive)** e escolha a pasta sincronizada.
2. Cada alteração é salva **na hora no navegador** e **na pasta 3 s depois da última tecla** (*debounce*), para não sobrecarregar a sincronização do OneDrive.
3. Ao reabrir o navegador, ele pede a permissão de novo: clique em **Reautorizar pasta**. Enquanto isso, nada se perde, porque tudo continua salvo no navegador.
4. O botão **Estudos** lista os arquivos `Crono_*.json` da pasta e os estudos guardados no navegador.

**Nome do arquivo:** gerado uma única vez na criação, sem acentos e com um ID único. Exemplo: `Crono_Industria_Metalurgica_Alfa_Montagem_Final_Posto_01_2026-10-15_a1b2c3d4.json`. Renomear o cliente ou o posto **não** cria um arquivo novo.

**Proteção contra conflito (dois notebooks):** cada arquivo tem um número de **revisão**. Antes de gravar, o app confere se a pasta ainda está na revisão que ele conhece. Se outro dispositivo gravou antes:

- o arquivo da pasta **não é sobrescrito**;
- a versão desta tela é salva como cópia `..._conflito_AAAAMMDD-HHMMSS.json`;
- um aviso vermelho oferece **Usar versão da pasta** ou **Manter minha versão (sobrescrever)**.

> A proteção depende de o OneDrive já ter sincronizado a versão do outro dispositivo. Se os dois gravarem ao mesmo tempo, sem sincronizar, o próprio OneDrive cria uma cópia com o nome do computador.

### Celular / tablet (ou Firefox/Safari): modo navegador

Esses navegadores não permitem acesso a pastas. O app detecta isso sozinho e:

- salva continuamente no **IndexedDB** do navegador e pede armazenamento persistente para evitar limpeza automática;
- mostra no indicador quando foi o último export, por exemplo "Salvo no navegador • exportado há 2 h";
- oferece **Exportar JSON** (envie o arquivo para a pasta do OneDrive) e **Importar JSON** (em *Estudos*).

Ao importar no notebook um estudo editado no celular, a revisão do arquivo serve de base para detectar conflito com a pasta.

---

## 5. Formato do arquivo `.json`

```json
{
  "schema": "lean-chrono-estudo",
  "schemaVersion": 1,
  "id": "a1b2c3d4-…",
  "fileName": "Crono_Industria_Alfa_Posto_01_2026-10-15_a1b2c3d4.json",
  "revision": 3,
  "createdAt": "2026-10-15T10:00:00.000Z",
  "updatedAt": "2026-10-15T10:42:00.000Z",
  "clientName": "Indústria Alfa",
  "processName": "Posto 01",
  "videoStart": "00:00",
  "settings": { "entryMode": "quantidade", "timeUnit": "s" },
  "shiftParams": { "shiftTimeMin": 528, "plannedStopsMin": 48, "dailyDemandPcs": 240, "tolerancePct": 5 },
  "elements": [
    { "id": "…", "description": "Soldar", "type": "C", "quantity": "2", "frequency": "1", "videoTime": "01:12",
      "pace": "100", "value": "AG", "waste": "", "kaizen": "", "newVideo": false }
  ],
  "results": { "unit": "minutos centesimais", "taktTimeMin": 2, "standardTimeMin": 1.386, "capacityPcsDay": 346, "status": "balanceado", "…": "…" }
}
```

O bloco `results` é um **resumo para leitura externa** (Excel, Power BI). Ele é recalculado a cada gravação e ignorado ao abrir o arquivo.

---

## 6. Estrutura do projeto

```
index.html            Estrutura da tela
style.css             Estilos (desktop, tablet, celular e impressão)
js/calc.js            Motor de cálculo e modelo de dados (funções puras, testadas)
js/xlsx.js            Excel simples (gerador .xlsx próprio, sem dependências)
js/xlsx-template.js   Preenchimento do modelo B+P do consultor (preserva fórmulas, gráficos e macros)
js/storage.js         IndexedDB, pasta do OneDrive, exportar/importar
js/ui.js              Renderização e navegação por teclado
js/app.js             Orquestração: estado, autosave, conflitos, gerenciador de estudos
mfv.html              Página do MFV (estado presente)
js/mfv-calc.js        Motor de cálculo do MFV (aba EP: horário, takt, GBO, capacidade, atravessamento)
js/mfv-app.js         Tela e salvamento do MFV (mesma pasta e proteção contra conflito)
sw.js                 Service worker (offline)
manifest.webmanifest  Instalação como app (PWA)
tests/                Testes automatizados
```

Ao alterar qualquer arquivo do app, incremente `CACHE_VERSION` em `sw.js` para os celulares receberem a atualização.

---

## 7. Testes

```bash
npm test             # 89 testes: cálculo, compilação, Excel, modelos B+P e MFV (Node 18+, sem dependências)
```

O teste de ponta a ponta no navegador (`tests/e2e.browser.js`) usa Playwright e cobre:

- fluxo de teclado completo;
- indicadores;
- erros de digitação;
- persistência;
- exportação;
- gravação na pasta com debounce;
- conflito entre dispositivos;
- modo celular.

As instruções estão no cabeçalho do arquivo.

---

## 8. Limitações conhecidas (MVP)

- O cálculo estatístico do número de ciclos necessários e o MFV **estado futuro** (aba EF) ficam para as próximas etapas.
- O MFV não gera o desenho do fluxograma (ele continua como imagem no modelo).
- No celular a grade usa rolagem horizontal; o modo "cartão" fica para a fase 2.
- Estudos alterados no navegador sem pasta conectada só são gravados na pasta quando forem abertos novamente com a pasta conectada (o gerenciador marca "Alterações não gravadas na pasta").
- A gravação na pasta usa a File System Access API, disponível no Chrome e no Edge para computador.
