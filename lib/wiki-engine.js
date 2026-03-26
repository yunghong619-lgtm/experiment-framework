/**
 * Wiki Engine — Generic Confluence API client
 * wiki_publisher_team.js에서 추출한 범용 모듈
 */

const https = require('https');
const fs = require('fs');

class WikiEngine {
  constructor(config = {}) {
    this.hostname = config.hostname || process.env.CONFLUENCE_HOSTNAME || '';
    this.email = config.email || process.env.CONFLUENCE_EMAIL || '';
    this.token = config.token || process.env.CONFLUENCE_TOKEN || '';
    this.spaceKey = config.space_key || process.env.CONFLUENCE_SPACE_KEY || '';
    this.auth = Buffer.from(`${this.email}:${this.token}`).toString('base64');
  }

  apiCall(method, path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.hostname,
        path: '/wiki/rest/api' + path,
        method,
        headers: { 'Authorization': 'Basic ' + this.auth, 'Content-Type': 'application/json', 'Accept': 'application/json' }
      };
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
          else reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 300)}`));
        });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }

  uploadAttachment(pageId, filepath, comment = '') {
    return new Promise((resolve, reject) => {
      const filename = filepath.replace(/\\/g, '/').split('/').pop();
      const fileData = fs.readFileSync(filepath);
      const boundary = '----FormBoundary' + Date.now();
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
        fileData,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="comment"\r\n\r\n${comment}\r\n--${boundary}--\r\n`)
      ]);
      const options = {
        hostname: this.hostname,
        path: `/wiki/rest/api/content/${pageId}/child/attachment`,
        method: 'PUT',
        headers: {
          'Authorization': 'Basic ' + this.auth,
          'X-Atlassian-Token': 'nocheck',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        }
      };
      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 200) resolve(filename);
          else reject(new Error(`Upload ${res.statusCode}: ${Buffer.concat(chunks).toString().substring(0, 200)}`));
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async createPage(title, content, parentPageId) {
    return this.apiCall('POST', '/content', {
      type: 'page',
      title,
      ancestors: [{ id: parentPageId }],
      space: { key: this.spaceKey },
      body: { storage: { value: content, representation: 'storage' } }
    });
  }

  async updatePage(pageId, title, content, version) {
    return this.apiCall('PUT', `/content/${pageId}`, {
      id: pageId, type: 'page', title,
      version: { number: version },
      body: { storage: { value: content, representation: 'storage' } }
    });
  }

  async getPageVersion(pageId) {
    const page = await this.apiCall('GET', `/content/${pageId}?expand=version`);
    return page.version.number;
  }
}

module.exports = { WikiEngine };
