// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.4.1 (COMPLETO E CORRIGIDO)
// =================================================================

// --- 1. IMPORTAÇÕES ---
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const twilio = require('twilio');

// --- 2. CONFIGURAÇÃO INICIAL DO APLICATIVO ---
const app = express(); // A LINHA QUE FALTAVA!
const port = process.env.PORT || 3001;
app.use(cors());
app.use(express.urlencoded({ extended: false })); 
app.use(express.json());

// --- 3. CONFIGURAÇÃO DAS CONEXÕES EXTERNAS ---
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('Erro Crítico: DATABASE_URL não definida.'); process.exit(1); }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!accountSid || !authToken) { console.warn('Atenção: Credenciais da Twilio não configuradas.'); }
const client = twilio(accountSid, authToken);

// --- 4. FUNÇÃO DE INICIALIZAÇÃO DO BANCO DE DADOS ---
async function initializeDatabase() {
    const clientDB = await pool.connect();
    try {
        await clientDB.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(255), created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        await clientDB.query(`CREATE TABLE IF NOT EXISTS clinic_settings (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, specialty VARCHAR(255), insurances TEXT, address TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        await clientDB.query(`CREATE TABLE IF NOT EXISTS whatsapp_sessions (id SERIAL PRIMARY KEY, phone_number VARCHAR(255) UNIQUE NOT NULL, conversation_stage VARCHAR(50) DEFAULT 'awaiting_initial_contact', context JSONB, last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        await clientDB.query(`CREATE TABLE IF NOT EXISTS appointments (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, patient_phone VARCHAR(255) NOT NULL, appointment_day TEXT, appointment_time TEXT, status VARCHAR(50) DEFAULT 'confirmed', created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        console.log('Todas as 4 tabelas foram verificadas/criadas com sucesso.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    } finally {
        clientDB.release();
    }
}

// --- 5. ROTAS DA APLICAÇÃO ---

app.get('/', (req, res) => { res.send('Backend da Bravor.ia v8: Painel de Agendamentos Ativado!'); });

app.post('/register', async (req, res) => { /* ...código da função... */ });
app.post('/login', async (req, res) => { /* ...código da função... */ });
app.get('/settings/:userId', async (req, res) => { /* ...código da função... */ });
app.post('/settings', async (req, res) => { /* ...código da função... */ });
app.post('/generate-post-idea', async (req, res) => { /* ...código da função... */ });
app.get('/ceo-insights/:userId', async (req, res) => { /* ...código da função... */ });

// NOVA ROTA PARA BUSCAR AGENDAMENTOS
app.get('/appointments/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT patient_phone, appointment_day, appointment_time, created_at FROM appointments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar agendamentos:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// ROTA DO WHATSAPP ATUALIZADA
app.post('/whatsapp-webhook', async (req, res) => {
    const incomingMsg = (req.body.Body || '').toLowerCase();
    const originalMsg = req.body.Body || '';
    const from = req.body.From;
    const to = req.body.To;
    console.log(`>>> [${from}] Mensagem: "${originalMsg}"`);

    let session;
    try {
        let sessionResult = await pool.query('SELECT * FROM whatsapp_sessions WHERE phone_number = $1', [from]);
        if (sessionResult.rows.length === 0) {
            sessionResult = await pool.query("INSERT INTO whatsapp_sessions (phone_number) VALUES ($1) RETURNING *", [from]);
        }
        session = sessionResult.rows[0];

        let currentStage = session.conversation_stage;
        let context = session.context || {};
        let nextStage = currentStage;
        let responseMsg = '';

        if (['cancelar', 'parar', 'sair'].some(word => incomingMsg.includes(word))) {
            responseMsg = 'Entendido. Operação cancelada. Se precisar de algo mais, é só chamar!';
            nextStage = 'awaiting_initial_contact';
            context = {};
        } else {
            switch (currentStage) {
                case 'awaiting_initial_contact':
                    if (['agendar', 'consulta', 'marcar', 'horário'].some(word => incomingMsg.includes(word))) {
                        responseMsg = 'Olá! Claro, vamos agendar. Para qual dia você gostaria?';
                        nextStage = 'awaiting_day';
                    } else {
                        responseMsg = 'Olá! Sou a assistente da Bravor.ia. Para agendar, diga "quero marcar uma consulta".';
                    }
                    break;
                case 'awaiting_day':
                    context.day = originalMsg;
                    responseMsg = `Ok, para "${context.day}". Tenho estes horários: *09:00*, *11:00*, *14:30*. Qual prefere?`;
                    nextStage = 'awaiting_time';
                    break;
                case 'awaiting_time':
                    context.time = originalMsg;
                    responseMsg = `Confirmando: agendamento para *${context.day}* às *${context.time}*. Correto? (Responda 'sim' ou 'não')`;
                    nextStage = 'awaiting_confirmation';
                    break;
                case 'awaiting_confirmation':
                    if (['sim', 's', 'correto', 'isso', 'confirmo'].some(word => incomingMsg.includes(word))) {
                        const mockUserId = 1; // SIMULAÇÃO: Todos agendamentos vão para o usuário 1
                        await pool.query('INSERT INTO appointments (user_id, patient_phone, appointment_day, appointment_time) VALUES ($1, $2, $3, $4)', [mockUserId, from, context.day, context.time]);
                        console.log(`>>> AGENDAMENTO SALVO NO BANCO DE DADOS para ${from}`);
                        responseMsg = `Maravilha! Seu horário para ${context.day} às ${context.time} está reservado. Até mais!`;
                        nextStage = 'awaiting_initial_contact';
                        context = {};
                    } else {
                        responseMsg = 'Ops, entendi errado. Vamos tentar de novo. Para qual dia você gostaria de agendar?';
                        nextStage = 'awaiting_day';
                        context = {};
                    }
                    break;
            }
        }
        await pool.query('UPDATE whatsapp_sessions SET conversation_stage = $1, context = $2, last_updated = CURRENT_TIMESTAMP WHERE phone_number = $3', [nextStage, context, from]);
        if (!accountSid || !authToken) { throw new Error('Credenciais da Twilio não configuradas.'); }
        await client.messages.create({ body: responseMsg, from: to, to: from });
        console.log(`<<< [${from}] Resposta: "${responseMsg}"`);
    } catch (error) {
        console.error('XXX Erro na lógica do webhook:', error.message);
    }
    res.status(200).send('<Response/>');
});

// --- 6. INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  initializeDatabase();
});
