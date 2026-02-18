// ... (todo o código inicial: express, pg, cors, bcrypt, etc. continua o mesmo)
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
// A linha da OpenAI pode ser comentada ou removida por enquanto, mas vamos deixá-la para facilitar a reativação
// const OpenAI = require('openai'); 

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function initializeDatabase() { /* ...código da função... */ }
app.post('/register', async (req, res) => { /* ...código da função... */ });
app.post('/login', async (req, res) => { /* ...código da função... */ });
app.get('/settings/:userId', async (req, res) => { /* ...código da função... */ });
app.post('/settings', async (req, res) => { /* ...código da função... */ });

// --- ROTA DE IA MODIFICADA (MODO SIMULAÇÃO) ---
app.post('/generate-post-idea', async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
    }

    try {
        const settingsResult = await pool.query('SELECT specialty FROM clinic_settings WHERE user_id = $1', [userId]);
        const specialty = settingsResult.rows[0]?.specialty;

        if (!specialty) {
            return res.status(404).json({ message: 'Por favor, salve sua especialidade nas configurações primeiro.' });
        }

        // --- INÍCIO DO MODO SIMULAÇÃO ---
        console.log(`[SIMULAÇÃO] Gerando ideia de post para a especialidade: ${specialty}`);
        
        // Simula um pequeno atraso, como se a IA estivesse pensando
        await new Promise(resolve => setTimeout(resolve, 1500)); 

        const mockIdea = {
            title: `[IDEIA SIMULADA] 5 Mitos Sobre ${specialty}`,
            description: `Este é um post de teste gerado pelo modo de simulação. Quando a API da OpenAI for ativada, aqui aparecerá um conteúdo real e criativo sobre ${specialty}.`
        };
        
        res.status(200).json(mockIdea);
        // --- FIM DO MODO SIMULAÇÃO ---

    } catch (error) {
        console.error("Erro no modo de simulação:", error);
        res.status(500).json({ message: "Erro interno no servidor de simulação." });
    }
});

app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  initializeDatabase();
});
