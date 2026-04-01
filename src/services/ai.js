const Anthropic = require('@anthropic-ai/sdk');

if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no .env - a IA não pode funcionar sem ela.');
}
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU  = 'claude-haiku-4-5';    // Barato e rápido — WhatsApp e CRM
const SONNET = 'claude-sonnet-4-5';   // Qualidade  — Relatórios e Conteúdo

/**
 * Responde mensagens do WhatsApp via Claude Haiku com Prompt Caching.
 * Retorna objeto { resposta_chat, resumo_crm } já parseado.
 * @param {Array}  history      - Histórico de mensagens [{role, content}]
 * @param {string} systemPrompt - Prompt do sistema (será cacheado)
 * @returns {string} - Resposta em texto limpo para enviar ao paciente
 */
async function generateAIResponse(history, systemPrompt) {
    // Filtrar mensagens de sistema do histórico
    const filteredHistory = history.filter(m => m.role !== 'system');

    // Adicionar instrução de formato na última mensagem do usuário
    const messagesWithFormat = [...filteredHistory];
    const lastIdx = messagesWithFormat.length - 1;
    if (lastIdx >= 0 && messagesWithFormat[lastIdx].role === 'user') {
        messagesWithFormat[lastIdx] = {
            role: 'user',
            content: messagesWithFormat[lastIdx].content + '\n\n[SISTEMA: Responda a mensagem acima. Depois, na ÚLTIMA linha separada, escreva CRM: seguido de um resumo de 3-6 palavras sobre a intenção do paciente. Exemplo de formato:\n\nOi Maria! Claro, temos horário quinta de manhã. Quer que eu reserve pra você?\n\nCRM: quer agendar consulta quinta]'
        };
    }

    const response = await client.messages.create({
        model: HAIKU,
        max_tokens: 512,
        system: [
            {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' }
            }
        ],
        messages: messagesWithFormat,
    });

    return response.content[0]?.text || '';
}

/**
 * Extrai a mensagem limpa e o resumo CRM da resposta da IA.
 * @param {string} rawResponse - Resposta bruta da IA
 * @returns {{ resposta_chat: string, resumo_crm: string }}
 */
function parseAIResponse(rawResponse) {
    const text = rawResponse.trim();

    // Separar mensagem do CRM tag
    const crmMatch = text.match(/\n\s*CRM:\s*(.+)$/i);

    let resposta_chat = text;
    let resumo_crm = '';

    if (crmMatch) {
        resposta_chat = text.substring(0, crmMatch.index).trim();
        resumo_crm = crmMatch[1].trim();
    }

    // Fallback: tentar extrair JSON caso a IA ainda retorne JSON
    if (resposta_chat.includes('"resposta_chat"')) {
        try {
            const jsonMatch = resposta_chat.match(/\{[\s\S]*"resposta_chat"[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                resposta_chat = parsed.resposta_chat || resposta_chat;
                resumo_crm = parsed.resumo_crm || resumo_crm;
            }
        } catch (e) {
            // Se falhar, limpar JSON residual
            resposta_chat = resposta_chat
                .replace(/```json[\s\S]*?```/g, '')
                .replace(/\{[\s\S]*"resposta_chat"[\s\S]*\}/g, '')
                .trim();
        }
    }

    return { resposta_chat: resposta_chat || 'Desculpe, pode repetir?', resumo_crm };
}

/**
 * Gera conteúdo de alto valor usando Claude Sonnet (relatórios, legendas, análises).
 */
async function generateSonnetContent(systemPrompt, userPrompt) {
    const response = await client.messages.create({
        model: SONNET,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    });

    return response.content[0]?.text || '';
}

module.exports = { generateAIResponse, generateSonnetContent, parseAIResponse };
