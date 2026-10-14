import { ItemModel } from '../models/itemModel.js';

export const getItems = (req, res) => {
    try {
        const items = ItemModel.getAll();
        res.status(200).json(items);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar itens.' });
    }
};

export const createItem = (req, res) => {
    try {
        const { nome, local, descricao, tipo } = req.body;
        if (!nome || !local || !descricao || !tipo) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
        }
        const newItem = ItemModel.create({ nome, local, descricao, tipo });
        res.status(201).json(newItem);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar o item.' });
    }
};
