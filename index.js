const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { /* ...código existente... */ }
const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

// Função para inicializar o banco de dados
async function initializeDatabase() {
    const client = await pool.connect();
    try {
        // Cria a tabela de usuários (se não existir)
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        // Cria a tabela de configurações da clínica (se não existir)
        await client.query(`
          CREATE TABLE IF NOT EXISTS clinic_settings (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            specialty VARCHAR(255),
            insurances TEXT,
            address TEXT,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log('Tabelas "users" e "clinic_settings" verificadas/criadas.');
    } catch (err) {
        console.error('Erro ao inicializar o banco de dados:', err);
    } finally {
        client.release();
    }
}

// Rotas de autenticação (/register, /login) - continuam as mesmas
app.post('/register', async (req, res) => { /* ...código existente... */ });
app.post('/login', async (req, res) => { /* ...código existente... */ });

// --- NOVAS ROTAS DE CONFIGURAÇÃO ---

// Rota para BUSCAR as configurações do usuário
app.get('/settings/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM clinic_settings WHERE user_id = $1', [userId]);
        if (result.rows.length > 0) {
            res.status(200).json(result.rows[0]);
        } else {
            res.status(404).json({ message: 'Nenhuma configuração encontrada para este usuário.' });
        }
    } catch (error) {
        console.error('Erro ao buscar configurações:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

// Rota para SALVAR ou ATUALIZAR as configurações
app.post('/settings', async (req, res) => {
    const { userId, specialty, insurances, address } = req.body;
    if (!userId) {
        return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
    }

    try {
        // "UPSERT": Insere se não existir, atualiza se existir.
        const query = `
            INSERT INTO clinic_settings (user_id, specialty, insurances, address)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                specialty = EXCLUDED.specialty, 
                insurances = EXCLUDED.insurances, 
                address = EXCLUDED.address,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, specialty, insurances, address]);
        res.status(200).json({ message: 'Configurações salvas com sucesso!', settings: result.rows[0] });
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});


app.get('/', (req, res) => { /* ...código existente... */ });

app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  initializeDatabase(); // Chama a nova função de inicialização
});
