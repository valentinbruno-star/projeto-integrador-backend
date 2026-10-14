import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('database.json');

export const ItemModel = {
    getAll: () => {
        const data = fs.readFileSync(dbPath, 'utf-8');
        return JSON.parse(data);
    },
    save: (items) => {
        fs.writeFileSync(dbPath, JSON.stringify(items, null, 2), 'utf-8');
    },
    create: (newItem) => {
        const items = ItemModel.getAll();
        newItem.id = Date.now();
        items.push(newItem);
        ItemModel.save(items);
        return newItem;
    }
};
