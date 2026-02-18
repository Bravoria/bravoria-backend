// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.4 (Com Painel de Agendamentos)
// =================================================================

// --- 1. IMPORTAÇÕES E CONFIGURAÇÕES (Inalteradas) ---
const express = require('express');
const { Pool } = require('pg');
// ... (resto das importações e configurações)

// --- 4. FUNÇÃO DE INICIALIZAÇÃO DO BANCO DE DADOS (Atualizada) ---
async function initializeDatabase() {
    const clientDB = await pool.connect();
    try {
        await clientDB.query(`CREATE TABLE IF NOT EXISTS users (...)`); // Inalterado
        await clientDB.query(`CREATE TABLE IF NOT EXISTS clinic_settings (...)`); // Inalterado
        await clientDB.query(`CREATE TABLE IF NOT EXISTS whatsapp_sessions (...)`); // Inalterado
        // NOVA TABELA DE AGENDAMENTOS
        await clientDB.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                patient_phone VARCHAR(255) NOT NULL,
                appointment_day TEXT,
                appointment_time TEXT,
                status VARCHAR(50) DEFAULT 'confirmed',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Todas as 4 tabelas foram verificadas/criadas com sucesso.');
    } catch (err) { /* ... */ } finally { clientDB.release(); }
}

// --- 5. ROTAS DA APLICAÇÃO ---
// ... (Rotas antigas inalteradas) ...

// NOVA ROTA PARA BUSCAR AGENDAMENTOS
app.get('/appointments/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        // Por enquanto, estamos buscando todos os agendamentos. No futuro, filtraremos por user_id.
        const result = await pool.query('SELECT patient_phone, appointment_day, appointment_time, created_at FROM appointments ORDER BY created_at DESC LIMIT 10');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar agendamentos:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});


// ROTA DO WHATSAPP (LÓGICA ATUALIZADA)
app.post('/whatsapp-webhook', async (req, res) => {
    // ... (lógica inicial inalterada) ...
    
    // Lógica da Máquina de Estados
    switch (currentStage) {
        // ... (cases 'awaiting_initial_contact', 'awaiting_day', 'awaiting_time' inalterados) ...

        case 'awaiting_confirmation':
            if (['sim', 's', 'correto', 'isso', 'confirmo'].some(word => incomingMsg.includes(word))) {
                
                // >>> INÍCIO DA NOVA LÓGICA <<<
                try {
                    // SIMULAÇÃO: Assume que o agendamento é para o usuário 1.
                    // No futuro, o número da Twilio estará ligado a um user_id.
                    const mockUserId = 1; 
                    await pool.query(
                        'INSERT INTO appointments (user_id, patient_phone, appointment_day, appointment_time) VALUES ($1, $2, $3, $4)',
                        [mockUserId, from, context.day, context.time]
                    );
                    console.log(`>>> AGENDAMENTO SALVO NO BANCO DE DADOS para ${from}`);
                } catch (dbError) {
                    console.error("XXX Erro ao salvar agendamento no banco:", dbError);
                }
                // >>> FIM DA NOVA LÓGICA <<<

                responseMsg = `Maravilha! Seu horário para ${context.day} às ${context.time} está reservado...`;
                nextStage = 'awaiting_initial_contact';
                context = {};
            } else {
                // ... (lógica de 'não' inalterada) ...
            }
            break;
    }
    // ... (resto da função inalterado) ...
});

// --- 6. INICIALIZAÇÃO DO SERVIDOR ---
// ... (inalterado) ...
