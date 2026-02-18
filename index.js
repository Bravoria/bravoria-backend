const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3001; // Render usa uma porta dinâmica

// CORREÇÃO: Lê a string de conexão da variável de ambiente
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Erro Crítico: A variável de ambiente DATABASE_URL não foi definida.');
  process.exit(1); // Encerra o processo se o banco de dados não estiver configurado
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false // Necessário para conexões com Neon/Render
  }
});

// Função para criar a tabela de usuários se ela não existir
async function createUsersTable() {
  let client; // Declarado fora do try para estar acessível no finally
  try {
    client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Tabela "users" verificada/criada com sucesso!');
  } catch (err) {
    console.error('Erro ao conectar ou criar a tabela "users":', err);
  } finally {
    if (client) {
      client.release(); // Garante que a conexão seja liberada
    }
  }
}

app.get('/', (req, res) => {
  res.send('Olá! Eu sou o backend da Bravor.ia. Estou funcionando e corrigido!');
});

app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  createUsersTable();
});
