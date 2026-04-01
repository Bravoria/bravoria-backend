require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Monitoramento de erros (Sentry) — opcional, não bloqueia se DSN não configurado
let Sentry = null;
if (process.env.SENTRY_DSN) {
    Sentry = require('@sentry/node');
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'production',
        tracesSampleRate: 0.1, // 10% das transações para não explodir a cota free
    });
    console.log('🔍 Sentry monitoramento de erros ativo.');
}

// Importação dos serviços vitais
const { initWhatsAppEngine, sendWhatsAppMessage, getWhatsAppStatus, disconnectWhatsApp } = require('./services/whatsapp');
const { generateAIResponse, generateSonnetContent, parseAIResponse } = require('./services/ai');
const { supabase } = require('./services/supabase');
const { startReminderScheduler, tryHandleReminderReply } = require('./services/reminders');
const { startFollowupScheduler } = require('./services/followup');
const { startCeoReportScheduler, generateAndSendCeoReport } = require('./services/ceoReport');
const { startTrialExpiryScheduler } = require('./services/trialExpiry');
const { generateInstagramCaptions } = require('./services/contentGen');
const { generateMonthlyPDF } = require('./services/pdfReport');
const { initSalesWhatsApp, sendSalesMessage } = require('./services/salesWhatsapp');
const { handleSalesMessage } = require('./services/salesEngine');
const salesRoutes = require('./routes/salesRoutes');

if (!process.env.CLINIC_ID) {
    throw new Error('CLINIC_ID não configurado no .env - defina o ID da clínica que este servidor serve.');
}
if (!process.env.ENGINE_SECRET) {
    throw new Error('ENGINE_SECRET não configurado no .env - defina uma senha secreta compartilhada com o frontend.');
}
const CLINIC_ID = process.env.CLINIC_ID;

const app = express();
app.use(cors({
    origin: ['https://lumia-ai.com.br', 'https://www.lumia-ai.com.br', 'https://lumia-web.vercel.app', 'http://localhost:5173'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true
}));
app.use(express.json());

// ==========================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ==========================================
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${process.env.ENGINE_SECRET}`) {
        return res.status(401).json({ success: false, error: 'Não autorizado.' });
    }
    next();
}

app.get('/', (req, res) => {
    res.send({ status: 'LumiaOS Core Engine (Baileys) 🧠 Operante', version: '2.0.0' });
});

// Rotas comerciais (pipeline de vendas Bravor.ia)
app.use('/api/sales', requireAuth, salesRoutes);

// ==========================================
// API REST PARA O FRONTEND (SVELTE)
// ==========================================
// ==========================================
// ENDPOINTS - WHATSAPP
// ==========================================
app.get('/api/whatsapp/status', requireAuth, (req, res) => {
    const status = getWhatsAppStatus();
    res.json({ success: true, data: status });
});

app.post('/api/whatsapp/disconnect', requireAuth, async (req, res) => {
    await disconnectWhatsApp();
    res.json({ success: true, message: 'Desconectado com sucesso' });
});

// ==========================================
// ENDPOINT - GERAÇÃO DE RELATÓRIO PDF
// ==========================================
app.get('/api/reports/pdf', requireAuth, async (req, res) => {
    try {
        const targetClinic = req.query.clinicId || CLINIC_ID;
        const filePath = await generateMonthlyPDF(targetClinic);
        if (!filePath) {
            return res.status(500).json({ success: false, error: 'Erro ao gerar PDF' });
        }
        res.download(filePath, `Bravoria_Report_${Date.now()}.pdf`, (err) => {
            if (err) console.error('Erro ao enviar PDF:', err);
            // Optionally remove the file after download
            // fs.unlinkSync(filePath);
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// ENDPOINT - GERAÇÃO DE CONTEÚDO INSTAGRAM
// ==========================================
app.post('/api/content/generate', requireAuth, async (req, res) => {
    try {
        const { clinicId: reqClinicId, topic } = req.body;
        const cId = reqClinicId || CLINIC_ID;

        const { data: settings } = await supabase
            .from('clinic_settings')
            .select('name, specialty, tone')
            .eq('id', cId)
            .maybeSingle();

        const captions = await generateInstagramCaptions({
            name: settings?.name,
            specialty: settings?.specialty,
            tone: settings?.tone,
            topic
        });

        res.json({ success: true, data: captions });
    } catch (e) {
        console.error('❌ Erro ao gerar conteúdo:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// ENDPOINT - RELATÓRIO CEO MANUAL
// ==========================================
app.post('/api/ceo/report', requireAuth, async (req, res) => {
    try {
        await generateAndSendCeoReport(sendWhatsAppMessage, CLINIC_ID);
        res.json({ success: true, message: 'Relatório CEO enviado via WhatsApp.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// ENDPOINT - FAQ PENDENTES
// ==========================================
app.get('/api/faq/pending', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('pending_faqs')
            .select('*')
            .eq('clinic_id', CLINIC_ID)
            .eq('resolved', false)
            .order('created_at', { ascending: false })
            .limit(30);
        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/faq/approve', requireAuth, async (req, res) => {
    try {
        const { pendingId, answer } = req.body;
        if (!pendingId || !answer) return res.status(400).json({ success: false, error: 'pendingId e answer são obrigatórios.' });

        const { data: pending } = await supabase.from('pending_faqs').select('question, clinic_id').eq('id', pendingId).maybeSingle();
        if (!pending) return res.status(404).json({ success: false, error: 'FAQ pendente não encontrado.' });

        // Adicionar ao FAQ oficial
        await supabase.from('faq_items').insert({ clinic_id: pending.clinic_id, question: pending.question, answer });
        // Marcar como resolvido
        await supabase.from('pending_faqs').update({ resolved: true }).eq('id', pendingId);

        res.json({ success: true, message: 'Adicionado ao FAQ com sucesso.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/whatsapp/conversations', requireAuth, async (req, res) => {
    try {
        // Busca pacientes agrupados pelas últimas interações. Simplificado buscando os últimos que têm log.
        // Simulando listagem dos 'chats recentes'. Em caso de produção avançada faz-se um raw query via Postgres RPC.
        const { data: patients, error } = await supabase
            .from('patients')
            .select(`
                id, name, phone, status,
                chat_logs ( id, user_message, ai_message, created_at )
            `)
            .order('created_at', { referencedTable: 'chat_logs', ascending: false })
            .limit(10, { referencedTable: 'chat_logs' })
            .order('created_at', { ascending: false })
            .limit(30);

        if (error) throw error;

        // Pós processar
        const sorted = patients.filter(p => p.chat_logs && p.chat_logs.length > 0)
            .map(p => {
                // pegar o último log
                const lastLog = p.chat_logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                return {
                    id: p.id,
                    name: p.name,
                    phone: p.phone,
                    status: p.status,
                    lastMessage: lastLog ? (lastLog.user_message || lastLog.ai_message) : '',
                    lastMessageTime: lastLog ? lastLog.created_at : null
                }
            }).sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

        res.json({ success: true, data: sorted });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/whatsapp/messages/:patientId', requireAuth, async (req, res) => {
    try {
        const { patientId } = req.params;
        const { data, error } = await supabase
            .from('chat_logs')
            .select('id, patient_id, user_message, ai_message, created_at')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: true })
            .limit(100);

        if (error) throw error;
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// PIPELINE COGNITIVO (O CEREBRO DO AGENTE)
// ==========================================
async function handleIncomingMessage(msgObj) {
    const { phoneId, phoneNumber, text, pushName } = msgObj;

    const clinicId = CLINIC_ID;

    try {
        console.log(`\n📨 Mensagem de ${pushName} (${phoneNumber}): "${text}"`);
        let patientLog = ``;

        // 1. Tentar achar paciente no Supabase
        let { data: patient } = await supabase
            .from('patients')
            .select('id, name, status, created_at, lgpd_consent')
            .eq('clinic_id', clinicId)
            .eq('phone', phoneNumber)
            .maybeSingle();

        if (!patient) {
            patientLog = `Novo Lead Cadastrado`;
            const { data: newPatient, error: insertErr } = await supabase
                .from('patients')
                .insert({
                    clinic_id: clinicId,
                    name: pushName || 'Lead Sem Nome',
                    phone: phoneNumber,
                    lgpd_consent: false,
                    lgpd_consent_date: null
                })
                .select('id, name, created_at')
                .single();

            if (insertErr) {
                console.error('⚠️ Erro ao inserir paciente no Supabase:', insertErr);
            }

            // Fallback imediato se o banco falhar, para a IA poder responder!
            patient = newPatient || { id: 'fallback-id', name: pushName || 'Lead Sem Nome', status: 'Lead' };
        } else {
            patientLog = `Paciente Existente (${patient.status || 'Cadastrado'})`;
        }
        console.log(`   └─ CRM: ${patientLog}`);

        // 1.5 Verificar se é resposta a um lembrete de consulta
        const isReminderReply = await tryHandleReminderReply(phoneNumber, text, clinicId);

        // 2. Montar Contexto (RAG)
        const { data: settings } = await supabase.from('clinic_settings').select('name, specialty, tone, ai_rules, agent_name').eq('id', clinicId).maybeSingle();
        const { data: faqs } = await supabase.from('faq_items').select('question, answer').eq('clinic_id', clinicId);
        const { data: trainingRules } = await supabase.from('training_rules').select('category, rule_text').eq('clinic_id', clinicId);

        const agentName = settings?.agent_name || 'Lumia';

        // Detectar primeiro contato para LGPD
        const isFirstContact = !patient.lgpd_consent && patient.id !== 'fallback-id';

        const primeiroNome = patient.name ? patient.name.split(' ')[0] : '';

        let systemPrompt = `Você é ${agentName}, recepcionista da ${settings?.name || 'Clínica'}. Atende pacientes pelo WhatsApp.

═══ IDENTIDADE ═══
Você é a melhor recepcionista do Brasil. Carismática, resolutiva, empática. Pessoas confiam em você instintivamente porque você transmite segurança e cuidado genuíno. Você conhece cada detalhe da clínica de cor.
- NUNCA revele que é IA, chatbot ou assistente virtual. Você é uma pessoa real da equipe.
- Seu nome é ${agentName}. Você trabalha na recepção da clínica há anos.

═══ ESTILO DE COMUNICAÇÃO ═══
- Mensagens CURTAS: 1-3 linhas. WhatsApp não é e-mail. Menos é mais.
- Máximo 1 emoji por mensagem. Use só quando natural (nunca forçado).
- Tom: amiga profissional. Confiante sem ser arrogante. Acolhedora sem ser melosa.
- ${primeiroNome ? `Chame de "${primeiroNome}"` : 'Se não souber o nome, pergunte naturalmente: "Me diz seu nome pra eu te chamar direitinho?"'}
- Trate por "você". Mude para "senhor/senhora" APENAS se o paciente usar.
- PROIBIDO: "Posso ajudar em algo mais?", "Fico à disposição", "Estou aqui para o que precisar" — frases genéricas de robô.

═══ MÉTODO DE ATENDIMENTO (PHD) ═══
Siga este fluxo mental em cada mensagem:

1. ESPELHAR → Demonstre que entendeu o que a pessoa disse/sentiu
2. RESOLVER → Responda a dúvida com informação concreta do FAQ
3. AVANÇAR → Faça UMA pergunta que leve ao próximo passo (agendamento)

Exemplo real:
Paciente: "Quanto custa um clareamento?"
Ruim: "Os valores variam! Posso ajudar em algo mais?"
Bom: "O clareamento aqui fica em X reais. Quer marcar uma avaliação pra doutora montar seu plano? Tem horário essa semana ainda!"

═══ TÉCNICAS AVANÇADAS ═══
- ESCASSEZ NATURAL: "Essa semana ainda tem horário na quinta" (nunca "estamos lotados")
- PROVA SOCIAL SUTIL: "Muita gente que fez esse procedimento ama o resultado"
- RECIPROCIDADE: Dê uma dica útil antes de pedir o agendamento
- COMPROMISSO PROGRESSIVO: Não peça o agendamento direto. Primeiro: "Qual dia da semana é melhor pra você?" → depois: "Manhã ou tarde?" → depois: "Perfeito, marquei pra quinta às 10h!"
- REFRAME DE PREÇO: Se achar caro → "É um investimento na sua saúde. E dividimos em até X vezes!"

═══ REGRAS ABSOLUTAS ═══
- NUNCA invente informações (preço, horário, procedimento) que não estejam no FAQ
- NUNCA faça diagnóstico ou opine sobre tratamentos médicos
- NUNCA demonstre limitação: nada de "não tenho essa informação", "sou apenas", "informações limitadas"
- Se não souber algo específico → redirecione com confiança:
  • Preço: "Depende do seu caso! Na avaliação a doutora já te passa o valor certinho. Quer marcar?"
  • Horário: "Vou verificar a agenda e te mando os horários disponíveis!"
  • Procedimento: "A gente faz sim! Quer saber mais detalhes? Na avaliação a doutora explica tudo"
- Saudação APENAS na PRIMEIRA mensagem. Nas seguintes, vá direto ao ponto.
- Se o FAQ estiver vazio → "Trabalhamos com vários procedimentos! Me conta o que você tá precisando que te direciono certinho"

═══ SITUAÇÕES ESPECIAIS ═══
${isFirstContact ? `🆕 PRIMEIRO CONTATO: Na saudação, inclua naturalmente: "Ah, só te avisando que ao conversar aqui você concorda em receber nossas mensagens pelo WhatsApp. Se quiser parar é só me avisar!"
` : ''}${isReminderReply ? `📅 RESPOSTA A LEMBRETE:
- Confirmou → "Show, confirmado! Te espero [dia]. Qualquer coisa me chama!"
- Cancelar → "Sem problema! Quer remarcar pra outro dia? Qual seria melhor pra você?"
- Remarcar → "Claro! Qual dia e horário ficam melhor?"
` : ''}🚨 DOR/URGÊNCIA: Se relatar dor forte, inchaço, sangramento → "Isso precisa de atenção! Consegue vir hoje? Vou encaixar você. Se não conseguir, procure o pronto-socorro mais próximo"
😤 IRRITAÇÃO: Se irritado → "Entendo total sua frustração, ${primeiroNome || 'desculpe'}. Vou pedir pra nossa coordenadora te ligar pessoalmente pra resolver, tudo bem?"
💰 PREÇO NÃO LISTADO: "O valor varia conforme cada caso. Agenda uma avaliação rápida que a doutora já te passa o valor exato! Sem compromisso"
🔄 PACIENTE SUMIU (não responde há mensagens): Não pressione. Seja leve: "E aí, conseguiu pensar sobre a consulta? Semana que vem tem horários bons!"

═══ CONTEXTO DA CLÍNICA ═══
Nome: ${settings?.name || 'Clínica'}
Especialidade: ${settings?.specialty || 'Saúde'}
${settings?.ai_rules ? `Instruções do dono: ${settings.ai_rules}` : ''}

═══ PACIENTE ═══
Nome: ${primeiroNome || 'Ainda não informado'}
Status: ${patient.status || 'Novo Lead'}

═══ FAQ E CONHECIMENTO ═══\n`;
        if (faqs) faqs.forEach(f => { systemPrompt += `Pergunta Comum: ${f.question} \nSua Resposta Base: ${f.answer} \n\n`; });

        // Injetar regras do Agente Treinador
        if (trainingRules && trainingRules.length > 0) {
            systemPrompt += `\n🎓 TREINAMENTO PERSONALIZADO(Regras aprendidas com o dono da clínica) \n`;
            trainingRules.forEach(r => { systemPrompt += `- [${r.category?.toUpperCase()}]: ${r.rule_text} \n`; });
        }

        // 3. Montar Histórico (Últimas 4 interações)
        const { data: logs } = await supabase.from('chat_logs')
            .select('user_message, ai_message')
            .eq('patient_id', patient.id)
            .order('created_at', { ascending: false }).limit(4);

        const history = [];
        if (logs) {
            logs.reverse().forEach(log => {
                history.push({ role: 'user', content: log.user_message });
                history.push({ role: 'assistant', content: log.ai_message });
            });
        }

        history.push({ role: 'user', content: text });

        // 4. Claude Haiku processando com Prompt Caching
        console.log(`   └─ 🧠 Claude Haiku processando...`);
        const aiRawResponse = await generateAIResponse(history, systemPrompt);

        const { resposta_chat: respostaChat, resumo_crm: resumoCrm } = parseAIResponse(aiRawResponse);
        console.log(`   └─ 💬 Resposta: "${respostaChat.substring(0, 80)}..."`);
        console.log(`   └─ 📋 CRM: "${resumoCrm}"`);

        // 4.5 Salvar Resumo Analítico no CRM, caso o Lead não seja fallback
        if (resumoCrm && patient.id !== 'fallback-id') {
            const updateData = { notes: resumoCrm };
            // Marcar LGPD consent ao responder (paciente aceitou ao continuar conversa)
            if (isFirstContact) {
                updateData.lgpd_consent = true;
                updateData.lgpd_consent_date = new Date().toISOString();
            }
            await supabase.from('patients').update(updateData).eq('id', patient.id);
            console.log(`   └─ 📝 Nota de CRM da IA: [${resumoCrm}]`);
        }

        // 4.6 FAQ Auto-Aprendiz: detectar se IA não soube responder
        const UNCERTAINTY_PHRASES = ['vou verificar', 'não tenho essa informação', 'nossa equipe', 'não posso confirmar', 'verificar com'];
        const didntKnow = UNCERTAINTY_PHRASES.some(p => respostaChat.toLowerCase().includes(p));
        if (didntKnow && patient.id !== 'fallback-id') {
            await supabase.from('pending_faqs').insert({
                clinic_id: clinicId,
                question: text,
                patient_id: patient.id,
                resolved: false
            }).catch(() => {}); // Não bloquear o fluxo se a tabela não existir
            console.log(`   └─ ❓ FAQ pendente registrado: "${text.substring(0, 60)}"`);
        }

        // 5. Salvar Log
        await supabase.from('chat_logs').insert({ patient_id: patient.id, user_message: text, ai_message: respostaChat });

        // 6. Devolver via Baileys
        console.log(`   └─ 📤 Disparando resposta final...`);
        await sendWhatsAppMessage(phoneId, respostaChat);
        console.log(`✅ Ciclo Completo com Sucesso!\n`);

    } catch (err) {
        console.error('❌ Erro Fatal no Pipeline AI:', err);
        if (Sentry) Sentry.captureException(err, { extra: { phoneNumber, pushName } });
    }
}

// ==========================================
// STARTUP DA MÁQUINA
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀[LumiaOS AI Engine v3.0 - Claude Edition] Porta ${PORT}`);

    // Motor WhatsApp (clínicas) — inicia em background, não bloqueia
    if (process.env.CLINIC_WHATSAPP_ENABLED !== 'false') {
        initWhatsAppEngine(handleIncomingMessage).catch(e => console.error('❌ Erro motor principal:', e));
    }

    // Motor WhatsApp Comercial (vendas Bravor.ia) — inicia em paralelo se SALES_ENABLED=true
    if (process.env.SALES_ENABLED === 'true') {
        initSalesWhatsApp((msgObj) => handleSalesMessage(msgObj, sendSalesMessage))
            .then(() => console.log('💼 Motor comercial (vendas) iniciado.'))
            .catch(e => console.error('❌ Erro motor comercial:', e));
    }

    // Schedulers de automação
    startReminderScheduler(sendWhatsAppMessage, CLINIC_ID);   // Anti-falta
    startFollowupScheduler(sendWhatsAppMessage, CLINIC_ID);    // Follow-up de leads
    startCeoReportScheduler(sendWhatsAppMessage, CLINIC_ID);   // Relatório CEO domingo 9h
    startTrialExpiryScheduler(sendWhatsAppMessage);             // Expiração de trials

    console.log('✅ Todos os schedulers de automação iniciados.');
});
