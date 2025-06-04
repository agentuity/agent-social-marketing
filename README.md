<div align="center">
    <img src="https://raw.githubusercontent.com/agentuity/agent-social-marketing/main/.github/Agentuity.png" alt="Agentuity" width="100"/> <br/>
    <strong>Content Marketing Agent System</strong> <br/>
    <strong>Build Agents, Not Infrastructure</strong> <br/>
<br />
<a href="https://github.com/agentuity/agent-social-marketing"><img alt="GitHub Repo" src="https://img.shields.io/badge/GitHub-Marketing-blue"></a>
<a href="https://github.com/agentuity/agent-social-marketing/blob/main/LICENSE.md"><img alt="License" src="https://badgen.now.sh/badge/license/Apache-2.0"></a>
<a href="https://discord.gg/vtn3hgUfuc"><img alt="Join the community on Discord" src="https://img.shields.io/discord/1332974865371758646.svg?style=flat"></a>

[![Deploy with Agentuity](https://app.agentuity.com/img/deploy.svg)](https://app.agentuity.com/deploy)
</div>
</div>

# Content Marketing Agent System

> [!WARNING]  
> This repository is under heavy development and it is not yet stable or ready for use.

The Content Marketing Agent System is an AI-powered automation platform for creating, managing, and scheduling social media content. Built with Agentuity and TypeScript, this system automates the entire content marketing workflow from topic ideation to post scheduling.

## Overview

This system uses a multi-agent architecture to handle different aspects of the content marketing process:

- **Manager Agent**: Orchestrates the entire content marketing workflow
- **Copywriter Agent**: Creates engaging social media content for different platforms
- **Scheduler Agent**: Schedules content for publishing through Typefully API

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.2.5 or higher
- Agentuity CLI (for development)
- Typefully API key (for scheduling content)

### Installation

Install dependencies:

```bash
bun install
```

Run the project:

```bash
agentuity dev
```

## Agent Architecture

### Manager Agent

The Manager Agent serves as the entry point and orchestrator of the content marketing process:

- **Inputs**: Topic, optional description, publish date, and domain source
- **Functions**:
  - Extracts structured information from natural language requests
  - Checks for existing campaigns on similar topics
  - Creates new content marketing campaigns
  - Hands off to the Copywriter Agent for content creation
- **Outputs**: Campaign data or handoff to Copywriter Agent

### Copywriter Agent

The Copywriter Agent is responsible for creating social media content:

- **Inputs**: Campaign ID, topic, and optional description
- **Functions**:
  - Generates multiple LinkedIn posts with appropriate hashtags
  - Creates Twitter threads with multiple tweets
  - Updates campaign status and saves content to the campaign
- **Outputs**: LinkedIn posts and Twitter threads, with handoff to Scheduler Agent

### Scheduler Agent

The Scheduler Agent handles publishing the created content:

- **Inputs**: Campaign ID and optional publish date
- **Functions**:
  - Interfaces with Typefully API to schedule content
  - Schedules LinkedIn posts and Twitter threads
  - Updates campaign status with scheduling information
- **Outputs**: Scheduling confirmation with links to scheduled content

## Data Model

The system uses the following key data structures:

- **Campaign**: Central data object containing all information about a content marketing campaign
- **Campaign Metadata**: Indexed by campaign ID in KV store

## Development

This project was built using Agentuity, an AI agent development platform. The project structure follows Agentuity's conventions with agents located in `src/agents/`.

## Documentation

For comprehensive documentation on Agentuity, visit our documentation site at [agentuity.dev](https://agentuity.dev).

## License

This project is licensed under the Apache License, Version 2.0 - see the [LICENSE](LICENSE.md) file for details.
