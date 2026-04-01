const { supabase } = require('./supabase');
const { generateAIResponse, parseAIResponse } = require('./ai');

/**
 * Pipeline de vendas da Bravor.ia.
 * Processa mensagens recebidas no número comercial,
 * qualifica leads (donos de clínica) e salva em sales_leads.
 */
async function handleSalesMessage(msgObj, sendMessage) {
    const { phoneId, phoneNumber, text, pushName } = msgObj;

    try {
        console.log(`\n💼 [SALES] Mensagem de ${pushName} (${phoneNumber}): "${text}"`);

        // 1. Buscar ou criar lead
        let { data: lead } = await supabase
            .from('sales_leads')
            .select('id, name, stage, messages, ai_summary, interest')
            .eq('phone', phoneNumber)
            .maybeSingle();

        if (!lead) {
            const { data: newLead } = await supabase
                .from('sales_leads')
                .insert({
                    phone: phoneNumber,
                    name: pushName || 'Lead Sem Nome',
                    stage: 'novo',
                    messages: [],
                    created_at: new Date().toISOString()
                })
                .select()
                .single();
            lead = newLead || { id: 'fallback', name: pushName || 'Lead Sem Nome', stage: 'novo', messages: [] };
        }

        // 2. Histórico de mensagens do lead (últimas 6 interações)
        const history = [];
        const msgs = Array.isArray(lead.messages) ? lead.messages.slice(-6) : [];
        msgs.forEach(m => {
            history.push({ role: 'user', content: m.user });
            history.push({ role: 'assistant', content: m.bot });
        });
        history.push({ role: 'user', content: text });

        // 3. System prompt: qualificadora de leads B2B
        const primeiroNome = lead.name ? lead.name.split(' ')[0] : '';
        const systemPrompt = `Você é Lumia, consultora de vendas da Bravor.ia — empresa de IA para clínicas odontológicas do Brasil.

═══ MISSÃO ═══
Qualificar donos/gerentes de clínicas odontológicas para uma demonstração com o fundador Matheus.
Meta: descobrir o perfil da clínica, a dor principal, e propor a demo pessoal.

═══ SOBRE A BRAVOR.IA / LUMIA ═══
Bravor.ia é uma plataforma de IA que automatiza o atendimento de clínicas pelo WhatsApp 24/7.
- Responde pacientes automaticamente (dia e noite, finais de semana)
- Agenda consultas sem secretária
- Envia lembretes automáticos reduzindo no-show em até 40%
- Relatórios semanais para o dono (CEO Virtual)
- Trial de 7 dias gratuito
Preço: a partir de R$297/mês

═══ ESTILO DE COMUNICAÇÃO ═══
- Mensagens CURTAS: máx 3 linhas. WhatsApp, não e-mail.
- Tom: profissional e consultivo. Você fala com empresários ocupados.
- Não seja vendedora agressiva. Seja consultora curiosa.
- Use o nome "${primeiroNome}" naturalmente.
- 1 emoji no máximo por mensagem.

═══ FLUXO DE QUALIFICAÇÃO ═══
Siga este funil naturalmente ao longo da conversa:
1. ENTENDER → Quantos pacientes/mês? Quantas secretárias? Perde leads fora do horário?
2. APRESENTAR → Mostre como Lumia resolve a dor específica mencionada
3. PROPOR DEMO → "Posso agendar 20 min com o Matheus (nosso fundador) pra te mostrar ao vivo. Quando seria melhor?"

═══ REGRAS ═══
- NUNCA invente preços específicos — diga "a partir de R$297/mês, mas depende do plano"
- Se perguntar funcionalidades técnicas → "Na demo o Matheus mostra tudo ao vivo!"
- Se pedir desconto → "Temos trial de 7 dias grátis, você testa sem pagar nada primeiro"
- Se já for cliente → redirecione para suporte: "Para suporte me fala pelo canal principal!"
- NUNCA diga que é IA ou robô

═══ LEAD ATUAL ═══
Nome: ${primeiroNome || 'Não informado'}
Estágio: ${lead.stage || 'novo'}
Interesse: ${lead.interest || 'Não identificado ainda'}
Resumo anterior: ${lead.ai_summary || 'Primeiro contato'}

═══ FORMATO DE RESPOSTA ═══
Responda em texto puro para o WhatsApp.
Na última linha, escreva: CRM: [resumo em 1 linha do perfil/interesse do lead] | STAGE: [novo|qualificado|demo_agendada|fechado|perdido]`;

        // 4. Gerar resposta
        console.log(`   └─ 🧠 [SALES] Claude Haiku processando...`);
        const rawResponse = await generateAIResponse(history, systemPrompt);

        // 5. Parse da resposta (texto + CRM)
        const chatResponse = parseSalesResponse(rawResponse);
        console.log(`   └─ 💬 [SALES] Resposta: "${chatResponse.text.substring(0, 80)}..."`);
        console.log(`   └─ 📋 [SALES] CRM: "${chatResponse.crm}" | Stage: "${chatResponse.stage}"`);

        // 6. Salvar mensagem no histórico
        const updatedMessages = [
            ...(Array.isArray(lead.messages) ? lead.messages : []),
            { user: text, bot: chatResponse.text, ts: new Date().toISOString() }
        ];

        // 7. Atualizar lead no Supabase
        if (lead.id !== 'fallback') {
            const updateData = {
                messages: updatedMessages,
                updated_at: new Date().toISOString()
            };
            if (chatResponse.crm) updateData.ai_summary = chatResponse.crm;
            if (chatResponse.stage) updateData.stage = chatResponse.stage;
            if (lead.name === 'Lead Sem Nome' && pushName) updateData.name = pushName;

            await supabase.from('sales_leads').update(updateData).eq('id', lead.id);
        }

        // 8. Enviar resposta
        await sendMessage(phoneId, chatResponse.text);
        console.log(`✅ [SALES] Ciclo completo!\n`);

    } catch (err) {
        console.error('❌ [SALES] Erro no pipeline:', err.message);
    }
}

/**
 * Parse da resposta do Claude para separar texto do chat, CRM e stage
 */
function parseSalesResponse(raw) {
    const lines = raw.trim().split('\n');
    const crmLine = lines.findLast(l => l.trim().toUpperCase().startsWith('CRM:'));

    let text = raw.trim();
    let crm = '';
    let stage = '';

    if (crmLine) {
        // Remove a linha CRM do texto
        text = lines.filter(l => !l.trim().toUpperCase().startsWith('CRM:')).join('\n').trim();

        // Extrai CRM e STAGE
        const stageMatch = crmLine.match(/STAGE:\s*(\w+)/i);
        stage = stageMatch ? stageMatch[1].toLowerCase() : '';
        crm = crmLine.replace(/CRM:\s*/i, '').replace(/\|\s*STAGE:\s*\w+/i, '').trim();
    }

    // Fallback: se ainda tem JSON/tags do parseAIResponse, usa esse
    if (!text || text.length < 5) {
        const parsed = parseAIResponse(raw);
        text = parsed.resposta_chat || raw;
    }

    return { text, crm, stage };
}

module.exports = { handleSalesMessage };
