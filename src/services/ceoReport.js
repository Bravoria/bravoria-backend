const cron = require('node-cron');
const { supabase } = require('./supabase');
const { generateSonnetContent } = require('./ai');

/**
 * Inicia o agendador do Relatório CEO.
 * Dispara o envio todo domingo às 9h.
 * @param {Function} sendMessage - sendWhatsAppMessage(phoneId, text)
 * @param {string}   clinicId   - ID da clínica
 */
function startCeoReportScheduler(sendMessage, clinicId) {
    console.log('📊 Relatório CEO agendado para todo Domingo às 9h');

    // Cron: Domingo às 9h00 (horário do servidor)
    cron.schedule('0 9 * * 0', async () => {
        console.log('📊 Gerando Relatório CEO semanal...');
        await generateAndSendCeoReport(sendMessage, clinicId);
    });
}

async function generateAndSendCeoReport(sendMessage, clinicId) {
    try {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const today   = new Date().toISOString();

        // Coletar dados da semana em paralelo
        const [settingsRes, leadsRes, appointmentsRes, conversationsRes] = await Promise.all([
            supabase.from('clinic_settings').select('name, owner_phone, specialty').eq('id', clinicId).maybeSingle(),
            supabase.from('patients').select('id, status, notes, created_at').eq('clinic_id', clinicId).gte('created_at', weekAgo),
            supabase.from('appointments').select('id, status, type').eq('clinic_id', clinicId).gte('created_at', weekAgo),
            supabase.from('chat_logs').select('id, patient_id').gte('created_at', weekAgo)
        ]);

        const settings   = settingsRes.data;
        const leads      = leadsRes.data || [];
        const appts      = appointmentsRes.data || [];
        // Filtrar chat_logs apenas de pacientes desta clínica
        const patientIds = new Set(leads.map(l => l.id));
        const clinicLogs = (conversationsRes.data || []).filter(log => patientIds.has(log.patient_id));
        const convCount  = clinicLogs.length;

        if (!settings?.owner_phone) {
            console.warn('⚠️ CEO Report: owner_phone não configurado em clinic_settings.');
            return;
        }

        // Construir contexto analítico
        const agendados   = appts.filter(a => a.status === 'agendado' || a.status === 'confirmado').length;
        const cancelados  = appts.filter(a => a.status === 'cancelado').length;
        const interests   = leads.map(l => l.notes).filter(Boolean).join(', ');

        const dataContext = `
Clínica: ${settings.name || 'Clínica'}
Especialidade: ${settings.specialty || 'Odontologia'}

📊 DADOS DA SEMANA:
- Novos leads (contatos): ${leads.length}
- Total de mensagens processadas pela IA: ${convCount}
- Consultas agendadas: ${agendados}
- Consultas canceladas: ${cancelados}
- Taxa de conversão (leads → agendamentos): ${leads.length > 0 ? ((agendados / leads.length) * 100).toFixed(1) : 0}%
- Interesses mais mencionados pelos pacientes: ${interests || 'Variados'}
        `.trim();

        const systemPrompt = `Você é um analista de negócios especialista em clínicas odontológicas.
Gere um relatório semanal curto (máximo 10 linhas) e direto para o dono da clínica.
Tom: profissional mas acessível. Use emojis relevantes.
Estrutura: saudação breve → métricas-chave → 1 insight interessante → 1 sugestão de ação concreta.
NÃO use markdown pesado. Use formato WhatsApp (negrito com *asteriscos*).`;

        const report = await generateSonnetContent(systemPrompt, dataContext);

        const finalMsg = `📊 *Relatório Semanal — Lumia IA*\n\n${report}`;
        await sendMessage(`${settings.owner_phone}@s.whatsapp.net`, finalMsg);

        console.log(`✅ Relatório CEO enviado para ${settings.owner_phone}`);
    } catch (err) {
        console.error('❌ Erro ao gerar Relatório CEO:', err.message);
    }
}

// Permite forçar geração manual via API
module.exports = { startCeoReportScheduler, generateAndSendCeoReport };
