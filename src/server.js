import dotenv from 'dotenv';
import path from 'path';
dotenv.config()
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import { rotasDeAutenticacao, exigirLogin } from './auth.js';
import { rotasDeItens, salvarItem } from './itens.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração correta de cabeçalhos e CORS para evitar qualquer bloqueio local
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); 

// ROTAS DE LOGIN/CADASTRO (/api/login, /api/registrar) E DE ITENS (/api/itens) — usam o banco de dados
rotasDeAutenticacao(app);
rotasDeItens(app);

// CONFIGURAÇÃO DAS FERRAMENTAS DO ASSISTENTE
const ferramentasIA = [
  {
    type: "function",
    function: {
      name: "salvarNoBancoDeDados",
      description: "Registra um item achado ou perdido no sistema após coletar o tipo, item e local.",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["achado", "perdido"] },
          item: { type: "string", description: "O nome do objeto." },
          local: { type: "string", description: "Onde o item foi visto." },
          descricao: { type: "string", description: "Características extras." }
        },
        required: ["tipo", "item", "local"]
      }
    }
  }
];

const SYSTEM_PROMPT = `
Você é o assistente virtual de Achados e Perdidos do CEEP Curitiba.
Seu papel é coletar com precisão: o Tipo (se foi achado ou perdido), o Nome do Item e o Local dentro do colégio.
Assim que conseguir os 3 dados, acione a ferramenta 'salvarNoBancoDeDados' imediatamente.
`;

// ROTA DO CHAT DO ASSISTENTE (exige login)
app.post('/api/chat', exigirLogin, async (req, res) => {
  try {
    const { historicoMensagens } = req.body;
    let dadosItemExtraidos = null;

    if (!historicoMensagens) {
      return res.status(400).json({ erro: "Histórico ausente." });
    }

    const respuesta = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...historicoMensagens],
      tools: ferramentasIA, 
      tool_choice: "auto",
      parallel_tool_calls: false
    });

    // choices é uma LISTA: a mensagem fica em choices[0]
    const mensagemIA = respuesta.choices[0].message;
    const chamadaDeFuncao = mensagemIA.tool_calls?.[0];

    if (chamadaDeFuncao && chamadaDeFuncao.function.name === "salvarNoBancoDeDados") {
        const argumentos = JSON.parse(chamadaDeFuncao.function.arguments);
        let resultadoFerramenta;

        try {
            // SALVA DE VERDADE no banco de dados
            dadosItemExtraidos = salvarItem({
                tipo: argumentos.tipo,
                item: argumentos.item,
                local: argumentos.local,
                descricao: argumentos.descricao || "Capturado automaticamente via Chatbot"
            }, req.usuario.email);

            resultadoFerramenta = { status: "sucesso", id_registro: dadosItemExtraidos.id };
        } catch (erroDeSalvamento) {
            if (!erroDeSalvamento.validacao) throw erroDeSalvamento;
            // dado inválido: avisa a IA para pedir a informação de novo
            resultadoFerramenta = { status: "erro", mensagem: erroDeSalvamento.message };
        }

        const respostaFinalIA = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...historicoMensagens,
                mensagemIA,
                {
                    role: "tool",
                    tool_call_id: chamadaDeFuncao.id,
                    name: chamadaDeFuncao.function.name,
                    content: JSON.stringify(resultadoFerramenta)
                }
            ]
        });

        return res.json({ 
            respostaDaIA: respostaFinalIA.choices[0].message.content,
            itemRegistrado: dadosItemExtraidos
        });
    }

    res.json({ respostaDaIA: mensagemIA.content, itemRegistrado: null });

  } catch (error) {
    console.error("Erro interno no servidor do chat:", error);
    res.status(500).json({ erro: "Erro ao processar conversa com a IA." });
  }
});

// INICIALIZAÇÃO DO SERVIDOR FORÇANDO IPV4 UNIVERSAL
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor do CEEP rodando com sucesso em http://127.0.0.1:${PORT}`);
});