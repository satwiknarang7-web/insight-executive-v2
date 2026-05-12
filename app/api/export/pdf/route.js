import { NextResponse } from "next/server";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

export async function POST(request) {
  let browser = null;
  try {
    const reportData = await request.json();

    if (!reportData) {
      return NextResponse.json({ error: "No data provided for report generation" }, { status: 400 });
    }

    // Determine the base URL for navigation
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const host = request.headers.get('host');
    const baseUrl = `${protocol}://${host}`;
    const printUrl = `${baseUrl}/report/print`;

    const isLocal = process.env.NODE_ENV === 'development';
    const executablePath = isLocal 
      ? (process.env.CHROME_PATH || 
         (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' :
          process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' :
          '/usr/bin/google-chrome'))
      : await chromium.executablePath();

    browser = await puppeteer.launch({
      args: isLocal ? [] : chromium.args,
      defaultViewport: { width: 1920, height: 1080 },
      executablePath: executablePath,
      headless: true,
    });

    const page = await browser.newPage();
    
    // Force the virtual browser window size to match A4 at 96 DPI
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    
    // Inject the data before navigation so it's available in the print route
    await page.evaluateOnNewDocument((data) => {
      window.PRINT_DATA = data;
    }, reportData);

    await page.goto(printUrl, { 
      waitUntil: 'networkidle0',
      timeout: 60000 
    });

    // Wait for the data to be injected and the main container to render
    await page.waitForSelector('.print-container-rendered', { timeout: 20000 }).catch(() => console.warn('Render selector timeout'));
    // Add a buffer for Recharts and other elements to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000)); 

    const pdf = await page.pdf({
      width: '794px',
      height: '1123px',
      printBackground: true,
      displayHeaderFooter: false,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      }
    });

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="Insight_Executive_Report.pdf"',
      },
    });

  } catch (error) {
    console.error("PDF Generation Error:", error);
    return NextResponse.json({ error: "Failed to generate PDF", details: error.message }, { status: 500 });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
