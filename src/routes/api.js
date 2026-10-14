import { Router } from 'express';
import { getItems, createItem } from '../controllers/itemController.js';
import { processChat } from '../controllers/chatbotController.js';

const router = Router();

router.get('/items', getItems);
router.post('/items', createItem);
router.post('/chatbot', processChat);

export default router;
