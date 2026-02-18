const express = require('express');
const { Pool } = require('pg');
const cors = require('cors'); // Importa o pacote CORS

const app = express();
const port = process.env.PORT || 3001;

app.use(cors()); // Habilita o CORS para todas as rotas
app.use(express.json()); // Habilita o backend a entender JSON

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Erro Crítico: A variável de ambiente DATABASE_URL não foi definida.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

async function createUsersTable() { /* ... (código da função continua o mesmo, não precisa mexer) ... */ }

app.get('/', (req, res) => {
  res.send('Olá! Eu sou o backend da Bravor.ia. Estou pronto para cadastrar usuários!');
});

// NOVA ROTA: /register
app.post('/register', async (req, res) => {
  const { fullName, email, password } = req.body;

  // Validação simples
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }

  // Futuramente, aqui vamos "hashear" a senha antes de salvar. Por agora, salvamos direto.
  const password_hash = password; // SIMPLIFICAÇÃO TEMPORÁRIA

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, created_at',
        [fullName, email, password_hash]
      );
      res.status(201).json(result.rows[0]); // Sucesso!
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23505') { // Código de erro para violação de chave única (email duplicado)
      return res.status(409).json({ message: 'Este e-mail já está em uso.' });
    }
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});


app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  // A função createUsersTable não precisa ser chamada aqui, pois a tabela já foi criada.
  // Mas podemos deixar para garantir.
  pool.connect().then(client => {
    client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `).then(() => {
      client.release();
      console.log('Tabela "users" verificada/criada com sucesso!');
    }).catch(err => {
      client.release();
      console.error('Erro ao criar a tabela "users":', err);
    });
  });
});
