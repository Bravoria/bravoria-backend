// =================================================================
// BRAVOR.IA BACKEND - CÓDIGO MESTRE v1.4.2 (GARANTIA DE CORS)
// =================================================================

// --- 1. IMPORTAÇÕES ---
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors'); // Importa o CORS
const bcrypt = require('bcryptjs');
const twilio = require('twilio');

// --- 2. CONFIGURAÇÃO INICIAL DO APLICATIVO ---
const app = express();
const port = process.env.PORT || 3001;

// --- GARANTIA DE CORS ---
// Esta linha DEVE vir ANTES da definição de qualquer rota.
app.use(cors()); 

app.use(express.urlencoded({ extended: false })); 
app.use(express.json());

// ... (Resto do código, exatamente como na versão 1.4.1) ...
// (Configuração do Banco, Twilio, Inicialização do DB, Rotas, etc.)
// ...
