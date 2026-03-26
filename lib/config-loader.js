/**
 * Config Loader — experiment.config.json 로딩 + 검증
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['id', 'title', 'agents', 'mediator', 'context', 'rounds'];

function loadConfig(configPath) {
  const fullPath = path.resolve(configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config not found: ${fullPath}`);
  }

  const config = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!config[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate agents
  if (!Array.isArray(config.agents) || config.agents.length < 2) {
    throw new Error('At least 2 agents required');
  }
  for (const agent of config.agents) {
    if (!agent.key || !agent.name || !agent.system) {
      throw new Error(`Agent missing key/name/system: ${JSON.stringify(agent)}`);
    }
    agent.emoji = agent.emoji || '🤖';
    agent.color = agent.color || 'white';
  }

  // Validate mediator
  if (!config.mediator.system) {
    throw new Error('Mediator missing system prompt');
  }
  config.mediator.key = config.mediator.key || 'mediator';
  config.mediator.emoji = config.mediator.emoji || '⚖️';
  config.mediator.color = config.mediator.color || 'yellow';

  // Validate rounds
  if (!Array.isArray(config.rounds) || config.rounds.length < 1) {
    throw new Error('At least 1 round required');
  }

  // Defaults
  config.model = config.model || 'claude-sonnet-4-20250514';
  config.max_tokens = config.max_tokens || 4096;
  config.pipeline = config.pipeline || {};
  config.mediator_output_format = config.mediator_output_format || {};

  // Resolve base directory (where config lives)
  config._basedir = path.dirname(fullPath);

  return config;
}

module.exports = { loadConfig };
