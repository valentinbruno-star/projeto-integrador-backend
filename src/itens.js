import { db } from './db.js';
import { exigirLogin, exigirAdmin } from './auth.js';

const inserir    = db.prepare('INSERT INTO itens (tipo, item, local, descricao, criado_por) VALUES (?, ?, ?, ?, ?)');
const listar     = db.prepare('SELECT * FROM itens ORDER BY id DESC');
const buscar     = db.prepare('SELECT * FROM itens WHERE id = ?');
const alternar   = db.prepare("UPDATE itens SET tipo = CASE tipo WHEN 'perdido' THEN 'achado' ELSE 'perdido' END WHERE id = ?");
const apagar     = db.prepare('DELETE FROM itens WHERE id = ?');

// Converte a linha do banco para o formato que o site já usa (id, tipo, item, local, desc)
const paraOSite = (linha) => ({
    id: linha.id,
    tipo: linha.tipo,
    item: linha.item,
    local: linha.local,
    desc: linha.descricao || "Nenhuma observação adicional",
    criadoPor: linha.criado_por,
    criadoEm: linha.criado_em
});

function erroDeValidacao(mensagem) {
    const erro = new Error(mensagem);
    erro.validacao = true;
    return erro;
}

// Valida e grava um item no banco. Usada pelo formulário e também pelo chat com IA.
export function salvarItem({ tipo, item, local, descricao }, criadoPor) {
    const t = String(tipo || '').trim().toLowerCase();
    const i = String(item || '').trim();
    const l = String(local || '').trim();
    const d = String(descricao || '').trim();

    if (!['achado', 'perdido'].includes(t)) throw erroDeValidacao('O tipo deve ser "achado" ou "perdido".');
    if (!i || !l) throw erroDeValidacao('Informe o nome do item e o local.');
    if (i.length > 100 || l.length > 100) throw erroDeValidacao('Nome e local aceitam até 100 caracteres.');
    if (d.length > 500) throw erroDeValidacao('A descrição aceita até 500 caracteres.');

    const resultado = inserir.run(t, i, l, d, criadoPor || null);
    return paraOSite(buscar.get(Number(resultado.lastInsertRowid)));
}

function tratarErro(res, error, mensagemPadrao) {
    if (error.validacao) return res.status(400).json({ erro: error.message });
    console.error(mensagemPadrao, error);
    res.status(500).json({ erro: mensagemPadrao });
}

export function rotasDeItens(app) {

    // LISTAR (qualquer usuário logado)
    app.get('/api/itens', exigirLogin, (req, res) => {
        try {
            res.json(listar.all().map(paraOSite));
        } catch (error) {
            tratarErro(res, error, "Erro ao buscar os itens.");
        }
    });

    // CADASTRAR (somente admin)
    app.post('/api/itens', exigirAdmin, (req, res) => {
        try {
            const novo = salvarItem(req.body || {}, req.usuario.email);
            res.status(201).json(novo);
        } catch (error) {
            tratarErro(res, error, "Erro ao salvar o item.");
        }
    });

    // ALTERNAR perdido <-> achado (somente admin)
    app.put('/api/itens/:id/status', exigirAdmin, (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || !buscar.get(id)) {
                return res.status(404).json({ erro: "Item não encontrado." });
            }
            alternar.run(id);
            res.json(paraOSite(buscar.get(id)));
        } catch (error) {
            tratarErro(res, error, "Erro ao alterar o status.");
        }
    });

    // REMOVER (somente admin)
    app.delete('/api/itens/:id', exigirAdmin, (req, res) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || !buscar.get(id)) {
                return res.status(404).json({ erro: "Item não encontrado." });
            }
            apagar.run(id);
            res.json({ status: "removido", id });
        } catch (error) {
            tratarErro(res, error, "Erro ao remover o item.");
        }
    });
}