const { OpenAI } = require('openai');
require('dotenv').config();

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no .env - o servidor não pode iniciar sem ela.');
}

const openai = new OpenAI({ apiKey });

/**
 * Função central para gerar a resposta da IA (O Cérebro da Lumia)
 * @param {Array} messages - O array de mensagens (histórico da conversa)
 * @param {String} systemPrompt - O prompt doutrinador (Regras da Clínica + FAQ)
 */
async function generateAIResponse(messages, systemPrompt) {
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4.1', // Model mais inteligente para os Agentes PhD
            temperature: 0.25, // Máxima humanização, menor chance de jargões robóticos repetitivos
            response_format: { type: "json_object" },
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages
            ]
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('❌ Erro na OpenAI:', error.message);
        return 'Oi! Desculpa a demora, a nossa internet deu uma oscilada feia aqui na clínica agorinha 😅 Pode me repetir o que você tinha falado?';
    }
}

module.exports = { openai, generateAIResponse };
