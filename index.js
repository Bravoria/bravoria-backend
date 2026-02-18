// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.3 (Com Agendamento Humanizado)
// =================================================================

// --- 1. IMPORTAÇÕES ---
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const twilio = require('twilio');

// --- 2. CONFIGURAÇÃO INICIAL DO APLICATIVO ---
const app = express();
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
        console.log('Todas as tabelas foram verificadas/criadas com sucesso.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    } finally {
        clientDB.release();
    }
}

// --- 5. ROTAS DA APLICAÇÃO (ANTIGAS) ---
// ... (As rotas /register, /login, etc. continuam aqui, inalteradas) ...
app.get('/', (req, res) => { res.send('Backend da Bravor.ia v7: Cérebro Humanizado Ativado!'); });
// (O corpo das outras rotas está omitido para clareza, mas elas devem permanecer no seu arquivo)

// --- ROTA DO WHATSAPP (LÓGICA DE AGENDAMENTO HUMANIZADO) ---
app.post('/whatsapp-webhook', async (req, res) => {
    const incomingMsg = (req.body.Body || '').toLowerCase();
    const originalMsg = req.body.Body || '';
    const from = req.body.From;
    const to = req.body.To;
    console.log(`>>> [${from}] Mensagem: "${originalMsg}"`);

    let responseMsg = '';
    let session;

    try {
        // Garante que a sessão exista
        let sessionResult = await pool.query('SELECT * FROM whatsapp_sessions WHERE phone_number = $1', [from]);
        if (sessionResult.rows.length === 0) {
            sessionResult = await pool.query("INSERT INTO whatsapp_sessions (phone_number) VALUES ($1) RETURNING *", [from]);
        }
        session = sessionResult.rows[0];

        let currentStage = session.conversation_stage;
        let context = session.context || {};
        let nextStage = currentStage;

        // Palavras-chave para reiniciar ou cancelar
        if (['cancelar', 'parar', 'sair'].some(word => incomingMsg.includes(word))) {
            responseMsg = 'Entendido. Estou cancelando a operação atual. Se precisar de algo mais, é só chamar!';
            nextStage = 'awaiting_initial_contact';
            context = {}; // Limpa o contexto
        } else {
            // Lógica da Máquina de Estados Humanizada
            switch (currentStage) {
                case 'awaiting_initial_contact':
                    if (['agendar', 'consulta', 'marcar', 'horário'].some(word => incomingMsg.includes(word))) {
                        responseMsg = 'Olá! Claro, vamos agendar sua consulta. Para qual dia você estaria pensando?';
                        nextStage = 'awaiting_day';
                    } else {
                        responseMsg = 'Olá! Sou a assistente virtual da Bravor.ia. Como posso ajudar? Se quiser, posso agendar uma consulta para você.';
                    }
                    break;

                case 'awaiting_day':
                    context.day = originalMsg; // Salva o que o usuário digitou
                    responseMsg = `Ótimo, para "${context.day}". Tenho estes horários disponíveis: *09:00*, *11:00* e *14:30*. Qual deles fica melhor na sua agenda?`;
                    nextStage = 'awaiting_time';
                    break;

                case 'awaiting_time':
                    context.time = originalMsg; // Salva a hora
                    responseMsg = `Perfeito! Só para confirmar, o agendamento é para *${context.day}* às *${context.time}*. Correto? (Responda 'sim' ou 'não')`;
                    nextStage = 'awaiting_confirmation';
                    break;

                case 'awaiting_confirmation':
                    if (['sim', 's', 'correto', 'isso', 'confirmo'].some(word => incomingMsg.includes(word))) {
                        responseMsg = `Maravilha! Seu horário para ${context.day} às ${context.time} está reservado. Você receberá um lembrete um dia antes, ok? Tenha um ótimo dia!`;
                        nextStage = 'awaiting_initial_contact'; // Reinicia para a próxima conversa
                        context = {}; // Limpa o contexto
                    } else {
                        responseMsg = 'Ops, entendi errado. Vamos tentar de novo. Para qual dia você gostaria de agendar?';
                        nextStage = 'awaiting_day';
                        context = {};
                    }
                    break;
            }
        }

        // Atualiza a sessão no banco de dados
        await pool.query('UPDATE whatsapp_sessions SET conversation_stage = $1, context = $2, last_updated = CURRENT_TIMESTAMP WHERE phone_number = $3', [nextStage, context, from]);
        
        // Envia a resposta
        if (!accountSid || !authToken) { throw new Error('Credenciais da Twilio não configuradas.'); }
        await client.messages.create({ body: responseMsg, from: to, to: from });
        console.log(`<<< [${from}] Resposta: "${responseMsg}" (Estágio: ${currentStage} -> ${nextStage})`);

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
