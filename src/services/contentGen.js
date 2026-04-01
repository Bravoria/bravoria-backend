const { generateSonnetContent } = require('./ai');

/**
 * Gera legendas para Instagram baseadas na especialidade da clínica.
 * Usa Claude Sonnet para garantir criatividade e qualidade.
 * @param {Object} clinicData - { name, specialty, tone, topic? }
 * @returns {Array<string>} Array de 10 legendas prontas
 */
async function generateInstagramCaptions(clinicData) {
    const { name, specialty, tone, topic } = clinicData;

    const systemPrompt = `Você é um especialista em marketing digital para clínicas de saúde e estética.
Crie legendas autênticas, envolventes e humanizadas para Instagram de clínicas.
Regras:
- Tom ${tone || 'profissional e acolhedor'}
- Linguagem brasileira natural (não robótica)
- Cada legenda deve ter máximo 4 linhas de texto + 1 linha de hashtags relevantes
- Varie o estilo: educativo, emocional, bastidores, dica, depoimento fictício
- Não use clichês como "Venha nos visitar" ou "Marque sua consulta hoje"
- Foque em VALOR e CONEXÃO, não em venda direta`;

    const userPrompt = `Clínica: ${name || 'Clínica'}
Especialidade: ${specialty || 'Odontologia Estética'}
Tópico especial (opcional): ${topic || 'geral — variar entre os tratamentos oferecidos'}

Gere exatamente 10 legendas criativas e diferentes entre si.
Separe cada uma com uma linha em branco e o número (1. 2. 3. etc).
Retorne apenas as legendas numeradas, sem introdução ou conclusão.`;

    const raw = await generateSonnetContent(systemPrompt, userPrompt);

    // Parsear as legendas numeradas em um array limpo
    const captions = raw
        .split(/\n(?=\d+\.)/)
        .map(s => s.replace(/^\d+\.\s*/, '').trim())
        .filter(s => s.length > 10);

    return captions.slice(0, 10);
}

module.exports = { generateInstagramCaptions };
