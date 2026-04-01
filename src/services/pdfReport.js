// /server_node/src/services/pdfReport.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { supabase } = require('./supabase');

/**
 * Gera um relatório em PDF de performance da clínica no mês atual
 * e salva em disco para ser enviado via WhatsApp
 */
async function generateMonthlyPDF(clinicId) {
    try {
        // 1. Buscar os dados da clínica
        const { data: clinic } = await supabase
            .from('clinic_settings')
            .select('name, specialty')
            .eq('id', clinicId)
            .maybeSingle();

        if (!clinic) throw new Error('Clínica não encontrada');

        // 2. Definir o período (Últimos 30 dias)
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        // Formatar datas para o título
        const reportMonth = now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

        // 3. Buscar os Leads e Agendamentos no Supabase
        const { data: patients } = await supabase
            .from('patients')
            .select('id, name, created_at')
            .eq('clinic_id', clinicId)
            .gte('created_at', thirtyDaysAgo.toISOString());

        const { data: appointments } = await supabase
            .from('appointments')
            .select('id, status, created_at')
            .eq('clinic_id', clinicId)
            .gte('created_at', thirtyDaysAgo.toISOString());

        // 4. Calcular Métricas
        const totalLeads = patients?.length || 0;
        const totalApt = appointments?.length || 0;
        
        // Filtrar agendados vs não agendados
        const scheduledApt = appointments?.filter(a => ['agendado', 'realizado', 'confirmado'].includes(a.status))?.length || 0;
        const conversionRate = totalLeads > 0 ? Math.round((scheduledApt / totalLeads) * 100) : 0;

        // Estimar Ticket Médio (Mock ou real se tiver)
        const ticketMedio = 250; 
        const receitaGerada = scheduledApt * ticketMedio;
        
        // Calcular o ROI (Investimento: R$ 1.500)
        const investimento = 1500;
        const roi = receitaGerada > 0 ? Math.round(((receitaGerada - investimento) / investimento) * 100) : 0;

        // Horas Economizadas da Recepção (estimativa: 15 min por lead)
        const horasEconomizadas = Math.round((totalLeads * 15) / 60);

        // 5. Configurar e desenhar o PDF
        return await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            
            // Diretório de saída
            const outDir = path.join(__dirname, '..', '..', 'reports');
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir);
            }
            
            const filename = `Report_${clinic.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
            const outPath = path.join(outDir, filename);
            const stream = fs.createWriteStream(outPath);
            
            doc.pipe(stream);

            // Cabeçalho
            doc.fillColor('#1a1a1a')
               .fontSize(24)
               .text('Bravor.ia', { align: 'center' })
               .moveDown(0.5);
               
            doc.fillColor('#666666')
               .fontSize(12)
               .text('RELATÓRIO DE DESEMPENHO DA IA', { align: 'center', characterSpacing: 2 })
               .moveDown(2);

            // Título
            doc.fillColor('#1a1a1a')
               .fontSize(18)
               .text(`Resultados: ${clinic.name}`, { align: 'left' })
               .fontSize(12)
               .fillColor('#666666')
               .text(`Mês de referência: ${reportMonth.charAt(0).toUpperCase() + reportMonth.slice(1)}`, { align: 'left' })
               .moveDown(2);

            // Linha Divisória
            doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke().moveDown(1.5);

            // Bloco de Métricas Principais
            const yKPI = doc.y;
            
            // KPI 1: Leads
            doc.fillColor('#444444').fontSize(10).text('LEADS ATENDIDOS PELA IA', 50, yKPI);
            doc.fillColor('#1a1a1a').fontSize(24).text(totalLeads.toString(), 50, yKPI + 15);
            
            // KPI 2: Agendamentos
            doc.fillColor('#444444').fontSize(10).text('AGENDAMENTOS GERADOS', 250, yKPI);
            doc.fillColor('#22c55e').fontSize(24).text(scheduledApt.toString(), 250, yKPI + 15);
            
            // KPI 3: Tempo
            doc.fillColor('#444444').fontSize(10).text('HORAS ECONOMIZADAS', 420, yKPI);
            doc.fillColor('#3b82f6').fontSize(24).text(`${horasEconomizadas}h`, 420, yKPI + 15);

            doc.y = yKPI + 60;
            doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke().moveDown(1.5);

            // Impacto Financeiro (ROI)
            doc.fillColor('#1a1a1a').fontSize(14).text('Impacto Financeiro (Estimado)', 50, doc.y).moveDown(1);
            
            doc.fillColor('#444444').fontSize(11)
               .text(`Receita Potencial Gerada:`, { continued: true })
               .fillColor('#22c55e').text(` R$ ${receitaGerada.toLocaleString('pt-BR')},00`, { align: 'right' })
               .moveDown(0.5);

            doc.fillColor('#444444')
               .text(`Taxa de Conversão da IA:`, { continued: true })
               .fillColor('#1a1a1a').text(` ${conversionRate}% (Lead → Agendamento)`, { align: 'right' })
               .moveDown(0.5);

            doc.fillColor('#444444')
               .text(`ROI sobre a Mensalidade (R$1.500):`, { continued: true })
               .fillColor('#1a1a1a').text(` ${roi}% de Retorno`, { align: 'right' })
               .moveDown(2);

            // Bloco de Insights Narrativos
            doc.fillColor('#1a1a1a').fontSize(14).text('Insights da IA (CEO Virtual)', 50, doc.y).moveDown(1);
            
            doc.rect(50, doc.y, 495, 80).fillOpacity(0.05).fill('#3b82f6');
            doc.fillColor('#1a1a1a').fillOpacity(1).fontSize(11);
            doc.text(
                `A Lumia garantiu que nenhum paciente ficasse sem resposta neste mês. Se sua recepção fosse atender os ${totalLeads} leads manualmente em horário comercial, a clínica teria desperdiçado ${horasEconomizadas} horas produtivas, ou quase ${Math.round(horasEconomizadas/8)} dias inteiros de trabalho.`,
                65, doc.y - 65, { width: 465, align: 'justify', lineGap: 3 }
            );

            // Rodapé
            doc.fontSize(9)
               .fillColor('#aaaaaa')
               .text('Bravor.ia - Inteligência Artificial para Clínicas Premium', 50, 750, { align: 'center' });

            doc.end();

            stream.on('finish', () => resolve(outPath));
            stream.on('error', (err) => reject(err));
        });

    } catch (e) {
        console.error('Erro ao gerar relatório de performance:', e);
        return null;
    }
}

module.exports = { generateMonthlyPDF };
