// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.1 (SEM ABREVIAÇÕES)
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
if (!connectionString) {
  console.error('Erro Crítico: A variável de ambiente DATABASE_URL não foi definida.');
  process.exit(1);
}
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!accountSid || !authToken) {
  console.warn('Atenção: Credenciais da Twilio não configuradas. A funcionalidade de WhatsApp estará desativada.');
}
const client = twilio(accountSid, authToken);

// --- 4. FUNÇÃO DE INICIALIZAÇÃO DO BANCO DE DADOS ---
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(255), created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        await client.query(`CREATE TABLE IF NOT EXISTS clinic_settings (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, specialty VARCHAR(255), insurances TEXT, address TEXT, updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        console.log('Tabelas "users" e "clinic_settings" verificadas/criadas.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    } finally {
        client.release();
    }
}

// --- 5. ROTAS DA APLICAÇÃO ---

app.get('/', (req, res) => { res.send('Backend da Bravor.ia v5: WhatsApp Ativado!'); });

app.post('/register', async (req, res) => {
  const { fullName, email, password } = req.body;
  if (!fullName || !email || !password) { return res.status(400).json({ message: 'Todos os campos são obrigatórios.' }); }
  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);
    const result = await pool.query('INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, full_name', [fullName, email, password_hash]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { return res.status(409).json({ message: 'Este e-mail já está em uso.' }); }
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) { return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' }); }
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user) { return res.status(404).json({ message: 'Usuário não encontrado.' }); }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) { return res.status(401).json({ message: 'Senha incorreta.' }); }
        res.status(200).json({ message: 'Login bem-sucedido!', user: { id: user.id, fullName: user.full_name, email: user.email } });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.get('/settings/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM clinic_settings WHERE user_id = $1', [userId]);
        if (result.rows.length > 0) { res.status(200).json(result.rows[0]); } 
        else { res.status(404).json({ message: 'Nenhuma configuração encontrada.' }); }
    } catch (error) {
        console.error('Erro ao buscar configurações:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/settings', async (req, res) => {
    const { userId, specialty, insurances, address } = req.body;
    if (!userId) { return res.status(400).json({ message: 'ID do usuário é obrigatório.' }); }
    try {
        const query = `INSERT INTO clinic_settings (user_id, specialty, insurances, address) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id) DO UPDATE SET specialty = EXCLUDED.specialty, insurances = EXCLUDED.insurances, address = EXCLUDED.address, updated_at = CURRENT_TIMESTAMP RETURNING *;`;
        const result = await pool.query(query, [userId, specialty, insurances, address]);
        res.status(200).json({ message: 'Configurações salvas com sucesso!', settings: result.rows[0] });
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.post('/generate-post-idea', async (req, res) => {
    const { userId } = req.body;
    if (!userId) { return res.status(400).json({ message: 'ID do usuário é obrigatório.' }); }
    try {
        const settingsResult = await pool.query('SELECT specialty FROM clinic_settings WHERE user_id = $1', [userId]);
        const specialty = settingsResult.rows[0]?.specialty;
        if (!specialty) { return res.status(404).json({ message: 'Por favor, salve sua especialidade nas configurações primeiro.' }); }
        console.log(`[SIMULAÇÃO] Gerando ideia de post para a especialidade: ${specialty}`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        const mockIdea = { title: `[IDEIA SIMULADA] 5 Mitos Sobre ${specialty}`, description: `Este é um post de teste gerado pelo modo de simulação.` };
        res.status(200).json(mockIdea);
    } catch (error) {
        console.error("Erro no modo de simulação:", error);
        res.status(500).json({ message: "Erro interno no servidor de simulação." });
    }
});

app.get('/ceo-insights/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const settingsResult = await pool.query('SELECT specialty FROM clinic_settings WHERE user_id = $1', [userId]);
        const settings = settingsResult.rows[0];
        let insightMessage = '';
        if (!settings || !settings.specialty) {
            insightMessage = "Notei que você ainda não configurou sua especialidade. Preencha suas informações abaixo para que eu possa começar a gerar conteúdo de IA para você!";
        } else {
            insightMessage = `Tudo pronto com sua especialidade de ${settings.specialty}! Que tal gerar sua primeira ideia de post para aquecer suas redes sociais?`;
        }
        res.status(200).json({ insight: insightMessage });
    } catch (error) {
        console.error("Erro ao gerar insight do CEO:", error);
        res.status(500).json({ message: "Não foi possível gerar o insight no momento." });
    }
});

app.post('/whatsapp-webhook', async (req, res) => {
    const incomingMsg = req.body.Body || '';
    const from = req.body.From;
    const to = req.body.To;
    console.log(`>>> Mensagem recebida de ${from}: "${incomingMsg}"`);
    let responseMsg = 'Olá! Eu sou a assistente virtual da Bravor.ia. Meu cérebro ainda está em desenvolvimento, mas já sei dizer oi. :)';
    if (incomingMsg.toLowerCase().includes('ajuda')) {
        responseMsg = 'Você pediu ajuda! Em breve, poderei te ajudar a agendar consultas e muito mais.';
    }
    try {
        if (!accountSid || !authToken) {
          throw new Error('Credenciais da Twilio não estão configuradas no servidor.');
        }
        await client.messages.create({
            body: responseMsg,
            from: to,
            to: from
        });
        console.log('<<< Resposta enviada com sucesso!');
    } catch (error) {
        console.error('XXX Erro ao enviar mensagem pela Twilio:', error.message);
    }
    res.status(200).send('<Response/>');
});

// --- 6. INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  initializeDatabase();
});
