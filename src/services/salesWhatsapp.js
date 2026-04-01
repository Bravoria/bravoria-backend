const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');

const AUTH_FOLDER = path.join(__dirname, '../../auth_info_sales');

let salesSock = null;
let salesStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
let salesQR = null;

// Debounce: acumula mensagens rápidas do mesmo contato e processa juntas
const salesMessageQueues = new Map(); // phoneId -> { timer, messages: [] }
const DEBOUNCE_MS = 2000;

async function initSalesWhatsApp(onMessage) {
    console.log('[Sales WA] Inicializando instância de vendas (Baileys)...');
    salesStatus = 'connecting';

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Sales WA] Versão Baileys: v${version.join('.')} (Latest: ${isLatest})`);

    salesSock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['LumiaOS-Sales', 'Chrome', '1.0.0'],
        version,
    });

    salesSock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n==========================================');
            console.log('[Sales WA] NOVA SESSÃO: ESCANEIE O QR CODE ABAIXO');
            console.log('Abra o WhatsApp > Aparelhos Conectados');
            console.log('==========================================\n');
            qrcode.generate(qr, { small: true });

            salesStatus = 'connecting';
            const qrImage = require('qrcode');
            qrImage.toDataURL(qr, (err, url) => {
                if (!err) salesQR = url;
            });
        }

        if (connection === 'close') {
            salesStatus = 'disconnected';
            salesQR = null;
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;
            console.log(`[Sales WA] Conexão fechada (Cód: ${reason}). Reconectar: ${shouldReconnect}`);

            if (shouldReconnect) {
                // Backoff exponencial simples: 3s, 6s, 12s, 24s... máx 60s
                const attempts = (initSalesWhatsApp._attempts || 0) + 1;
                initSalesWhatsApp._attempts = attempts;
                const backoff = Math.min(3000 * Math.pow(2, attempts - 1), 60000);
                console.log(`[Sales WA] Reconexão em ${backoff / 1000}s (tentativa ${attempts})...`);
                setTimeout(() => initSalesWhatsApp(onMessage), backoff);
            } else {
                console.log('[Sales WA] LOGOUT DETECTADO. Apague "auth_info_sales" e reinicie.');
            }
        } else if (connection === 'open') {
            salesStatus = 'connected';
            salesQR = null;
            initSalesWhatsApp._attempts = 0;
            console.log('[Sales WA] Conectado com sucesso!');
        }
    });

    salesSock.ev.on('creds.update', saveCreds);

    salesSock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;

        // Ignorar grupos
        if (remoteJid.includes('@g.us')) return;

        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!textMessage || textMessage.trim().length === 0) {
            // Mídia recebida — informar ao handler para responder pedindo texto
            if (onMessage) {
                const clearPhone = remoteJid.replace('@s.whatsapp.net', '');
                const pushName = msg.pushName || 'Lead';
                await onMessage({
                    phoneId: remoteJid,
                    phoneNumber: clearPhone,
                    text: '[Contato enviou mídia. Responda pedindo que envie em texto.]',
                    pushName
                });
            }
            return;
        }

        if (textMessage.trim().length > 0 && onMessage) {
            const clearPhone = remoteJid.replace('@s.whatsapp.net', '');
            const pushName = msg.pushName || 'Lead';

            const existing = salesMessageQueues.get(remoteJid);
            if (existing) clearTimeout(existing.timer);

            const messages = existing ? existing.messages : [];
            messages.push(textMessage);

            const timer = setTimeout(async () => {
                salesMessageQueues.delete(remoteJid);
                const fullText = messages.join('\n');
                await onMessage({
                    phoneId: remoteJid,
                    phoneNumber: clearPhone,
                    text: fullText,
                    pushName
                });
            }, DEBOUNCE_MS);

            salesMessageQueues.set(remoteJid, { timer, messages });
        }
    });
}

async function sendSalesMessage(phoneId, text) {
    if (!salesSock) {
        console.warn('[Sales WA] Tentativa de enviar mensagem, mas instância de vendas não está online.');
        return;
    }

    await salesSock.sendPresenceUpdate('composing', phoneId);

    const baseDelay = Math.min(text.length * 80, 4000);
    const jitter = baseDelay * 0.3 * (Math.random() * 2 - 1);
    const delay = Math.max(1000, Math.round(baseDelay + jitter));
    await new Promise(r => setTimeout(r, delay));

    await salesSock.sendPresenceUpdate('paused', phoneId);
    await salesSock.sendMessage(phoneId, { text });
    console.log(`[Sales WA] Mensagem enviada para ${phoneId}`);
}

function getSalesWhatsAppStatus() {
    return {
        status: salesStatus,
        qr: salesQR
    };
}

module.exports = { initSalesWhatsApp, sendSalesMessage, getSalesWhatsAppStatus };
