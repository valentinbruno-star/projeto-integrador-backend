import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dns from 'dns/promises';
import { db, pastaDoProjeto } from './db.js';

// Se for true, só aceita e-mails de domínios que existem e recebem mensagens.
// Para testar com um domínio inventado (ex.: teste@ceep.com), mude para false.
const VERIFICAR_DOMINIO_DO_EMAIL = true;
const LIMITE_DNS_MS = 4000;

const buscarPorEmail = db.prepare('SELECT * FROM usuarios WHERE email = ?');
const inserirUsuario = db.prepare('INSERT OR IGNORE INTO usuarios (email, senha_hash, role) VALUES (?, ?, ?)');

const normalizarEmail = (email) => String(email || '').trim().toLowerCase();

// ---------- VALIDAÇÃO DE E-MAIL ----------

// Confere o formato: nome@dominio.com (sem pontos duplicados, sem espaços, com final como .com ou .com.br)
function emailTemFormatoValido(email) {
    if (email.length > 254) return false;
    const partes = email.split('@');
    if (partes.length !== 2) return false;
    const [usuario, dominio] = partes;
    if (!usuario || usuario.length > 64) return false;
    return /^[a-z0-9]+([._%+-][a-z0-9]+)*$/.test(usuario)
        && /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(dominio);
}

function comLimite(promessa, ms) {
    let temporizador;
    const limite = new Promise((resolve) => { temporizador = setTimeout(() => resolve(null), ms); });
    return Promise.race([promessa, limite]).finally(() => clearTimeout(temporizador));
}

// true = encontrou registros | false = o domínio não existe | null = não deu para verificar (ex.: sem internet)
async function consultarDns(funcao, dominio) {
    try {
        const registros = await comLimite(funcao(dominio), LIMITE_DNS_MS);
        if (registros === null) return null;
        return registros.length > 0;
    } catch (error) {
        return ['ENOTFOUND', 'ENODATA'].includes(error.code) ? false : null;
    }
}

// Só recusa quando o DNS afirma que o domínio não existe. Se não for possível consultar, deixa passar.
async function dominioRecebeEmail(dominio) {
    for (const funcao of [dns.resolveMx, dns.resolve4, dns.resolve6]) {
        const resultado = await consultarDns(funcao, dominio);
        if (resultado !== false) return true;
    }
    return false;
}

// ---------- VALIDAÇÃO DE SENHA ----------

// Devolve a lista do que está faltando (vazia = senha aceita)
function problemasDaSenha(senha) {
    const faltando = [];
    if (senha.length < 8) faltando.push('pelo menos 8 caracteres');
    if (senha.length > 100) faltando.push('no máximo 100 caracteres');
    if (!/\p{Ll}/u.test(senha)) faltando.push('uma letra minúscula');
    if (!/\p{Lu}/u.test(senha)) faltando.push('uma letra maiúscula');
    if (!/[0-9]/.test(senha)) faltando.push('um número');
    return faltando;
}

// As senhas são guardadas com hash (nunca em texto puro).
function gerarHashSync(senha) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(senha, salt, 64).toString('hex')}`;
}

function gerarHash(senha) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.scrypt(senha, salt, 64, (err, chave) => {
            if (err) return reject(err);
            resolve(`${salt}:${chave.toString('hex')}`);
        });
    });
}

function conferirHash(senha, armazenado) {
    return new Promise((resolve, reject) => {
        const [salt, hash] = String(armazenado).split(':');
        crypto.scrypt(senha, salt, 64, (err, chave) => {
            if (err) return reject(err);
            resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), chave));
        });
    });
}

// USUÁRIOS INICIAIS: o admin e o aluno que já existiam são criados no banco se ainda não estiverem lá.
// (As regras de senha valem só para contas novas; estas duas continuam com as senhas de sempre.)
function garantirUsuario(email, senha, role) {
    if (!buscarPorEmail.get(email)) inserirUsuario.run(email, gerarHashSync(senha), role);
}
garantirUsuario("admin@ceep.com", "3DAM1", "admin");
garantirUsuario("aluno@ceep.com", "cadastro", "aluno");

// MIGRAÇÃO: se existir o antigo usuarios.json, as contas dele são copiadas para o banco (uma única vez).
const arquivoAntigo = path.join(pastaDoProjeto, 'usuarios.json');
if (fs.existsSync(arquivoAntigo)) {
    try {
        const antigos = JSON.parse(fs.readFileSync(arquivoAntigo, 'utf-8'));
        for (const u of antigos) inserirUsuario.run(normalizarEmail(u.email), u.senhaHash, 'aluno');
        fs.renameSync(arquivoAntigo, arquivoAntigo + '.migrado');
        console.log(`Contas antigas copiadas para o banco de dados (${antigos.length}).`);
    } catch (error) {
        console.error("Não foi possível migrar o usuarios.json:", error);
    }
}

// SESSÕES: ao entrar, o servidor entrega um token que o site envia nas próximas requisições.
// Ficam na memória: se o servidor reiniciar, é preciso entrar de novo.
const sessoes = new Map();
const DURACAO_SESSAO = 8 * 60 * 60 * 1000; // 8 horas

function criarSessao(email, role) {
    const token = crypto.randomBytes(32).toString('hex');
    sessoes.set(token, { email, role, expira: Date.now() + DURACAO_SESSAO });
    return token;
}

export function exigirLogin(req, res, next) {
    const cabecalho = req.headers.authorization || '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : '';
    const sessao = sessoes.get(token);

    if (!sessao || sessao.expira < Date.now()) {
        sessoes.delete(token);
        return res.status(401).json({ erro: "Faça login para continuar." });
    }
    req.usuario = sessao;
    next();
}

export function exigirAdmin(req, res, next) {
    exigirLogin(req, res, () => {
        if (req.usuario.role !== 'admin') {
            return res.status(403).json({ erro: "Apenas administradores podem fazer isso." });
        }
        next();
    });
}

export function rotasDeAutenticacao(app) {

    // ROTA DE LOGIN: devolve { status, role, token }
    app.post('/api/login', async (req, res) => {
        try {
            const { email, senha } = req.body;

            if (!email || !senha) {
                return res.status(400).json({ erro: "E-mail e senha são obrigatórios." });
            }

            const conta = buscarPorEmail.get(normalizarEmail(email));
            if (conta && await conferirHash(String(senha), conta.senha_hash)) {
                return res.json({ status: "autenticado", role: conta.role, token: criarSessao(conta.email, conta.role) });
            }

            return res.status(401).json({ erro: "E-mail ou senha incorretos." });
        } catch (error) {
            console.error("Erro interno na rota de login:", error);
            res.status(500).json({ erro: "Erro interno no servidor de autenticação." });
        }
    });

    // ROTA DE CADASTRO: cria sempre uma conta de "aluno" e já devolve a sessão (a pessoa entra direto)
    app.post('/api/registrar', async (req, res) => {
        try {
            const email = normalizarEmail(req.body?.email);
            const senha = String(req.body?.senha ?? '');

            if (!emailTemFormatoValido(email)) {
                return res.status(400).json({ erro: "Informe um e-mail válido, por exemplo nome@dominio.com." });
            }

            const faltando = problemasDaSenha(senha);
            if (faltando.length > 0) {
                return res.status(400).json({ erro: `A senha precisa ter: ${faltando.join(', ')}.` });
            }

            if (buscarPorEmail.get(email)) {
                return res.status(409).json({ erro: "Este e-mail já está cadastrado." });
            }

            if (VERIFICAR_DOMINIO_DO_EMAIL && !(await dominioRecebeEmail(email.split('@')[1]))) {
                return res.status(400).json({ erro: "Esse domínio de e-mail não existe ou não recebe mensagens. Confira o endereço digitado." });
            }

            const senhaHash = await gerarHash(senha);

            // Daqui até o INSERT não há "await", então dois cadastros simultâneos não se atropelam.
            if (buscarPorEmail.get(email)) {
                return res.status(409).json({ erro: "Este e-mail já está cadastrado." });
            }
            inserirUsuario.run(email, senhaHash, 'aluno');

            return res.status(201).json({ status: "criado", role: "aluno", token: criarSessao(email, 'aluno') });
        } catch (error) {
            console.error("Erro interno na rota de cadastro:", error);
            res.status(500).json({ erro: "Erro interno ao criar a conta." });
        }
    });
}