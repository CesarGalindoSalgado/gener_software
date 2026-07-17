import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Renderiza una URL (el enlace firmado de la cotización o del reporte) a un PDF
// tamaño carta y devuelve el Buffer. Usa chromium serverless (@sparticuz), pensado
// para Cloud Functions. Aplica los estilos de impresión (@media print) del HTML,
// así los botones/edición quedan ocultos igual que en el PDF del bot.
export async function urlAPdf(url: string): Promise<Buffer> {
  const navegador = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const pagina = await navegador.newPage();
    await pagina.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdf = await pagina.pdf({
      format: 'letter',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await navegador.close();
  }
}
