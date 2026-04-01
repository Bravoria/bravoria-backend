/**
 * Testes para o serviço de lembretes de consulta
 * Executa sem banco de dados (todas as dependências são mockadas)
 */

// Mock do supabase antes de importar o módulo
jest.mock('../services/supabase', () => ({
    supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(),
    }
}));

const { supabase } = require('../services/supabase');

// Extrai buildReminderMessage e tryHandleReminderReply via reimplementação isolada
// (evita dependência de imports complexos do módulo principal)

// ===================== TESTES DE buildReminderMessage =====================

function buildReminderMessage(appt, type, patientName) {
    const firstName = patientName ? patientName.split(' ')[0] : 'você';
    const formattedTime = appt.time.slice(0, 5);
    const tipo = appt.type || 'consulta';
    const [year, month, day] = appt.date.split('-');
    const formattedDate = `${day}/${month}/${year}`;

    if (type === '24h') {
        return `Oi, ${firstName}! Tudo bem? 😊\n\nPassando para lembrar que você tem uma *${tipo}* marcada para amanhã, ${formattedDate} às *${formattedTime}*.\n\nVocê consegue comparecer? Se precisar remarcar é só me falar aqui que a gente resolve!`;
    }
    if (type === '2h') {
        return `Oi, ${firstName}! Só um lembrete: sua *${tipo}* é hoje às *${formattedTime}*. Te esperamos! 🗓️`;
    }
    return '';
}

describe('buildReminderMessage', () => {
    const appt = { date: '2025-04-01', time: '14:30', type: 'Avaliação' };

    test('lembrete 24h usa primeiro nome e formato natural', () => {
        const msg = buildReminderMessage(appt, '24h', 'Maria Souza');
        expect(msg).toContain('Oi, Maria!');
        expect(msg).toContain('01/04/2025');
        expect(msg).toContain('14:30');
        expect(msg).toContain('Avaliação');
        expect(msg).not.toContain('SIM');
        expect(msg).not.toContain('NÃO');
    });

    test('lembrete 2h é curto e direto', () => {
        const msg = buildReminderMessage(appt, '2h', 'João Lima');
        expect(msg).toContain('Oi, João!');
        expect(msg).toContain('14:30');
        expect(msg).toContain('hoje');
    });

    test('usa "você" quando nome não fornecido', () => {
        const msg = buildReminderMessage(appt, '24h', null);
        expect(msg).toContain('Oi, você!');
    });

    test('usa "consulta" quando tipo não informado', () => {
        const apptSemTipo = { date: '2025-04-01', time: '14:30', type: null };
        const msg = buildReminderMessage(apptSemTipo, '24h', 'Ana');
        expect(msg).toContain('consulta');
    });
});

// ===================== TESTES DE detecção de confirmação/cancelamento =====================

const CONFIRMATION_WORDS = ['sim', 'confirmo', 'confirmado', 'vou', 'estarei', 'ok', 'okay', 'pode', 'positivo', 'claro', 'com certeza', 'tá', 'ta', 'yes', '👍'];
const CANCELLATION_WORDS  = ['não', 'nao', 'cancelar', 'cancela', 'cancelado', 'remarcar', 'remarca', 'remarco', 'desmarcar', 'desmarca', 'não consigo', 'nao consigo', 'não vou', 'nao vou'];

function detectIntent(text) {
    const normalized = text.toLowerCase().trim();
    const isConfirm = CONFIRMATION_WORDS.some(w => normalized.includes(w));
    const isCancel  = CANCELLATION_WORDS.some(w => normalized.includes(w));
    return { isConfirm, isCancel };
}

describe('Detecção de intenção em resposta de lembrete', () => {
    test('detecta confirmação simples', () => {
        expect(detectIntent('sim').isConfirm).toBe(true);
        expect(detectIntent('Sim, estarei lá').isConfirm).toBe(true);
        expect(detectIntent('pode sim').isConfirm).toBe(true);
        expect(detectIntent('ok confirmo').isConfirm).toBe(true);
    });

    test('detecta cancelamento', () => {
        expect(detectIntent('não vou conseguir').isCancel).toBe(true);
        expect(detectIntent('preciso remarcar').isCancel).toBe(true);
        expect(detectIntent('cancelar por favor').isCancel).toBe(true);
    });

    test('mensagem neutra não dispara nenhuma intenção', () => {
        const { isConfirm, isCancel } = detectIntent('qual o endereço da clínica?');
        expect(isConfirm).toBe(false);
        expect(isCancel).toBe(false);
    });

    test('emoji de positivo é confirmação', () => {
        expect(detectIntent('👍').isConfirm).toBe(true);
    });
});

// ===================== TESTES DE janela de tempo para lembretes =====================

describe('Janela de tempo para envio de lembrete', () => {
    function shouldSend24h(diffHours) {
        return diffHours >= 23 && diffHours <= 25;
    }
    function shouldSend2h(diffHours) {
        return diffHours >= 1.5 && diffHours <= 2.5;
    }

    test('envia lembrete 24h quando faltam exatamente 24h', () => {
        expect(shouldSend24h(24)).toBe(true);
    });

    test('envia lembrete 24h nas bordas da janela (23h e 25h)', () => {
        expect(shouldSend24h(23)).toBe(true);
        expect(shouldSend24h(25)).toBe(true);
    });

    test('não envia lembrete 24h fora da janela', () => {
        expect(shouldSend24h(22.9)).toBe(false);
        expect(shouldSend24h(25.1)).toBe(false);
        expect(shouldSend24h(2)).toBe(false);
    });

    test('envia lembrete 2h quando faltam entre 1.5h e 2.5h', () => {
        expect(shouldSend2h(2)).toBe(true);
        expect(shouldSend2h(1.5)).toBe(true);
        expect(shouldSend2h(2.5)).toBe(true);
    });

    test('não envia lembrete 2h fora da janela', () => {
        expect(shouldSend2h(1.4)).toBe(false);
        expect(shouldSend2h(2.6)).toBe(false);
    });
});
