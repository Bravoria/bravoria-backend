const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = 3001;

// !! IMPORTANTE: Substitua pela sua string de conexão do Neon !!
const connectionString = postgresql://neondb_owner:npg_crqWpEt0m4KT@ep-frosty-violet-aikb47ve-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require;

const pool = new Pool({
  connectionString: connectionString,
});

// Função para criar a tabela de usuários se ela não existir
async function createUsersTable() {
  const client = await pool.connect();
  try {
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
    console.error('Erro ao criar a tabela "users":', err);
  } finally {
    client.release();
  }
}

app.get('/', (req, res) => {
  res.send('Olá! Eu sou o backend da Bravor.ia. Estou funcionando!');
});

app.listen(port, () => {
  console.log(`Backend da Bravor.ia rodando na porta ${port}`);
  createUsersTable(); // Chama a função para criar a tabela ao iniciar
});
