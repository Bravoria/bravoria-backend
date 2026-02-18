// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.5.0 (À PROVA DE TRAVAMENTOS)
// =================================================================

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const twilio = require('twilio');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('Erro Crítico: DATABASE_URL não definida.'); process.exit(1); }
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

// ... (código da Twilio e initializeDatabase inalterado) ...

// --- ROTA DE CADASTRO BLINDADA ---
app.post('/register', async (req, res) => {
    console.log('[ROTA /register] Início da requisição.');
    const { fullName, email, password } = req.body;

    if (!email || !password || !fullName) {
        console.log('[ROTA /register] Erro: Dados incompletos.');
        return res.status(400).json({ message: 'Nome, e-mail e senha são obrigatórios.' });
    }

    try {
        console.log(`[ROTA /register] 1. Verificando se o e-mail "${email}" já existe...`);
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (existingUser.rows.length > 0) {
            console.log(`[ROTA /register] Erro: E-mail "${email}" já cadastrado.`);
            return res.status(409).json({ message: 'E-mail já cadastrado.' });
        }

        console.log('[ROTA /register] 2. Criptografando a senha...');
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        console.log('[ROTA /register] 3. Inserindo novo usuário no banco de dados...');
        const newUser = await pool.query(
            'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, full_name',
            [fullName, email, passwordHash]
        );

        console.log('[ROTA /register] 4. Usuário criado com sucesso. Enviando resposta.');
        res.status(201).json({
            message: 'Usuário criado com sucesso',
            user: newUser.rows[0]
        });

    } catch (error) {
        console.error('[ROTA /register] XXX ERRO CRÍTICO XXX:', error);
        res.status(500).json({ message: 'Erro interno do servidor durante o cadastro.' });
    }
});

// ... (Resto do código: /login, /settings, /whatsapp-webhook, etc. inalterado) ...
// ... (app.listen inalterado) ...
