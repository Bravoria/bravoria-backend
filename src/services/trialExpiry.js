const cron = require('node-cron');
const { supabase } = require('./supabase');

/**
 * Monitora trials e:
 * - Dia 6: avisa o dono da clínica via WhatsApp
 * - Dia 7+: suspende automaticamente
 */
function startTrialExpiryScheduler(sendMessage) {
    console.log('🎁 Trial Expiry scheduler iniciado (verifica diariamente às 9h)');

    // Verifica todo dia às 9h
    cron.schedule('0 9 * * *', async () => {
        await checkTrialExpirations(sendMessage);
    });
}

async function checkTrialExpirations(sendMessage) {
    try {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        // Busca todos os trials ativos
        const { data: trials, error } = await supabase
            .from('subscriptions')
            .select('clinic_id, trial_ends_at')
            .eq('status', 'trial');

        if (error || !trials?.length) return;

        for (const trial of trials) {
            const trialEnd = new Date(trial.trial_ends_at);
            const diffMs = trialEnd.getTime() - now.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);

            // Buscar dados da clínica
            const { data: settings } = await supabase
                .from('clinic_settings')
                .select('name, owner_phone')
                .eq('id', trial.clinic_id)
                .maybeSingle();

            if (!settings?.owner_phone) continue;

            // Aviso no dia 6 (entre 23h e 25h antes do fim)
            if (diffHours >= 23 && diffHours <= 25) {
                const msg = `⚠️ *Lumia — Aviso de Trial*\n\nOlá, ${settings.name}! Seu período de *7 dias grátis* termina amanhã.\n\nPara continuar recebendo pacientes automaticamente, assine o plano Premium agora!\n\n👉 Acesse lumia-ia.com.br/dashboard/conta`;
                await sendMessage(`${settings.owner_phone}@s.whatsapp.net`, msg);
                console.log(`⚠️ Aviso de trial enviado para ${settings.name}`);
            }

            // Expirado: suspender
            if (diffMs <= 0) {
                await supabase
                    .from('subscriptions')
                    .update({ status: 'trial_expired' })
                    .eq('clinic_id', trial.clinic_id);

                await supabase
                    .from('clinic_settings')
                    .update({ status: 'suspended' })
                    .eq('id', trial.clinic_id);

                const msg = `🔴 *Lumia — Trial Expirado*\n\nSeu período de teste da ${settings.name} encerrou hoje.\n\nPara reativar o atendimento automático: lumia-ia.com.br/dashboard/conta\n\nQualquer dúvida, responda aqui!`;
                await sendMessage(`${settings.owner_phone}@s.whatsapp.net`, msg);
                console.log(`🔴 Trial expirado e suspenso: ${settings.name}`);
            }
        }
    } catch (err) {
        console.error('❌ Erro no Trial Expiry scheduler:', err.message);
    }
}

module.exports = { startTrialExpiryScheduler };
