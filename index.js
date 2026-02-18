// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.6.0 (VERSÃO LIGHT)
// =================================================================

// --- 1. IMPORTAÇÕES ESSENCIAIS ---
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');

// --- 2. CONFIGURAÇÃO INICIAL ---
const app = express();
const port = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());

// --- 3. CONEXÃO COM BANCO DE DADOS ---
const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('Erro Crítico: DATABASE_URL não definida.'); process.exit(1); }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// --- 4. INICIALIZAÇÃO DO BANCO ---
async function initializeDatabase() {
    const clientDB = await pool.connect();
    try {
        // Criando apenas as tabelas essenciais para o teste
        await clientDB.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(255));`);
        console.log('Tabela "users" verificada/criada com sucesso.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    } finally {
        clientDB.release();
    }
}

// --- 5. ROTAS ---

// Rota de verificação
app.get('/', (req, res) => { res.send('Backend da Bravor.ia v1.6.0 (Light) está no ar!'); });

// Rota de Cadastro
app.post('/register', async (req, res) => {
    const { fullName, email, password } = req.body;
    if (!email || !password || !fullName) {
        return res.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' });
    }
    try {
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ message: 'E-mail já cadastrado.' });
        }
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const newUser = await pool.query(
            'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, full_name',
            [fullName, email, passwordHash]
        );
        res.status(201).json({ message: 'Usuário criado com sucesso', user: newUser.rows[0] });
    } catch (error) {
        console.error('[ROTA /register] ERRO:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Rota de Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    }
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Senha incorreta.' });
        }
        res.status(200).json({ message: 'Login bem-sucedido', user: { id: user.id, email: user.email, fullName: user.full_name } });
    } catch (error) {
        console.error('[ROTA /login] ERRO:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// --- 6. INICIALIZAÇÃO DO SERVIDOR ---
app.listen(port, () => {
  console.log(`Backend da Bravor.ia (Light) rodando na porta ${port}`);
  initializeDatabase();
});
