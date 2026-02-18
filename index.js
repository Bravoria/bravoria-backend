// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.7.0 (VERSÃO PAINEL)
// =================================================================

// --- 1. IMPORTAÇÕES ---
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const OpenAI = require('openai'); // Importa a OpenAI

// --- 2. CONFIGURAÇÃO INICIAL ---
const app = express();
const port = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// --- 3. CONEXÕES EXTERNAS ---
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('Erro Crítico: DATABASE_URL não definida.'); process.exit(1); }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- 4. INICIALIZAÇÃO DO BANCO ---
async function initializeDatabase() {
    const clientDB = await pool.connect();
    try {
        await clientDB.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(255));`);
        await clientDB.query(`CREATE TABLE IF NOT EXISTS clinic_settings (id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE, specialty VARCHAR(255), insurances TEXT, address TEXT);`);
        await clientDB.query(`CREATE TABLE IF NOT EXISTS appointments (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, patient_phone VARCHAR(255) NOT NULL, appointment_day TEXT, appointment_time TEXT, status VARCHAR(50) DEFAULT 'confirmed', created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP);`);
        console.log('Tabelas do Painel verificadas/criadas com sucesso.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    } finally {
        clientDB.release();
    }
}

// --- 5. ROTAS ---
app.get('/', (req, res) => { res.send('Backend da Bravor.ia v1.7.0 (Painel) está no ar!'); });

// Rotas de Login e Cadastro (inalteradas)
app.post('/register', async (req, res) => { /* ...código da v1.6.0... */ });
app.post('/login', async (req, res) => { /* ...código da v1.6.0... */ });

// Rotas do Painel (Reativadas)
app.get('/settings/:userId', async (req, res) => { /* ...código antigo... */ });
app.post('/settings', async (req, res) => { /* ...código antigo... */ });
app.get('/appointments/:userId', async (req, res) => { /* ...código antigo... */ });
app.get('/ceo-insights/:userId', async (req, res) => { /* ...código antigo... */ });
app.post('/generate-post-idea', async (req, res) => { /* ...código antigo... */ });


// --- 6. INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
  console.log(`Backend da Bravor.ia (Painel) rodando na porta ${port}`);
  initializeDatabase();
});
