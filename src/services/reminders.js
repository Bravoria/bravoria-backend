const { supabase } = require('./supabase');

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // verifica a cada 5 minutos

/**
 * Inicia o agendador de lembretes de consulta.
 * @param {Function} sendMessage - função sendWhatsAppMessage(phoneId, text)
 * @param {string} clinicId - ID da clínica que este servidor serve
 */
function startReminderScheduler(sendMessage, clinicId) {
    console.log('⏰ Agendador de lembretes iniciado (verificação a cada 5 min)');
    checkAndSendReminders(sendMessage, clinicId);
    setInterval(() => checkAndSendReminders(sendMessage, clinicId), CHECK_INTERVAL_MS);
}

async function checkAndSendReminders(sendMessage, clinicId) {
    try {
        const now = new Date();

        // Janela de busca: consultas nas próximas 25 horas
        const windowStart = new Date(now.getTime());
        const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        const startDate = windowStart.toISOString().slice(0, 10);
        const endDate = windowEnd.toISOString().slice(0, 10);

        const { data: appointments, error } = await supabase
            .from('appointments')
            .select('id, patient_id, patient_name, date, time, type, reminders_sent')
            .eq('clinic_id', clinicId)
            .eq('status', 'agendado')
            .gte('date', startDate)
            .lte('date', endDate);

        if (error) {
            console.error('❌ Erro ao buscar consultas para lembretes:', error.message);
            return;
        }

        if (!appointments || appointments.length === 0) return;

        for (const appt of appointments) {
            await processRemindersForAppointment(appt, now, sendMessage, clinicId);
        }
    } catch (err) {
        console.error('❌ Erro no agendador de lembretes:', err.message);
    }
}

async function processRemindersForAppointment(appt, now, sendMessage, clinicId) {
    try {
        // Força horário de Brasília (UTC-3) para garantir que lembretes disparem correto
        const apptDateTime = new Date(`${appt.date}T${appt.time}:00-03:00`);
        const diffMs = apptDateTime.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        const remindersSent = appt.reminders_sent || {};
        const updates = {};

        // Lembrete de 24h: enviar quando faltam entre 23h e 25h
        if (diffHours >= 23 && diffHours <= 25 && !remindersSent['24h']) {
            const patient = await getPatientPhone(appt.patient_id, clinicId);
            if (patient?.phone) {
                const msg = buildReminderMessage(appt, '24h', patient.name);
                await sendMessage(`${patient.phone}@s.whatsapp.net`, msg);
                console.log(`📅 Lembrete 24h enviado para ${patient.name} (${appt.date} ${appt.time})`);
                updates['24h'] = true;
            }
        }

        // Lembrete de 2h: enviar quando faltam entre 1.5h e 2.5h
        if (diffHours >= 1.5 && diffHours <= 2.5 && !remindersSent['2h']) {
            const patient = await getPatientPhone(appt.patient_id, clinicId);
            if (patient?.phone) {
                const msg = buildReminderMessage(appt, '2h', patient.name);
                await sendMessage(`${patient.phone}@s.whatsapp.net`, msg);
                console.log(`📅 Lembrete 2h enviado para ${patient.name} (${appt.date} ${appt.time})`);
                updates['2h'] = true;
            }
        }

        // Salvar quais lembretes foram enviados
        if (Object.keys(updates).length > 0) {
            await supabase
                .from('appointments')
                .update({ reminders_sent: { ...remindersSent, ...updates } })
                .eq('id', appt.id);
        }
    } catch (err) {
        console.error(`❌ Erro ao processar lembrete da consulta ${appt.id}:`, err.message);
    }
}

async function getPatientPhone(patientId, clinicId) {
    if (!patientId) return null;
    const { data, error } = await supabase
        .from('patients')
        .select('name, phone')
        .eq('id', patientId)
        .eq('clinic_id', clinicId)
        .maybeSingle();
    if (error || !data?.phone) return null;
    return data;
}

function buildReminderMessage(appt, type, patientName) {
    const firstName = patientName ? patientName.split(' ')[0] : 'você';
    const formattedDate = formatDate(appt.date);
    const formattedTime = appt.time.slice(0, 5);
    const tipo = appt.type || 'consulta';

    if (type === '24h') {
        return `Oi, ${firstName}! Tudo bem? 😊\n\nPassando para lembrar que você tem uma *${tipo}* marcada para amanhã, ${formattedDate} às *${formattedTime}*.\n\nVocê consegue comparecer? Se precisar remarcar é só me falar aqui que a gente resolve!`;
    }

    if (type === '2h') {
        return `Oi, ${firstName}! Só um lembrete: sua *${tipo}* é hoje às *${formattedTime}*. Te esperamos! 🗓️`;
    }

    return '';
}

function formatDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

// Palavras que indicam confirmação de presença
const CONFIRMATION_WORDS = ['sim', 'confirmo', 'confirmado', 'vou', 'estarei', 'ok', 'okay', 'pode', 'positivo', 'claro', 'com certeza', 'tá', 'ta', 'yes', '👍'];
const CANCELLATION_WORDS  = ['não', 'nao', 'cancelar', 'cancela', 'cancelado', 'remarcar', 'remarca', 'remarco', 'desmarcar', 'desmarca', 'não consigo', 'nao consigo', 'não vou', 'nao vou'];

/**
 * Verifica se a mensagem do paciente é uma resposta a um lembrete de consulta.
 * Se for confirmação → atualiza status para 'confirmado' e retorna true.
 * Se for cancelamento → mantém 'agendado' (a IA vai conduzir o remarcar) e retorna false.
 * Retorna false se não for resposta a lembrete.
 */
async function tryHandleReminderReply(phoneNumber, text, clinicId) {
    const normalized = text.toLowerCase().trim();

    const isConfirm   = CONFIRMATION_WORDS.some(w => normalized.includes(w));
    const isCancel    = CANCELLATION_WORDS.some(w => normalized.includes(w));

    if (!isConfirm && !isCancel) return false;

    // Buscar consulta agendada nas próximas 48h para esse paciente
    const patient = await getPatientByPhone(phoneNumber, clinicId);
    if (!patient) return false;

    const now = new Date();
    const limit = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const startDate = now.toISOString().slice(0, 10);
    const endDate   = limit.toISOString().slice(0, 10);

    const { data: appts } = await supabase
        .from('appointments')
        .select('id, date, time, status')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patient.id)
        .eq('status', 'agendado')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .limit(1);

    if (!appts || appts.length === 0) return false;

    if (isConfirm && !isCancel) {
        await supabase
            .from('appointments')
            .update({ status: 'confirmado' })
            .eq('id', appts[0].id);
        console.log(`✅ Consulta ${appts[0].id} confirmada por ${patient.name} via WhatsApp`);
    }

    // Retorna true para ambos os casos — a IA ainda vai responder com naturalidade
    return true;
}

async function getPatientByPhone(phoneNumber, clinicId) {
    const { data } = await supabase
        .from('patients')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .eq('phone', phoneNumber)
        .maybeSingle();
    return data || null;
}

module.exports = { startReminderScheduler, tryHandleReminderReply };
