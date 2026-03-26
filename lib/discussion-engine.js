/**
 * Discussion Engine — Config-driven multi-agent TUI with streaming
 *
 * 기존 tui-live.js에서 추출. config 객체를 받아서 실행.
 * - blessed N-panel split view (에이전트 수에 따라 자동 조정)
 * - Claude API streaming
 * - 라운드별 전체 컨텍스트 전달
 * - 인터랙티브 모드 (숫자키로 에이전트에게 메시지)
 */

const blessed = require('blessed');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

class LiveDiscussion {
  constructor(config) {
    this.config = config;
    const apiKey = config.api_key || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: Set ANTHROPIC_API_KEY env var or api_key in config');
      process.exit(1);
    }
    this.anthropic = new Anthropic({ apiKey });

    this.agents = config.agents;           // [{key, name, emoji, color, system}]
    this.mediator = config.mediator;       // {key, name, emoji, color, system}
    this.context = config.context;         // shared context string
    this.rounds = config.rounds;           // [{num, name, task}]
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.max_tokens || 4096;
    this.interactive = !process.argv.includes('--no-interact');

    this.agentKeys = this.agents.map(a => a.key);
    this.allAgents = {};
    for (const a of this.agents) this.allAgents[a.key] = a;
    this.allAgents[this.mediator.key] = this.mediator;

    this.roundResponses = {};
    this.userMessages = {};
    for (const key of [...this.agentKeys, this.mediator.key]) {
      this.userMessages[key] = [];
    }

    this.screen = blessed.screen({
      smartCSR: true,
      title: `${config.title} — Live Discussion`,
      fullUnicode: true,
    });

    this.createLayout();
    this.bindKeys();
  }

  // ── Dynamic Layout ──

  createLayout() {
    const totalPanels = this.agents.length + 1; // +1 for mediator
    const cols = totalPanels <= 2 ? 2 : totalPanels <= 4 ? 2 : 3;
    const rows = Math.ceil(totalPanels / cols);

    // Header
    this.header = blessed.box({
      top: 0, left: 0, width: '100%', height: 3,
      content: `{center}{bold} ${this.config.title} — ${this.agents.length} Agents + Mediator | Live {/bold}{/center}`,
      tags: true, border: { type: 'line' },
      style: { border: { fg: 'cyan' }, bg: 'black' }
    });

    const panelH = Math.floor(90 / rows) + '%';
    const panelW = Math.floor(100 / cols) + '%';

    this.panels = {};
    const allKeys = [...this.agentKeys, this.mediator.key];

    allKeys.forEach((key, i) => {
      const agent = this.allAgents[key];
      const row = Math.floor(i / cols);
      const col = i % cols;
      const top = 3 + row * Math.floor(90 / rows) + '%';
      const left = col * Math.floor(100 / cols) + '%';

      // Calculate positions as percentages
      const topPct = `${3 + row * Math.floor(87 / rows)}%`;
      const leftPct = `${col * Math.floor(100 / cols)}%`;
      const widthPct = col === cols - 1 ? `${100 - col * Math.floor(100 / cols)}%` : panelW;

      const shortcut = i + 1;

      this.panels[key] = blessed.log({
        top: topPct, left: leftPct, width: widthPct, height: panelH,
        label: ` ${agent.emoji} ${agent.name} [${shortcut}] `,
        tags: true, border: { type: 'line' },
        style: { border: { fg: agent.color }, label: { fg: agent.color, bold: true } },
        scrollable: true, alwaysScroll: true,
        scrollbar: { ch: '█', style: { fg: agent.color } },
        mouse: true,
      });
    });

    // Input bar
    this.inputBar = blessed.textbox({
      bottom: 1, left: 0, width: '100%', height: 3,
      label: ' Message (Tab to send, Esc to cancel) ',
      tags: true, border: { type: 'line' },
      style: { border: { fg: 'white' }, label: { fg: 'white', bold: true } },
      inputOnFocus: true, hidden: true,
    });

    // Status bar
    const shortcuts = allKeys.map((k, i) => `${i + 1}:${this.allAgents[k].name.split(' ')[0]}`).join(' ');
    this.statusBar = blessed.box({
      bottom: 0, left: 0, width: '100%', height: 1,
      content: ` Ready | ${shortcuts} | N: next | Q: quit`,
      style: { bg: 'black', fg: 'cyan' }
    });

    this.screen.append(this.header);
    Object.values(this.panels).forEach(p => this.screen.append(p));
    this.screen.append(this.inputBar);
    this.screen.append(this.statusBar);
    this.screen.render();
  }

  bindKeys() {
    this.screen.key(['escape', 'q', 'C-c'], () => {
      if (!this.inputBar.hidden) {
        this.inputBar.hide();
        this.screen.render();
        return;
      }
      process.exit(0);
    });

    // Number keys 1-9 for agents
    const allKeys = [...this.agentKeys, this.mediator.key];
    for (let i = 0; i < allKeys.length && i < 9; i++) {
      const key = allKeys[i];
      this.screen.key([String(i + 1)], () => {
        if (this.inputBar.hidden && this.waitingForInput) {
          this.showInput(key);
        }
      });
    }

    this.screen.key(['n'], () => {
      if (this.waitingForInput) {
        this.waitingForInput = false;
        this.inputResolve && this.inputResolve(null);
      }
    });
  }

  showInput(agentKey) {
    const agent = this.allAgents[agentKey];
    this.inputBar.setLabel(` To ${agent.emoji} ${agent.name} (Tab send, Esc cancel) `);
    this.inputBar.setValue('');
    this.inputBar.show();
    this.inputBar.focus();
    this.screen.render();

    this.inputBar.once('submit', (value) => {
      this.inputBar.hide();
      this.screen.render();
      if (value && value.trim()) {
        this.log(agentKey, `{white-fg}{bold}[YOU]:{/bold} ${value.trim()}{/white-fg}`);
        this.respondToUser(agentKey, value.trim());
      }
    });
    this.inputBar.once('cancel', () => {
      this.inputBar.hide();
      this.screen.render();
    });
  }

  async respondToUser(agentKey, message) {
    let prompt = this.context + '\n\n';
    for (const [r, resp] of Object.entries(this.roundResponses)) {
      prompt += `## Round ${r}:\n`;
      for (const k of this.agentKeys) {
        if (resp[k]) prompt += `**${this.allAgents[k].name}:** ${resp[k].substring(0, 800)}\n\n`;
      }
    }
    prompt += `\n---\n사용자 질문: "${message}"\n\n당신의 전문 관점에서 간결하게 답변하세요.`;
    await this.streamAgent(agentKey, this.allAgents[agentKey], prompt);
  }

  setStatus(text) {
    this.statusBar.setContent(` ${text}`);
    this.screen.render();
  }

  log(panelKey, text) {
    if (this.panels[panelKey]) {
      this.panels[panelKey].log(text);
      this.screen.render();
    }
  }

  // ── Streaming ──

  async streamAgent(panelKey, agentDef, userPrompt) {
    const panel = this.panels[panelKey];
    if (!panel) return '[No panel]';
    let fullText = '';
    let currentLine = '';

    try {
      const stream = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: agentDef.system,
        messages: [{ role: 'user', content: userPrompt }],
        stream: true,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.text) {
          const chunk = event.delta.text;
          fullText += chunk;
          for (const ch of chunk) {
            if (ch === '\n') {
              panel.log(currentLine || '');
              currentLine = '';
              this.screen.render();
            } else {
              currentLine += ch;
            }
          }
        }
      }

      if (currentLine.trim()) panel.log(currentLine);
      panel.log('{green-fg}✓{/green-fg}');
      panel.log('');
      this.screen.render();
      return fullText;
    } catch (error) {
      panel.log(`{red-fg}Error: ${error.message}{/red-fg}`);
      this.screen.render();
      return `[Error: ${error.message}]`;
    }
  }

  // ── Prompt Builders ──

  buildPrompt(round) {
    let prompt = this.context + '\n';
    for (let r = 1; r < round.num; r++) {
      const prev = this.roundResponses[r];
      if (!prev) continue;
      prompt += `\n## ── Round ${r} 결과 ──\n`;
      for (const key of this.agentKeys) {
        if (prev[key]) prompt += `\n### ${this.allAgents[key].emoji} ${this.allAgents[key].name}:\n${prev[key]}\n`;
      }
    }
    prompt += `\n---\n## Round ${round.num}: ${round.name}\n\n${round.task}`;
    return prompt;
  }

  buildMediatorPrompt() {
    let prompt = this.context + '\n\n# 전체 토론 기록\n';
    for (let r = 0; r < this.rounds.length; r++) {
      const roundNum = this.rounds[r].num;
      const resp = this.roundResponses[roundNum];
      if (!resp) continue;
      prompt += `\n## Round ${roundNum}: ${this.rounds[r].name}\n`;
      for (const key of this.agentKeys) {
        if (resp[key]) prompt += `\n### ${this.allAgents[key].emoji} ${this.allAgents[key].name}:\n${resp[key]}\n`;
      }
      prompt += '\n---\n';
    }

    const outputFormat = this.config.mediator_output_format || {};
    const jsonKey = outputFormat.json_key || 'final_decision';

    prompt += `\n## 최종 결정 요청
모든 에이전트의 토론을 종합하여 최종 결정을 내리세요.

출력:
1. 각 라운드 핵심 쟁점 (1-2줄)
2. 주요 Trade-off
3. 최종 결정 + 근거
4. 예상 효과

반드시 아래 JSON 포함:
\`\`\`json
{
  "${jsonKey}": { ... }
}
\`\`\``;

    return prompt;
  }

  // ── Round Execution ──

  waitForUserInput(roundNum) {
    return new Promise((resolve) => {
      this.waitingForInput = true;
      this.inputResolve = resolve;
      const shortcuts = [...this.agentKeys, this.mediator.key].map((k, i) =>
        `${i + 1}:${this.allAgents[k].name.split(' ')[0]}`).join(' ');
      this.setStatus(`Round ${roundNum} done | ${shortcuts} | N: next | Q: quit`);
      const timeout = setTimeout(() => {
        if (this.waitingForInput) { this.waitingForInput = false; resolve(null); }
      }, 30000);
      const check = setInterval(() => {
        if (!this.waitingForInput) { clearInterval(check); clearTimeout(timeout); resolve(null); }
      }, 100);
    });
  }

  async runRound(round) {
    for (const key of this.agentKeys) {
      this.log(key, `{bold}{cyan-fg}━━━ Round ${round.num}: ${round.name} ━━━{/cyan-fg}{/bold}`);
    }
    this.log(this.mediator.key, `{cyan-fg}▶ Round ${round.num}: ${round.name} — ${this.agents.length} agents streaming...{/cyan-fg}`);

    const prompt = this.buildPrompt(round);
    const results = await Promise.all(
      this.agentKeys.map(key => this.streamAgent(key, this.allAgents[key], prompt))
    );

    this.roundResponses[round.num] = {};
    this.agentKeys.forEach((key, i) => {
      this.roundResponses[round.num][key] = results[i];
    });

    this.log(this.mediator.key, `{green-fg}✓ Round ${round.num} complete{/green-fg}`);
  }

  async runMediator() {
    const medKey = this.mediator.key;
    this.log(medKey, '{bold}{yellow-fg}━━━ FINAL: Mediator Decision ━━━{/yellow-fg}{/bold}');
    for (const key of this.agentKeys) {
      this.log(key, '{yellow-fg}⏳ Mediator deciding...{/yellow-fg}');
    }

    const prompt = this.buildMediatorPrompt();
    const result = await this.streamAgent(medKey, this.mediator, prompt);

    const finalRound = this.rounds.length + 1;
    this.roundResponses[finalRound] = { [medKey]: result };

    // Parse JSON
    let finalDecision = null;
    try {
      const m = result.match(/```json\n([\s\S]*?)\n```/);
      if (m) finalDecision = JSON.parse(m[1]);
    } catch (e) {
      this.log(medKey, '{red-fg}Warning: JSON parse failed{/red-fg}');
    }

    // Announce
    for (const key of this.agentKeys) {
      this.log(key, '{bold}{green-fg}━━━ DECISION ━━━{/green-fg}{/bold}');
      if (finalDecision) {
        const summary = JSON.stringify(finalDecision).substring(0, 200);
        this.log(key, summary);
      }
    }

    return { result, finalDecision };
  }

  // ── Main ──

  async run() {
    const startTime = Date.now();
    const medKey = this.mediator.key;

    this.log(medKey, `{bold}🚀 ${this.config.title}{/bold}`);
    this.log(medKey, `Model: ${this.model} | Agents: ${this.agents.length} + Mediator`);
    this.log(medKey, `Rounds: ${this.rounds.length} + Final`);
    this.log(medKey, `Interactive: ${this.interactive ? 'ON (30s timeout)' : 'OFF'}`);
    this.log(medKey, '');

    // Run discussion rounds
    for (const round of this.rounds) {
      this.setStatus(`Round ${round.num}/${this.rounds.length + 1} — ${round.name} | Streaming...`);
      await this.runRound(round);

      if (this.interactive && round.num < this.rounds.length) {
        await this.waitForUserInput(round.num);
      }
    }

    // Last interactive pause
    if (this.interactive) {
      this.log(medKey, '{yellow-fg}Last chance before Mediator...{/yellow-fg}');
      await this.waitForUserInput(this.rounds.length);
    }

    // Mediator
    this.setStatus('Final — Mediator Decision');
    const { result, finalDecision } = await this.runMediator();

    const duration = Math.round((Date.now() - startTime) / 1000);

    // Save results
    const output = {
      timestamp: new Date().toISOString(),
      experiment: this.config.id,
      title: this.config.title,
      model: this.model,
      duration_seconds: duration,
      agents: this.agentKeys,
      rounds: this.roundResponses,
      user_messages: this.userMessages,
      final_decision: finalDecision,
    };

    const resultsDir = path.join(this.config._basedir || '.', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const resultsPath = path.join(resultsDir, 'discussion_live.json');
    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));

    this.log(medKey, `{bold}✅ ${duration}s{/bold} | 💾 ${resultsPath}`);
    this.setStatus(`DONE ${duration}s | Q to exit`);
    this.log(medKey, '{bold}Press Q to exit{/bold}');

    return output;
  }
}

module.exports = { LiveDiscussion };
