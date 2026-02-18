const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // Nova biblioteca para senhas seguras

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Erro Crítico: A variável de ambiente DATABASE_URL não foi definida.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

// ROTA DE CADASTRO - AGORA COM SENHA SEGURA
app.post('/register', async (req, res) => {
  const { fullName, email, password } = req.body;
  if (!fullName || !email || !password) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt); // Criptografa a senha

    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email, full_name',
      [fullName, email, password_hash]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Este e-mail já está em uso.' });
    }
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

// NOVA ROTA DE LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ message: 'Senha incorreta.' });
        }

        // Login bem-sucedido!
        res.status(200).json({
            message: 'Login bem-sucedido!',
            user: {
                id: user.id,
                fullName: user.full_name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor.' });
    }
});

app.get('/', (req, res) => {
  res.send('Backend da Bravor.ia v2: Pronto para login!');
});

app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
});
