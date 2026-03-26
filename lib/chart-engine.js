/**
 * Chart Engine — Generic Puppeteer HTML→PNG renderer
 * generate_charts_team.js에서 추출한 범용 모듈
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class ChartEngine {
  /**
   * Render HTML strings to PNG files
   * @param {Array<{filename: string, html: string}>} charts
   * @param {string} outputDir
   */
  async renderCharts(charts, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const results = [];

    for (const chart of charts) {
      try {
        await page.setContent(chart.html);
        await page.setViewport({ width: 1024, height: 800 });
        const el = await page.$('.container') || await page.$('body');
        const box = await el.boundingBox();
        const outputPath = path.join(outputDir, chart.filename);
        await page.screenshot({
          path: outputPath,
          clip: { x: 0, y: 0, width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 }
        });
        results.push({ filename: chart.filename, path: outputPath, ok: true });
      } catch (e) {
        results.push({ filename: chart.filename, ok: false, error: e.message });
      }
    }

    await browser.close();
    return results;
  }

  /**
   * Download Mermaid diagram as PNG
   * @param {string} mermaidCode
   * @param {string} outputPath
   */
  async renderMermaid(mermaidCode, outputPath) {
    const https = require('https');
    const b64 = Buffer.from(mermaidCode).toString('base64');
    const url = `https://mermaid.ink/img/${b64}?type=png`;

    return new Promise((resolve, reject) => {
      const doGet = (u) => {
        const mod = u.startsWith('https') ? https : require('http');
        mod.get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location);
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, Buffer.concat(chunks));
            resolve(outputPath);
          });
        }).on('error', reject);
      };
      doGet(url);
    });
  }
}

module.exports = { ChartEngine };
