/**
 * Shared interfaces for Content Marketing Agent Swarm
 */

/**
 * Campaign status
 */
export type CampaignStatus =
	| "planning"
	| "researching"
	| "writing"
	| "scheduling"
	| "active"
	| "completed";

/**
 * Research results from the Researcher Agent
 */
export interface ResearchResults {
	title: string;
	description: string;
	longFormDescription: string;
	tags: string[];
	keyInsights: string[];
	sources: string[];
}

/**
 * Social media post
 */
export interface Post {
	platform: "linkedin" | "twitter";
	content: string;
	media?: string[];
	scheduledDate?: string; // ISO string format
	typefullyId?: string;
}

/**
 * Twitter thread
 */
export interface Thread {
	tweets: Post[];
	scheduledDate?: string; // ISO string format
	typefullyId?: string;
}

/**
 * Campaign content created by the Copywriter Agent
 */
export interface CampaignContent {
	linkedInPosts: Post[];
	twitterThreads: Thread[];
}

/**
 * Scheduling information for Typefully
 */
export interface SchedulingInfo {
	typefullyScheduleId?: string;
	scheduledPosts: {
		postId: string;
		typefullyId: string;
		scheduledDate: string; // ISO string format
		status: "draft" | "scheduled" | "published" | "failed";
	}[];
}

/**
 * Campaign object for the Content Marketing Agent Swarm
 */
export interface Campaign {
	id: string;
	topic: string;
	description?: string;
	publishDate?: string; // ISO string format
	status: CampaignStatus;
	research?: ResearchResults;
	content?: CampaignContent;
	schedulingInfo?: SchedulingInfo;
	createdAt: string; // ISO string format
	updatedAt: string; // ISO string format
}

/**
 * Request to the Manager Agent
 */
export interface ManagerRequest {
	topic: string;
	description?: string;
	publishDate?: string; // ISO string format
	domain?: string;
}

/**
 * Request to the Researcher Agent
 */
export interface ResearcherRequest {
	topic: string;
	description?: string;
	source?: string; // URL
	campaignId: string;
	publishDate?: string; // ISO string format
}

/**
 * Request to the Copywriter Agent
 */
export interface CopywriterRequest {
	campaignId: string;
	topic: string;
	description?: string;
	publishDate?: string; // ISO string format
	research?: ResearchResults;
}

/**
 * Request to the Scheduler Agent
 */
export interface SchedulerRequest {
	campaignId: string;
	content: CampaignContent;
	publishDate?: string; // ISO string format
}
