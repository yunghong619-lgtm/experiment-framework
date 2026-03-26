#!/usr/bin/env node
/**
 * Experiment Runner — Main entry point
 *
 * Usage:
 *   node experiment-runner.js <path-to-experiment.config.json> [--auto] [--no-interact]
 *
 * Options:
 *   --auto          토론 후 시뮬레이션/차트/Wiki 자동 실행
 *   --no-interact   인터랙티브 모드 끄기 (라운드 사이 대기 없음)
 *   --headless      TUI 없이 콘솔 출력만 (CI/자동화용)
 */

const path = require('path');
const fs = require('fs');
const { loadConfig } = require('./lib/config-loader');
const { LiveDiscussion } = require('./lib/discussion-engine');
const { execSync } = require('child_process');

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node experiment-runner.js <experiment.config.json> [--auto] [--no-interact]');
  process.exit(1);
}

const AUTO = process.argv.includes('--auto');

async function main() {
  // Load config
  const config = loadConfig(configPath);
  console.log(`Experiment: ${config.title} (${config.id})`);
  console.log(`Agents: ${config.agents.map(a => a.name).join(', ')}`);
  console.log(`Rounds: ${config.rounds.length} + Mediator`);

  // Run discussion
  const discussion = new LiveDiscussion(config);
  const result = await discussion.run();

  // Auto pipeline
  if (AUTO && config.pipeline) {
    const baseDir = config._basedir;

    // Simulation
    if (config.pipeline.simulation && config.pipeline.simulation.script) {
      const simScript = path.join(baseDir, config.pipeline.simulation.script);
      if (fs.existsSync(simScript)) {
        console.log('\n▶ Running simulation...');
        try {
          // Inject mediator decision if applicable
          if (result.final_decision && config.pipeline.simulation.inject_key) {
            const decision = result.final_decision[config.pipeline.simulation.inject_key] || result.final_decision;
            // Write to a temp file for simulation to read
            fs.writeFileSync(path.join(baseDir, 'results', 'decision.json'), JSON.stringify(decision, null, 2));
          }
          const output = execSync(`node "${simScript}"`, { cwd: baseDir, timeout: 60000 }).toString();
          console.log('✓ Simulation complete');
          console.log(output.substring(output.lastIndexOf('=== KPI'), output.length).substring(0, 500));
        } catch (e) {
          console.error('✗ Simulation failed:', e.message.substring(0, 100));
        }
      }
    }

    // Charts
    if (config.pipeline.charts && config.pipeline.charts.script) {
      const chartScript = path.join(baseDir, config.pipeline.charts.script);
      if (fs.existsSync(chartScript)) {
        console.log('\n▶ Generating charts...');
        try {
          execSync(`node "${chartScript}"`, { cwd: baseDir, timeout: 60000 });
          console.log('✓ Charts generated');
        } catch (e) {
          console.error('⚠ Charts skipped:', e.message.substring(0, 100));
        }
      }
    }

    // Wiki
    if (config.pipeline.wiki && config.pipeline.wiki.script) {
      const wikiScript = path.join(baseDir, config.pipeline.wiki.script);
      if (fs.existsSync(wikiScript)) {
        console.log('\n▶ Publishing wiki...');
        try {
          execSync(`node "${wikiScript}"`, { cwd: baseDir, timeout: 60000 });
          console.log('✓ Wiki published');
        } catch (e) {
          console.error('⚠ Wiki skipped:', e.message.substring(0, 100));
        }
      }
    }
  }

  console.log('\n✅ Experiment complete');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
