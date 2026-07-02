# MVP 01 — Intelligent Public Procurement Search Engine

Backend modular para busca inteligente de documentos públicos de compras/licitações no Brasil.

Este MVP implementa a infraestrutura de busca e matching descrita na especificação:

- Providers plugáveis: PNCP, Compras.gov.br, Santa Catarina e Mock local
- Normalização de texto
- Remoção segura de stop words
- Tokenização com extração de produto, marca, modelo, cor, unidade e especificações
- Leitura de documentos via `PDFReader` isolado
- Matching lexical inicial
- Similaridade 0–100 com heurística ponderada
- Regras negativas testáveis
- Clusterização por compatibilidade
- Ranking por similaridade, recência, completude e fonte
- Explicações humanas por resultado

> Observação honesta: o provider Mock funciona imediatamente para testar o motor. PNCP e Compras.gov.br estão implementados como adapters isolados com endpoints configuráveis, mas devem ser validados contra a versão atual dos endpoints oficiais antes de produção. O provider Santa Catarina está isolado e desabilitado até haver endpoint oficial estável confirmado.

---

## Arquitetura

```txt
SearchEngine
├── Providers
│   ├── MockProvider
│   ├── PNCPProvider
│   ├── ComprasGovProvider
│   └── SantaCatarinaProvider
├── PDFReader
├── Normalizer
├── StopWords
├── Tokenizer
├── Matcher
├── SimilarityEngine
├── ClusterEngine
└── RankingEngine
```

A regra principal: cada módulo conversa por contratos/DTOs. Nenhum provider conhece regra de similaridade. Nenhuma regra de ranking conhece detalhe de API externa.

---

## Como rodar

```bash
npm install
npm run dev
```

Servidor padrão:

```txt
http://localhost:3333
```

Health check:

```bash
curl http://localhost:3333/health
```

Busca de teste:

```bash
curl -X POST http://localhost:3333/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Caneta Azul Bic Cristal",
    "sources": ["MOCK"],
    "uf": "SC",
    "limit": 10
  }'
```

Busca notebook:

```bash
curl -X POST http://localhost:3333/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Notebook Dell Inspiron 15 i5 16GB SSD 512",
    "sources": ["MOCK"],
    "uf": "SC",
    "limit": 10
  }'
```

---

## Testes

```bash
npm test
```

Testes incluídos:

- Normalizer
- Tokenizer
- SimilarityEngine
- Negative rules
- SearchEngine com provider mock

---

## Variáveis de ambiente

Copie `.env.example` para `.env` se quiser configurar manualmente.

```env
PORT=3333
ENABLE_MOCK_PROVIDER=true
ENABLE_PNCP_PROVIDER=false
ENABLE_COMPRASGOV_PROVIDER=false
ENABLE_SANTA_CATARINA_PROVIDER=false
PNCP_BASE_URL=https://pncp.gov.br/api/consulta
COMPRASGOV_BASE_URL=https://dadosabertos.compras.gov.br/modulo-licitacoes/1_consultarLicitacao
```

---

## Similaridade

O sistema usa a seguinte heurística base:

| Critério | Peso |
|---|---:|
| Produto principal | 40 |
| Especificações técnicas | 20 |
| Marca | 15 |
| Modelo | 10 |
| Cor | 5 |
| Unidade de medida | 5 |
| Fonte oficial | 5 |

O peso é redistribuído dinamicamente quando o usuário não informa marca, modelo, cor, unidade ou especificações.

Exemplo: em `caneta azul`, marca e modelo não são exigidos. Em `caneta azul bic cristal`, marca e modelo entram na pontuação.

---

## Regras negativas

As regras negativas impedem falsos positivos:

- `Caneta Azul` não deve virar `Caneta Vermelha`
- `Caneta Azul` não deve virar `Marca-texto Azul`
- `Caneta Azul` não deve virar `Refil para Caneta Azul`
- `Mouse Pad` não deve virar `Mouse Óptico`
- `Notebook Dell` não deve virar `Monitor Dell`

As regras negativas aplicam teto de pontuação e geram explicação humana no resultado.

---

## Exemplo de explicação gerada

```json
{
  "criterion": "negativeRule",
  "status": "conflict",
  "contribution": -45,
  "message": "Regra negativa: cor incompatível (azul ≠ vermelho).",
  "evidence": "vermelho"
}
```

---

## Integração real com PDF

O `PDFReader` está isolado. Para produção, conecte um worker Python com:

- PyMuPDF para texto por página
- pdfplumber para tabelas
- Tesseract para OCR de PDFs escaneados

Contrato esperado pelo backend:

```ts
ExtractedDocument = {
  ref,
  text,
  tables,
  sections,
  extractionConfidence,
  warnings
}
```

Isso permite evoluir o leitor de PDF sem tocar no SearchEngine.

---

## Próximos passos recomendados

1. Validar endpoints reais do PNCP e Compras.gov.br.
2. Conectar worker Python de PDF.
3. Persistir documentos/index em PostgreSQL.
4. Adicionar pg_trgm para fuzzy search.
5. Adicionar pgvector para busca semântica.
6. Expandir dicionários de produtos, marcas, cores, unidades e sinônimos.
7. Criar fixtures reais com editais/atas/contratos de Treviso e região.

---

## Decisão de escopo

Este projeto não implementa preço médio, comparação de valores, dashboard, cache avançado ou UI. Ele é a base modular para isso vir depois sem reescrever o motor.
