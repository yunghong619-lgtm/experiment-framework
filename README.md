# Experiment Framework

Config-driven multi-agent TUI discussion framework.

## Quick Start

```bash
# 1. Clone
git clone <repo-url> my-experiment
cd my-experiment

# 2. Install
npm install

# 3. Copy brief template
cp templates/brief.md brief.md

# 4. Fill in brief.md (agents, data, rounds)

# 5. Generate config (via Claude Code)
# /experiment

# 6. Run
node experiment-runner.js experiment.config.json
```

## With Claude Code

```
/experiment 재고 보충 정책
```

This generates `brief.md` -> you fill it -> config is auto-generated -> TUI launches.

## Structure

```
experiment-framework/
  experiment-runner.js    # Main entry point
  lib/
    config-loader.js      # Config validation
    discussion-engine.js  # Blessed TUI + Claude API streaming
    chart-engine.js       # Puppeteer HTML->PNG
    wiki-engine.js        # Confluence API client
  templates/
    brief.md              # Brief template (user fills this)
    experiment.config.json # Config skeleton
```

## TUI Controls

- `1-9`: Message specific agent during pause
- `N`: Skip to next round
- `Q`: Quit
- `Tab`: Send message
- `Esc`: Cancel input

## Config Format

See `templates/experiment.config.json` for the full schema.

Key fields:
- `agents[]`: `{key, name, emoji, color, system}` - agent definitions
- `mediator`: mediator definition
- `context`: shared data (facts only, no conclusions)
- `rounds[]`: `{num, name, task}` - discussion rounds
- `pipeline`: optional simulation/charts/wiki scripts

## Requirements

- Node.js 18+
- `@anthropic-ai/sdk`
- `blessed`
- `puppeteer` (optional, for charts)
- `ANTHROPIC_API_KEY` environment variable
