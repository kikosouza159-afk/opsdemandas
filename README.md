# Esteira Resumida de Demandas

Painel Flask baseado no HTML original, preparado para GitHub e Render.

## O que já está pronto

- Visual preservado do painel executivo.
- Login por usuário.
- Cadastro, edição, alteração rápida de status e reordenação por drag and drop.
- Importação CSV/XLSX pelo navegador.
- Exportação CSV.
- Salvamento em banco de dados.
- PostgreSQL no Render quando `DATABASE_URL` estiver configurado.
- SQLite local automaticamente quando não houver `DATABASE_URL`.
- Exclusão lógica, ou seja, a demanda é arquivada e não apagada definitivamente.
- Auditoria em tabela `audit_logs` para criação, edição, status, reordenação, importação e exclusão lógica.

## Usuários iniciais

| Usuário | Senha | Perfil |
|---|---|---|
| admin | olos123 | admin |
| gerber | olos123 | admin |
| elvis | olos123 | user |
| michele | olos123 | user |
| nubia | olos123 | user |
| marcelo | olos123 | user |
| hilde | olos123 | user |
| antonio | olos123 | user |

> Troque as senhas depois. Nesta primeira versão elas são seeds iniciais.

## Rodar local

```bash
python -m venv .venv
.venv\Scriptsctivate
pip install -r requirements.txt
python app.py
```

Abra:

```text
http://127.0.0.1:5000
```

## Subir no GitHub e Render

Recomendado: subir primeiro no GitHub e depois conectar o repositório no Render.

1. Crie um repositório no GitHub.
2. Envie todos os arquivos desta pasta.
3. No Render, crie um novo Web Service conectado ao repositório.
4. Crie um PostgreSQL no Render.
5. Configure a variável `DATABASE_URL` com a Internal Database URL do Postgres.
6. Configure `SECRET_KEY` com qualquer string forte.
7. Build Command:

```bash
pip install -r requirements.txt
```

8. Start Command:

```bash
gunicorn app:app --workers 1 --threads 4
```

## Observação importante

Não use arquivo HTML como banco. O HTML agora é só a tela. A fonte oficial dos dados fica no PostgreSQL, então um novo deploy não apaga as informações.
