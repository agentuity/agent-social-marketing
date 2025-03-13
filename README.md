# Content Marketing Agent System

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

## License

This project is licensed under the MIT License - see the LICENSE file for details.
