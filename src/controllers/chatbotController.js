import { ItemModel } from '../models/itemModel.js';

export const processChat = (req, res) => {
    const { mensaje } = req.body; // Se você usou "mensagem" no JS do front, mude aqui para mensagem
    const msgText = req.body.mensagem || mensaje; 

    if (!msgText) return res.status(400).json({ reply: 'Por favor, digite alguma coisa.' });

    const msgLower = msgText.toLowerCase();
    const itensAchados = ItemModel.getAll().filter(item => item.tipo === 'achado');

    const correspondencias = itensAchados.filter(item => {
        const nomeMatch = msgLower.includes(item.nome.toLowerCase());
        const descMatch = msgLower.includes(item.descricao.toLowerCase());
        const palavrasItem = item.nome.toLowerCase().split(' ');
        const termoMatch = palavrasItem.some(palavra => palavra.length > 3 && msgLower.includes(palavra));

        return nomeMatch || descMatch || termoMatch;
    });

    if (correspondencias.length > 0) {
        let resposta = "Encontrei alguns itens no sistema que batem com a sua descrição! Confira:<br><br>";
        correspondencias.forEach(item => {
            resposta += `📦 **${item.nome}**<br>📍 Localizado em: ${item.local}<br>📝 Detalhes: ${item.descricao}<br><br>`;
        });
        resposta += "Algum deles é seu? Se sim, dirija-se à secretaria do colégio para retirá-lo!";
        return res.json({ reply: resposta });
    }

    if (msgLower.includes('oi') || msgLower.includes('olá') || msgLower.includes('bom dia')) {
        return res.json({ reply: 'Olá! Sou o assistente de Achados e Perdidos da escola. O que você perdeu? Me dê detalhes como cor, tipo de objeto ou marca.' });
    }

    return res.json({ reply: 'Não consegui encontrar nenhum objeto correspondente nos nossos registros atuais de achados. Recomendo registrar o seu item perdido na página de cadastro ou checar na secretaria.' });
};
