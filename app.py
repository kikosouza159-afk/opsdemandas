import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, date
from pathlib import Path

from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import psycopg2
    import psycopg2.extras
except Exception:  # pragma: no cover
    psycopg2 = None

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "troque-esta-chave-em-producao")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USING_POSTGRES = bool(DATABASE_URL and psycopg2)

@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.exception("Erro interno no servidor")
    return jsonify({
        "ok": False,
        "error": str(e)
    }), 500

USERS_SEED = {
    "admin": {"password": "olos123", "role": "admin"},
    "gerber": {"password": "olos123", "role": "admin"},
    "elvis": {"password": "olos123", "role": "user"},
    "michele": {"password": "olos123", "role": "user"},
    "nubia": {"password": "olos123", "role": "user"},
    "marcelo": {"password": "olos123", "role": "user"},
    "hilde": {"password": "olos123", "role": "user"},
    "antonio": {"password": "olos123", "role": "user"},
}
VALID_STATUS = {"Em Andamento", "Concluído", "Pendentes", "Paralisado"}


def now_iso():
    return datetime.utcnow().isoformat(timespec="seconds")


def normalize_status(value):
    txt = str(value or "").strip().lower()
    txt_ascii = (
        txt.replace("í", "i").replace("ã", "a").replace("á", "a")
        .replace("ç", "c").replace("é", "e").replace("ê", "e")
        .replace("ó", "o")
    )
    if txt_ascii in {"concluido", "concluida", "finalizado", "finalizada"}:
        return "Concluído"
    if txt_ascii in {"pendente", "pendentes", "pendencia"}:
        return "Pendentes"
    if txt_ascii in {"paralisado", "parada", "pausado", "pausada"}:
        return "Paralisado"
    return "Em Andamento"


def normalize_date(value):
    if not value:
        return ""
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s[:19], fmt).date().isoformat()
        except Exception:
            pass
    return ""


@contextmanager
def get_conn():
    if USING_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        conn = sqlite3.connect(DATA_DIR / "esteira.db")
        conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def qmark(sql):
    """Converte placeholders para Postgres quando necessário."""
    return sql.replace("?", "%s") if USING_POSTGRES else sql


def fetchall(cur):
    rows = cur.fetchall()
    return [dict(r) for r in rows]


def fetchone(cur):
    row = cur.fetchone()
    return dict(row) if row else None


def execute(cur, sql, params=()):
    return cur.execute(qmark(sql), params)


def table_exists(cur, name):
    if USING_POSTGRES:
        execute(cur, "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ?) AS exists", (name,))
        return fetchone(cur)["exists"]
    execute(cur, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return fetchone(cur) is not None


def init_db():
    with get_conn() as conn:
        cur = conn.cursor()
        if USING_POSTGRES:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS users_app (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TEXT NOT NULL
            );
            """)
            cur.execute("""
            CREATE TABLE IF NOT EXISTS demands (
                id SERIAL PRIMARY KEY,
                priority INTEGER NOT NULL,
                cliente TEXT NOT NULL,
                data TEXT NOT NULL,
                melhoria TEXT NOT NULL,
                observacao TEXT DEFAULT '',
                responsavel TEXT NOT NULL,
                prazo TEXT DEFAULT '',
                status TEXT NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_by TEXT DEFAULT '',
                updated_by TEXT DEFAULT '',
                deleted_by TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT DEFAULT ''
            );
            """)
            cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                demand_id INTEGER,
                action TEXT NOT NULL,
                username TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """)
        else:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS users_app (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            """)
            cur.execute("""
            CREATE TABLE IF NOT EXISTS demands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                priority INTEGER NOT NULL,
                cliente TEXT NOT NULL,
                data TEXT NOT NULL,
                melhoria TEXT NOT NULL,
                observacao TEXT DEFAULT '',
                responsavel TEXT NOT NULL,
                prazo TEXT DEFAULT '',
                status TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_by TEXT DEFAULT '',
                updated_by TEXT DEFAULT '',
                deleted_by TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT DEFAULT ''
            );
            """)
            cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                demand_id INTEGER,
                action TEXT NOT NULL,
                username TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """)

        execute(cur, "SELECT COUNT(*) AS total FROM users_app")
        if fetchone(cur)["total"] == 0:
            for username, cfg in USERS_SEED.items():
                execute(cur, "INSERT INTO users_app (username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?)",
                        (username, generate_password_hash(cfg["password"]), cfg["role"], True if USING_POSTGRES else 1, now_iso()))

        execute(cur, "SELECT COUNT(*) AS total FROM demands")
        if fetchone(cur)["total"] == 0:
            seed_path = BASE_DIR / "seed_initial.json"
            seed = json.loads(seed_path.read_text(encoding="utf-8")) if seed_path.exists() else []
            for idx, item in enumerate(seed, start=1):
                insert_demand(cur, item, username="seed", priority=idx, audit=False)


def audit(cur, demand_id, action, username, payload):
    execute(cur, "INSERT INTO audit_logs (demand_id, action, username, payload, created_at) VALUES (?, ?, ?, ?, ?)",
            (demand_id, action, username, json.dumps(payload, ensure_ascii=False), now_iso()))


def insert_demand(cur, payload, username, priority=None, audit=True):
    status = normalize_status(payload.get("status"))
    data = normalize_date(payload.get("data")) or date.today().isoformat()
    prazo = normalize_date(payload.get("prazo"))
    if priority is None:
        execute(cur, "SELECT COALESCE(MAX(priority), 0) + 1 AS next_priority FROM demands WHERE active = ?", (True if USING_POSTGRES else 1,))
        priority = fetchone(cur)["next_priority"]
    values = (
        int(priority),
        str(payload.get("cliente") or "Não informado").strip(),
        data,
        str(payload.get("melhoria") or "Demanda sem título").strip(),
        str(payload.get("observacao") or "").strip(),
        str(payload.get("responsavel") or username or "Não informado").strip(),
        prazo,
        status,
        True if USING_POSTGRES else 1,
        username,
        username,
        now_iso(),
        now_iso(),
    )
    execute(cur, """INSERT INTO demands
        (priority, cliente, data, melhoria, observacao, responsavel, prazo, status, active, created_by, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", values)
    if USING_POSTGRES:
        execute(cur, "SELECT CURRVAL(pg_get_serial_sequence('demands','id')) AS id")
    else:
        execute(cur, "SELECT last_insert_rowid() AS id")
    new_id = fetchone(cur)["id"]
    if audit:
        audit(cur, new_id, "create", username, payload)
    return new_id


def current_user():
    return session.get("user")


def require_login():
    if not current_user():
        return jsonify({"ok": False, "error": "login_required"}), 401
    return None


def is_admin():
    return session.get("role") == "admin"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True, "storage": "postgres" if USING_POSTGRES else "sqlite_local", "database_url_configurada": bool(DATABASE_URL)})


@app.post("/api/login")
def login():
    data = request.get_json(force=True) or {}
    username = str(data.get("username") or "").strip().lower()
    password = str(data.get("password") or "")
    with get_conn() as conn:
        cur = conn.cursor()
        execute(cur, "SELECT * FROM users_app WHERE username = ? AND active = ?", (username, True if USING_POSTGRES else 1))
        user = fetchone(cur)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"ok": False, "error": "Usuário ou senha inválidos."}), 401
    session["user"] = user["username"]
    session["role"] = user["role"]
    return jsonify({"ok": True, "user": {"username": user["username"], "role": user["role"]}})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    if not current_user():
        return jsonify({"ok": True, "logged": False})
    return jsonify({"ok": True, "logged": True, "user": {"username": current_user(), "role": session.get("role", "user")}})


@app.get("/api/demandas")
def list_demands():
    guard = require_login()
    if guard:
        return guard
    with get_conn() as conn:
        cur = conn.cursor()
        execute(cur, "SELECT id, priority, cliente, data, melhoria, observacao, responsavel, prazo, status, created_at, updated_at FROM demands WHERE active = ? ORDER BY priority ASC, id ASC", (True if USING_POSTGRES else 1,))
        rows = fetchall(cur)
    for r in rows:
        r["id_prioridade"] = r.pop("priority")
    return jsonify({"ok": True, "demandas": rows, "can_delete": is_admin()})


@app.post("/api/demandas")
def create_demand():
    guard = require_login()
    if guard:
        return guard
    payload = request.get_json(force=True) or {}
    with get_conn() as conn:
        cur = conn.cursor()
        new_id = insert_demand(cur, payload, current_user())
    return jsonify({"ok": True, "id": new_id})


@app.put("/api/demandas/<int:demand_id>")
def update_demand(demand_id):
    guard = require_login()
    if guard:
        return guard
    payload = request.get_json(force=True) or {}
    status = normalize_status(payload.get("status"))
    data = normalize_date(payload.get("data")) or date.today().isoformat()
    prazo = normalize_date(payload.get("prazo"))
    with get_conn() as conn:
        cur = conn.cursor()
        execute(cur, """UPDATE demands SET cliente=?, data=?, melhoria=?, observacao=?, responsavel=?, prazo=?, status=?, updated_by=?, updated_at=?
                    WHERE id=? AND active=?""",
                (str(payload.get("cliente") or "Não informado").strip(), data, str(payload.get("melhoria") or "Demanda sem título").strip(),
                 str(payload.get("observacao") or "").strip(), str(payload.get("responsavel") or current_user()).strip(), prazo, status,
                 current_user(), now_iso(), demand_id, True if USING_POSTGRES else 1))
        audit(cur, demand_id, "update", current_user(), payload)
    return jsonify({"ok": True})


@app.put("/api/demandas/<int:demand_id>/status")
def update_status(demand_id):
    guard = require_login()
    if guard:
        return guard
    payload = request.get_json(force=True) or {}
    status = normalize_status(payload.get("status"))
    with get_conn() as conn:
        cur = conn.cursor()
        execute(cur, "UPDATE demands SET status=?, updated_by=?, updated_at=? WHERE id=? AND active=?",
                (status, current_user(), now_iso(), demand_id, True if USING_POSTGRES else 1))
        audit(cur, demand_id, "status", current_user(), {"status": status})
    return jsonify({"ok": True})


@app.delete("/api/demandas/<int:demand_id>")
def delete_demand(demand_id):
    guard = require_login()
    if guard:
        return guard
    if not is_admin():
        return jsonify({"ok": False, "error": "Exclusão liberada apenas para Admin."}), 403
    with get_conn() as conn:
        cur = conn.cursor()
        execute(cur, "UPDATE demands SET active=?, deleted_by=?, deleted_at=?, updated_by=?, updated_at=? WHERE id=?",
                (False if USING_POSTGRES else 0, current_user(), now_iso(), current_user(), now_iso(), demand_id))
        audit(cur, demand_id, "soft_delete", current_user(), {"id": demand_id})
    reorder_priorities()
    return jsonify({"ok": True})


def reorder_priorities(order=None):
    with get_conn() as conn:
        cur = conn.cursor()
        if order:
            for idx, demand_id in enumerate(order, start=1):
                execute(cur, "UPDATE demands SET priority=?, updated_at=? WHERE id=? AND active=?", (idx, now_iso(), int(demand_id), True if USING_POSTGRES else 1))
        else:
            execute(cur, "SELECT id FROM demands WHERE active=? ORDER BY priority ASC, id ASC", (True if USING_POSTGRES else 1,))
            ids = [r["id"] for r in fetchall(cur)]
            for idx, demand_id in enumerate(ids, start=1):
                execute(cur, "UPDATE demands SET priority=? WHERE id=?", (idx, demand_id))


@app.put("/api/reordenar")
def api_reorder():
    guard = require_login()
    if guard:
        return guard
    payload = request.get_json(force=True) or {}
    order = payload.get("order") or []
    if not isinstance(order, list) or not order:
        return jsonify({"ok": False, "error": "Ordem inválida."}), 400
    reorder_priorities(order)
    with get_conn() as conn:
        cur = conn.cursor()
        audit(cur, None, "reorder", current_user(), {"order": order})
    return jsonify({"ok": True})


@app.post("/api/importar")
def import_demands():
    guard = require_login()
    if guard:
        return guard
    payload = request.get_json(force=True) or {}
    rows = payload.get("rows") or []
    if not isinstance(rows, list):
        return jsonify({"ok": False, "error": "Formato inválido."}), 400
    count = 0
    with get_conn() as conn:
        cur = conn.cursor()
        for item in rows:
            if not isinstance(item, dict):
                continue
            if not (item.get("melhoria") or item.get("responsavel") or item.get("cliente")):
                continue
            insert_demand(cur, item, current_user())
            count += 1
        audit(cur, None, "bulk_import", current_user(), {"count": count})
    return jsonify({"ok": True, "importadas": count})


@app.get("/api/auditoria")
def audit_list():
    guard = require_login()
    if guard:
        return guard
    if not is_admin():
        return jsonify({"ok": False, "error": "Acesso restrito."}), 403
    with get_conn() as conn:
        cur = conn.cursor()
        execute(cur, "SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200")
        rows = fetchall(cur)
    return jsonify({"ok": True, "logs": rows})


init_db()

if __name__ == "__main__":
    app.run(debug=True)
