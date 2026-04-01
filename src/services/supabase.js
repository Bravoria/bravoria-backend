const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias no .env - o servidor não pode iniciar sem elas.');
}

// Usando a Service Role Key para ter acesso total e ignorar o RLS do banco (Backend Admin)
const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = { supabase };
