const express = require('express');
const router = express.Router();
const { supabase } = require('../services/supabase');
const { getSalesWhatsAppStatus } = require('../services/salesWhatsapp');

// GET /api/sales/leads — lista todos os leads com filtro opcional de stage
router.get('/leads', async (req, res) => {
    try {
        const { stage } = req.query;
        let query = supabase
            .from('sales_leads')
            .select('id, phone, name, stage, interest, ai_summary, demo_date, notes, created_at, updated_at')
            .order('updated_at', { ascending: false });

        if (stage) query = query.eq('stage', stage);

        const { data, error } = await query;
        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/sales/leads/:id — lead + histórico completo de mensagens
router.get('/leads/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('sales_leads')
            .select('*')
            .eq('id', req.params.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Lead não encontrado' });
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PATCH /api/sales/leads/:id — atualiza stage, notes, demo_date manualmente
router.patch('/leads/:id', async (req, res) => {
    try {
        const allowed = ['stage', 'notes', 'demo_date', 'interest', 'name'];
        const update = {};
        allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
        update.updated_at = new Date().toISOString();

        const { error } = await supabase
            .from('sales_leads')
            .update(update)
            .eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/sales/whatsapp/status — status da conexão do WhatsApp comercial
router.get('/whatsapp/status', (req, res) => {
    res.json({ success: true, data: getSalesWhatsAppStatus() });
});

// GET /api/sales/stats — contagens por stage para o dashboard
router.get('/stats', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('sales_leads')
            .select('stage');
        if (error) throw error;

        const counts = { novo: 0, qualificado: 0, demo_agendada: 0, fechado: 0, perdido: 0 };
        (data || []).forEach(l => {
            if (counts[l.stage] !== undefined) counts[l.stage]++;
        });
        res.json({ success: true, data: counts });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
