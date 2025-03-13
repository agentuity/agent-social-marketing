# Content Marketing Agent Swarm - Action Plan

## Overview
This document outlines the implementation plan for a content marketing agent swarm consisting of four specialized agents:
- **Manager**: Coordinates the overall content marketing process
- **Researcher**: Gathers information on topics
- **Copywriter**: Creates content based on research
- **Scheduler**: Publishes content through Typefully API

## System Architecture
```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   Manager   │────▶│  Researcher  │────▶│  Copywriter  │────▶│  Scheduler  │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
       ▲                                                            │
       └────────────────────────────────────────────────────────────┘
```

## Agent Requirements

### Manager Agent
- **Input**: 
  - Required: `topic` (string)
  - Optional: `description` (string)
  - Optional: `start` (date)
  - Optional: `end` (date)
  - Optional: `freeform` text that needs to be parsed
- **Functionality**:
  - Parse natural language input when needed
  - Check KV store to determine if topic is new or existing
  - Track campaigns in KV store
  - Hand off to Researcher for new topics
  - Monitor campaign progress
  - Handle status updates
- **Output**:
  - Structured campaign information
  - Status updates

### Researcher Agent
- **Input**:
  - `topic` (string)
  - Optional: `description` (string)
  - Optional: `source` (URL)
- **Functionality**:
  - Use Firecrawl to scrape approved sources
  - Research topic thoroughly
  - Extract key information and insights
  - Format research for Copywriter
- **Output**:
  - `title` (string)
  - `description` (string)
  - `longFormDescription` (string)
  - `tags` (array)
  - `keyInsights` (array)
  - `sources` (array)

### Copywriter Agent
- **Input**:
  - Research payload from Researcher
- **Functionality**:
  - Generate LinkedIn posts
  - Create Twitter/X thread
  - Ensure content is optimized for engagement
  - Create a consistent campaign voice
- **Output**:
  - Campaign object containing:
    - LinkedIn posts (array)
    - Twitter posts (array)
    - Scheduling metadata

### Scheduler Agent
- **Input**:
  - Campaign object from Copywriter
  - Date range for posting
- **Functionality**:
  - Connect to Typefully API
  - Create draft posts
  - Schedule posts across campaign timeline
  - Track scheduling status
- **Output**:
  - Scheduled post IDs
  - Scheduling confirmation
  - Error handling for failed scheduling

## Data Structures

### Campaign Object
```typescript
interface Campaign {
  id: string;
  topic: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  status: "planning" | "researching" | "writing" | "scheduling" | "active" | "completed";
  research?: ResearchResults;
  content?: CampaignContent;
  schedulingInfo?: SchedulingInfo;
  createdAt: Date;
  updatedAt: Date;
}

interface ResearchResults {
  title: string;
  description: string;
  longFormDescription: string;
  tags: string[];
  keyInsights: string[];
  sources: string[];
}

interface CampaignContent {
  linkedInPosts: Post[];
  twitterThreads: Thread[];
}

interface Post {
  platform: "linkedin" | "twitter";
  content: string;
  media?: string[];
  scheduledDate?: Date;
  typefullyId?: string;
}

interface Thread {
  tweets: Post[];
  scheduledDate?: Date;
  typefullyId?: string;
}

interface SchedulingInfo {
  typefullyScheduleId?: string;
  scheduledPosts: {
    postId: string;
    typefullyId: string;
    scheduledDate: Date;
    status: "draft" | "scheduled" | "published" | "failed";
  }[];
}
```

## Implementation Tasks

### Phase 1: Setup & Manager Agent
- [x] Setup KV store schema for campaigns
- [x] Implement Manager agent core functionality
  - [x] Input parsing
  - [x] Campaign identification logic
  - [x] KV store integration for tracking
  - [x] Agent communication logic

### Phase 2: Researcher Agent
- [x] Mock Firecrawl integration (to be replaced with actual integration later)
- [x] Create research methodology
- [x] Implement data extraction logic
- [x] Format research results for Copywriter

### Phase 3: Copywriter Agent
- [x] Implement content generation logic
- [x] Create templates for LinkedIn posts
- [x] Create templates for Twitter threads
- [x] Implement quality checking

### Phase 4: Scheduler Agent
- [x] Implement Typefully API integration (mock version)
- [x] Create scheduling algorithm
- [x] Implement error handling and retry logic
- [x] Add reporting functionality

### Phase 5: Integration & Testing
- [x] Test end-to-end workflow
- [x] Implement logging across all agents
- [ ] Create monitoring dashboard
- [ ] Performance optimization

## Milestones & Timeline
1. **Manager Agent Implementation** - ✅ Completed
2. **Researcher Agent Implementation** - ✅ Completed
3. **Copywriter Agent Implementation** - ✅ Completed
4. **Scheduler Agent Implementation** - ✅ Completed
5. **Full System Integration** - ✅ Completed
6. **Testing & Optimization** - 🔄 In Progress
7. **Production Deployment** - [Date TBD]

## Progress Tracking
| Task | Status | Notes |
|------|--------|-------|
| Setup project structure | ✅ | Initial structure created |
| Create shared types | ✅ | Created interfaces for all agents and data structures |
| Create KV store utilities | ✅ | Implemented campaign storage and retrieval |
| Manager Agent implementation | ✅ | Implemented with natural language parsing and handoff |
| Researcher Agent implementation | ✅ | Implemented with mock web search and content analysis |
| Copywriter Agent implementation | ✅ | Implemented with LinkedIn and Twitter content generation |
| Scheduler Agent implementation | ✅ | Implemented with mock Typefully API integration |
| End-to-end testing | ✅ | Basic workflow tested |
| Monitoring and optimization | 🔄 | In progress |

## Technical Considerations
- **Error Handling**: Each agent should handle errors gracefully and provide clear feedback
- **Rate Limiting**: Consider API rate limits for Typefully and research tools
- **Persistence**: Use KV store for campaign tracking and state management
- **Security**: Secure handling of API keys and credentials
- **Scalability**: Design for handling multiple concurrent campaigns

## Future Enhancements
- Replace mock Firecrawl with actual implementation
- Implement real Typefully API integration
- Add media support for posts
- Create a dashboard for monitoring campaign performance
- Add support for more social media platforms 