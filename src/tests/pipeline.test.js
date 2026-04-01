/**
 * Testes para o pipeline de mensagens (debounce e processamento)
 */

describe('Debounce de mensagens WhatsApp', () => {
    // Simula a lógica de debounce sem o módulo real
    function createDebounceQueue(DEBOUNCE_MS = 100) {
        const queues = new Map();

        return function enqueue(phoneId, text, onProcess) {
            if (!queues.has(phoneId)) {
                queues.set(phoneId, { messages: [], timer: null });
            }
            const entry = queues.get(phoneId);
            entry.messages.push(text);

            if (entry.timer) clearTimeout(entry.timer);
            entry.timer = setTimeout(() => {
                const batch = entry.messages.join('\n');
                queues.delete(phoneId);
                onProcess(batch);
            }, DEBOUNCE_MS);
        };
    }

    test('mensagens rápidas são agrupadas em uma só', (done) => {
        const enqueue = createDebounceQueue(50);
        const results = [];

        enqueue('5511999990001', 'Oi', (batch) => results.push(batch));
        enqueue('5511999990001', 'queria saber sobre implante', (batch) => results.push(batch));
        enqueue('5511999990001', 'quanto custa?', (batch) => results.push(batch));

        setTimeout(() => {
            expect(results.length).toBe(1);
            expect(results[0]).toContain('Oi');
            expect(results[0]).toContain('implante');
            expect(results[0]).toContain('quanto custa?');
            done();
        }, 150);
    });

    test('mensagens de números diferentes são processadas separadas', (done) => {
        const enqueue = createDebounceQueue(50);
        const results = [];

        enqueue('5511000000001', 'Olá da pessoa A', (batch) => results.push({ id: 'A', batch }));
        enqueue('5511000000002', 'Olá da pessoa B', (batch) => results.push({ id: 'B', batch }));

        setTimeout(() => {
            expect(results.length).toBe(2);
            const ids = results.map(r => r.id).sort();
            expect(ids).toEqual(['A', 'B']);
            done();
        }, 150);
    });

    test('nova mensagem reinicia o timer', (done) => {
        const enqueue = createDebounceQueue(80);
        const processed = [];

        enqueue('5511111111111', 'msg 1', (b) => processed.push(b));

        setTimeout(() => {
            // Chega nova mensagem antes do timer disparar (40ms < 80ms)
            enqueue('5511111111111', 'msg 2', (b) => processed.push(b));
        }, 40);

        setTimeout(() => {
            // Nada deve ter sido processado ainda (timer foi reiniciado)
            expect(processed.length).toBe(0);
        }, 100);

        setTimeout(() => {
            // Agora sim, ambas as mensagens juntas
            expect(processed.length).toBe(1);
            expect(processed[0]).toContain('msg 1');
            expect(processed[0]).toContain('msg 2');
            done();
        }, 200);
    });
});

// ===================== TESTES DE formatação de resposta da IA =====================

describe('Parse da resposta JSON da IA', () => {
    function parseAIResponse(raw) {
        try {
            const parsed = JSON.parse(raw);
            return {
                respostaChat: parsed.resposta_chat || 'Desculpe, a conexão da clínica oscilou, pode repetir?',
                resumoCrm: parsed.resumo_crm || ''
            };
        } catch {
            return { respostaChat: raw, resumoCrm: '' };
        }
    }

    test('parse correto de JSON válido da IA', () => {
        const raw = JSON.stringify({
            resposta_chat: 'Olá! Como posso ajudar?',
            resumo_crm: 'Interesse em clareamento'
        });
        const result = parseAIResponse(raw);
        expect(result.respostaChat).toBe('Olá! Como posso ajudar?');
        expect(result.resumoCrm).toBe('Interesse em clareamento');
    });

    test('fallback quando IA retorna texto puro (não JSON)', () => {
        const raw = 'Olá, como posso ajudar você hoje?';
        const result = parseAIResponse(raw);
        expect(result.respostaChat).toBe(raw);
        expect(result.resumoCrm).toBe('');
    });

    test('usa mensagem padrão quando resposta_chat está vazia', () => {
        const raw = JSON.stringify({ resumo_crm: 'Algo errado' });
        const result = parseAIResponse(raw);
        expect(result.respostaChat).toBe('Desculpe, a conexão da clínica oscilou, pode repetir?');
    });
});
