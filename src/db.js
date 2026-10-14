import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// O banco é UM arquivo, "achados-perdidos.db", criado automaticamente ao lado deste arquivo.
export const pastaDoProjeto = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(path.join(pastaDoProjeto, 'achados-perdidos.db'));

// Cria as tabelas na primeira execução (nas próximas, não faz nada).
db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        email      TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'aluno' CHECK (role IN ('admin', 'aluno')),
        criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS itens (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo       TEXT NOT NULL CHECK (tipo IN ('achado', 'perdido')),
        item       TEXT NOT NULL,
        local      TEXT NOT NULL,
        descricao  TEXT NOT NULL DEFAULT '',
        criado_por TEXT,
        criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_itens_tipo ON itens (tipo);
`);