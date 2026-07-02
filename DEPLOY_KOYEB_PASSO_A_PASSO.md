# Como colocar o MVP 01 no ar pelo Koyeb

## Resumo

Você não sobe o ZIP direto no Koyeb. O caminho mais simples é:

1. Descompactar este projeto.
2. Criar uma conta no GitHub.
3. Criar um repositório no GitHub.
4. Enviar os arquivos do projeto para esse repositório.
5. Criar conta no Koyeb.
6. Conectar o Koyeb ao GitHub.
7. Mandar o Koyeb fazer o deploy.

## Configuração recomendada no Koyeb

Build command:

```bash
npm run build
```

Run command:

```bash
npm start
```

Environment variables:

```env
ENABLE_MOCK_PROVIDER=true
ENABLE_PNCP_PROVIDER=false
ENABLE_COMPRASGOV_PROVIDER=false
ENABLE_SANTA_CATARINA_PROVIDER=false
```

## Teste depois que publicar

Quando o Koyeb gerar a URL, abra:

```text
https://SUA-URL-DO-KOYEB.koyeb.app/health
```

Se aparecer algo parecido com:

```json
{"ok":true}
```

A API está viva.

Para testar busca, use Postman, Insomnia ou outra ferramenta de API com:

```http
POST /search
Content-Type: application/json
```

Body:

```json
{
  "query": "Caneta Azul Bic Cristal",
  "sources": ["MOCK"],
  "uf": "SC",
  "limit": 10
}
```
