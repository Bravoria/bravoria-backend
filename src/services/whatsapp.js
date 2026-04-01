const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

let sock = null; // Instância global do socket
let currentQR = null;
let currentStatus = 'disconnected'; // qr_ready, connecting, online, disconnected
let sessionStats = { msgs: 0, leads: 0, appointments: 0 };
let reconnectAttempts = 0;

// Debounce: acumula mensagens rápidas do mesmo contato e processa juntas
// Ex: paciente manda "Oi" e logo "queria saber sobre implante" → IA recebe as duas de uma vez
const messageQueues = new Map(); // phoneId -> { timer, messages: [] }
const DEBOUNCE_MS = 15000; // aguarda 15s após a última mensagem antes de processar

async function initWhatsAppEngine(onMessageReceived) {
    console.log('🔄 Inicializando Motor WhatsApp Gen IA (Baileys)...');

    // AuthState salva os tokens do WhatsApp na pasta local 'auth_info_baileys'
    // Isso evita que o dono da clínica tenha que escanear o QR Code toda vez que o servidor reiniciar
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    // Tenta buscar a versão mais recente da API do WhatsApp Web real
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Versão Baileys Local: v${version.join('.')} (Latest: ${isLatest})`);

    // Cria a conexão com o WhatsApp Web
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // De volta pra silent para o terminal ficar limpo com o QR Code
        browser: ['LumiaOS', 'Chrome', '1.0.0'],
        version,
    });

    // Escuta mudanças de conexão (QR Code, Online, Desconectado)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n==========================================');
            console.log('📱 NOVA SESSÃO: ESCANEIE O QR CODE ABAIXO');
            console.log('Abra o WhatsApp > Aparelhos Conectados');
            console.log('==========================================\n');
            qrcode.generate(qr, { small: true });

            // Gerar Base64 para o Frontend Svelte
            currentStatus = 'qr_ready';
            const qrImage = require('qrcode');
            qrImage.toDataURL(qr, (err, url) => {
                if (!err) currentQR = url;
            });
        }

        if (connection === 'close') {
            currentStatus = 'disconnected';
            currentQR = null;
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log(`❌ Conexão Fechada (Cód: ${reason}). Tentando Ativar Motor: ${shouldReconnect}`);

            if (shouldReconnect) {
                // Backoff exponencial: 3s, 6s, 12s, 24s... máx 60s
                reconnectAttempts++;
                const backoff = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 60000);
                console.log(`🔄 Tentativa ${reconnectAttempts} de reconexão em ${backoff / 1000}s...`);
                setTimeout(() => initWhatsAppEngine(onMessageReceived), backoff);
            } else {
                console.log('⚠️ LOGOUT NO CELULAR DETECTADO. Apague "auth_info_baileys" e reinicie.');
            }
        } else if (connection === 'open') {
            currentStatus = 'online';
            currentQR = null;
            reconnectAttempts = 0; // Reset ao conectar com sucesso
            console.log('✅ WhatsApp Engine Conectado com Sucesso!');
        }
    });

    // Salvar credenciais sempre que renovadas pelo servidor do WhatsApp
    sock.ev.on('creds.update', saveCreds);

    // Escuta novas mensagens chegando no WhatsApp
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return; // Se for só status update ou algo sem corpo

        // Ignorar mensagens que NÓS (a própria clínica) mandamos
        if (msg.key.fromMe) return;

        // Pegar o ID do remetente
        const remoteJid = msg.key.remoteJid;

        // Ignorar mensagens de grupos
        if (remoteJid.includes('@g.us')) return;

        // Puxar o texto da mensagem (Conversa simples ou Conversa com Anexo/Botão - Extended)
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textMessage || textMessage.trim().length === 0) {
            // Paciente enviou mídia (áudio, imagem, vídeo, documento) — responder que só processa texto
            if (onMessageReceived) {
                const clearPhone = remoteJid.replace('@s.whatsapp.net', '');
                const pushName = msg.pushName || 'Lead Sem Nome';
                await onMessageReceived({
                    phoneId: remoteJid,
                    phoneNumber: clearPhone,
                    text: '[Paciente enviou um áudio/imagem/documento. Responda pedindo que envie em texto.]',
                    pushName
                });
                sessionStats.msgs += 1;
            }
            return;
        }

        if (textMessage.trim().length > 0) {
            if (onMessageReceived) {
                const clearPhone = remoteJid.replace('@s.whatsapp.net', '');
                const pushName = msg.pushName || 'Lead Sem Nome';

                // Debounce: cancela timer anterior e acumula a mensagem
                const existing = messageQueues.get(remoteJid);
                if (existing) clearTimeout(existing.timer);

                const messages = existing ? existing.messages : [];
                messages.push(textMessage);

                const timer = setTimeout(async () => {
                    messageQueues.delete(remoteJid);
                    const fullText = messages.join('\n');
                    await onMessageReceived({
                        phoneId: remoteJid,
                        phoneNumber: clearPhone,
                        text: fullText,
                        pushName
                    });
                    sessionStats.msgs += 1;
                }, DEBOUNCE_MS);

                messageQueues.set(remoteJid, { timer, messages });
            }
        }
    });
}

/**
 * Função utilitária para enviar respostas do Agente Inteligente para o celular do paciente
 */
async function sendWhatsAppMessage(phoneId, text) {
    if (!sock) {
        console.warn('❌ Tentativa de enviar mensagem, mas WhatsApp não está online.');
        return;
    }

    // Simular botão "Digitando..." no celular do paciente antes de responder (Mais Humanizado)
    await sock.sendPresenceUpdate('composing', phoneId);

    // Delay com jitter: base proporcional ao texto + variação aleatória de ±30%
    const baseDelay = Math.min(text.length * 80, 4000);
    const jitter = baseDelay * 0.3 * (Math.random() * 2 - 1); // -30% a +30%
    const delay = Math.max(1000, Math.round(baseDelay + jitter)); // mínimo 1s
    await new Promise(r => setTimeout(r, delay));

    // Parar de digitar e Enviar Oficial
    await sock.sendPresenceUpdate('paused', phoneId);
    await sock.sendMessage(phoneId, { text: text });
    console.log(`📤 Mensagem enviada para ${phoneId}`);
}

function getWhatsAppStatus() {
    return {
        state: currentStatus,
        qrCode: currentQR,
        stats: sessionStats
    };
}

async function disconnectWhatsApp() {
    if (sock) {
        currentStatus = 'disconnected';
        currentQR = null;
        try {
            await sock.logout();
        } catch (e) {
            console.error('Erro ao deslogar:', e);
        }
        sock = null;
    }
}

module.exports = { initWhatsAppEngine, sendWhatsAppMessage, getWhatsAppStatus, disconnectWhatsApp };
