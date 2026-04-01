const { supabase } = require('./supabase');
const { generateAIResponse, parseAIResponse } = require('./ai');

const FOLLOWUP_INTERVAL_MS = 60 * 60 * 1000; // Verifica a cada 1 hora

/**
 * Inicia o agendador de follow-up de leads sem resposta.
 * @param {Function} sendMessage - função sendWhatsAppMessage(phoneId, text)
 * @param {string}   clinicId   - ID da clínica
 */
function startFollowupScheduler(sendMessage, clinicId) {
    console.log('🔁 Follow-up de Leads iniciado (verificação a cada 1h)');
    checkAndSendFollowups(sendMessage, clinicId);
    setInterval(() => checkAndSendFollowups(sendMessage, clinicId), FOLLOWUP_INTERVAL_MS);
}

async function checkAndSendFollowups(sendMessage, clinicId) {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // Busca pacientes que:
        // 1. Estão no status Lead (ainda não agendaram)
        // 2. Foram criados há mais de 24h (dando tempo de responder)
        // 3. Têm telefone cadastrado
        const { data: patients, error } = await supabase
            .from('patients')
            .select('id, name, phone, notes, followup_sent_at')
            .eq('clinic_id', clinicId)
            .eq('status', 'Lead')
            .lt('created_at', cutoff)
            .not('phone', 'is', null)
            .limit(10);

        if (error) {
            console.error('❌ Follow-up: erro ao buscar leads:', error.message);
            return;
        }

        // Filtrar localmente quem já recebeu follow-up (evita erro se coluna não existir)
        const eligible = (patients || []).filter(p => !p.followup_sent_at);

        if (eligible.length === 0) return;

        console.log(`🔁 Follow-up: ${eligible.length} lead(s) sem resposta há 24h`);

        for (const patient of eligible) {
            await sendFollowup(patient, sendMessage, clinicId);
        }
    } catch (err) {
        console.error('❌ Erro no follow-up scheduler:', err.message);
    }
}

async function sendFollowup(patient, sendMessage, clinicId) {
    try {
        const firstName = patient.name ? patient.name.split(' ')[0] : 'você';
        const interest  = patient.notes ? ` sobre ${patient.notes}` : '';

        // Gera mensagem personalizada com Haiku (simples, direta)
        const systemPrompt = `Você é um assistente simpático de uma clínica odontológica.
Crie UMA mensagem de follow-up curta (max 2 linhas) e natural para ${firstName}.
NÃO use saudação "Oi" seguida de nome. Vá direto ao ponto.
Mencione sutilmente o interesse detectado: "${interest || 'tratamento odontológico'}".
Ofereça ajuda de forma leve, sem forçar agendamento.
Retorne APENAS o texto da mensagem, sem aspas.`;

        const rawMsg = await generateAIResponse(
            [{ role: 'user', content: `Gere um follow-up para ${firstName}${interest}.` }],
            systemPrompt
        );

        const { resposta_chat } = parseAIResponse(rawMsg);
        const cleanMsg = resposta_chat.trim();
        if (!cleanMsg) return;

        await sendMessage(`${patient.phone}@s.whatsapp.net`, cleanMsg);

        // Marcar que o follow-up foi enviado para não reenviar
        await supabase
            .from('patients')
            .update({ followup_sent_at: new Date().toISOString() })
            .eq('id', patient.id);

        console.log(`🔁 Follow-up enviado para ${patient.name}: "${cleanMsg.substring(0, 60)}..."`);
    } catch (err) {
        console.error(`❌ Follow-up falhou para ${patient.name}:`, err.message);
    }
}

module.exports = { startFollowupScheduler };
