const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const OpenAI = require('openai'); // Importa a biblioteca da OpenAI

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÕES ---
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// Configura a OpenAI com a chave da variável de ambiente
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// --- INICIALIZAÇÃO DO BANCO ---
async function initializeDatabase() { /* ...código existente... */ }

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/register', async (req, res) => { /* ...código existente... */ });
app.post('/login', async (req, res) => { /* ...código existente... */ });

// --- ROTAS DE CONFIGURAÇÃO ---
app.get('/settings/:userId', async (req, res) => { /* ...código existente... */ });
app.post('/settings', async (req, res) => { /* ...código existente... */ });

// --- NOVA ROTA DE IA ---
app.post('/generate-post-idea', async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
    }

    try {
        // 1. Buscar a especialidade do usuário no banco
        const settingsResult = await pool.query('SELECT specialty FROM clinic_settings WHERE user_id = $1', [userId]);
        const specialty = settingsResult.rows[0]?.specialty;

        if (!specialty) {
            return res.status(404).json({ message: 'Por favor, salve sua especialidade nas configurações primeiro.' });
        }

        // 2. Montar o prompt para a IA
        const prompt = `Aja como um especialista em marketing de conteúdo para a área da saúde. Gere uma ideia de post para Instagram para um profissional de ${specialty}. A resposta deve ser um JSON contendo "title" (um título chamativo) e "description" (um parágrafo curto explicando o post).`;

        // 3. Chamar a API da OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // Modelo rápido e eficiente
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }, // Pede a resposta em formato JSON
        });

        const idea = JSON.parse(completion.choices[0].message.content);
        
        // 4. Enviar a ideia de volta para o frontend
        res.status(200).json(idea);

    } catch (error) {
        console.error("Erro ao gerar ideia de post:", error);
        res.status(500).json({ message: "Não foi possível gerar a ideia de post no momento." });
    }
});


app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  initializeDatabase();
});
