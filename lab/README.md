# lab/ — laboratório de estratégias

Manual de operação. A lei está em [`../STRATEGY_LIFECYCLE.md`](../STRATEGY_LIFECYCLE.md).

## Estrutura

```
lab/
  registry.json          fonte única da verdade (estágio, métricas, histórico)
  gates.json             os números que promovem ou reprovam
  validate.mjs           aplica a lei e gera os documentos
  validate.test.mjs      testa o validador
  templates/             modelos de dossiê e de relatório de estágio
  strategies/<id>/       dossiê + evidência de cada estratégia
```

Os arquivos `HALL_OF_FAME.md` e `STRATEGY_GRAVEYARD.md` na raiz são **gerados**. Editar à mão
é trabalho perdido: o validador detecta a divergência e reprova.

## Comandos

```bash
node lab/validate.mjs           # confere tudo (exit 1 se houver erro)
node lab/validate.mjs --write   # regenera os dois documentos
node lab/validate.test.mjs      # 17 testes do próprio validador
```

Rode `node lab/validate.mjs` antes de todo commit que toque no laboratório. Se um dia houver
CI neste repositório, este é o comando que entra lá.

## Abrir uma estratégia nova (STAGE 0)

1. Escolha um `id` em kebab-case (ex.: `ouro-reversao-ny`).
2. `mkdir -p lab/strategies/<id>` e copie `lab/templates/DOSSIER.md` para lá.
3. Escreva a hipótese **antes** de testar qualquer coisa, junto com o que a invalidaria.
4. Acrescente a entrada em `lab/registry.json`:

```json
{
  "id": "ouro-reversao-ny",
  "name": "Ouro — reversão na abertura de NY",
  "market": "XAUUSD · M5 · MetaTrader 5",
  "version": "0.1",
  "origin": "original",
  "owner": "Luiz",
  "hypothesis": "Escreva aqui por que esse dinheiro existe e quem está do outro lado.",
  "stage": 0,
  "status": "in_lab",
  "promoted_at": null,
  "configs_tested": 0,
  "stage_history": [
    { "stage": 0, "date": "2026-09-15", "verdict": "pass",
      "evidence": "lab/strategies/ouro-reversao-ny/stage-0-idea.md" }
  ],
  "metrics": {},
  "weaknesses": [],
  "rejection": null
}
```

5. `node lab/validate.mjs`.

## Promover um estágio

1. Rode o teste do estágio e **arquive o artefato** em `lab/strategies/<id>/stage-N-*.md`
   (com os dados brutos ao lado: CSV de trades, relatório exportado, script usado).
2. Preencha as métricas daquele estágio em `metrics` — número medido, nunca estimado.
   Não mediu? Fica `null`, e o validador barra a promoção. É esse o objetivo.
3. Suba `stage` em 1 e acrescente a entrada correspondente em `stage_history`.
4. `node lab/validate.mjs --write`.

Pular de 3 para 5 é impossível pelo arquivo: o histórico tem que ser contíguo a partir do 0 e
cada entrada precisa apontar para um arquivo que existe em disco.

## Matar uma estratégia

`status: "rejected"` + bloco `rejection` com `date`, `stage_reached` (o estágio em que ela
morreu), `reason`, `result`, `params` e `weakness`. Em uma rejeitada, `stage` é o estágio em
que ela **morreu** — o histórico cobre só os que ela venceu antes.

Matar cedo é o produto do laboratório, não um fracasso. Registre e siga.

## Reabrir uma estratégia do cemitério

Só com **nova hipótese econômica ou estrutural**. Nova entrada, `id` novo, `reopened_from`
apontando para a original, `new_hypothesis` escrita e recomeço do STAGE 0. "Mudei o
parâmetro", "troquei o timeframe" e "testei em outro ativo" não são hipóteses novas — e o
validador recusa.

## Onde os números NÃO podem vir de

Do painel. As métricas de `/api/reports` vêm de contas de clientes rodando risco, modo de
entrada, sessões e filtros diferentes entre si: servem para suporte e acompanhamento, não
como evidência de estratégia. Evidência sai de uma configuração congelada, declarada no
dossiê, sobre um período declarado.
