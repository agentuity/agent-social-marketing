import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
	getCampaign,
	updateCampaignStatus,
	saveCampaign,
} from "../../utils/kv-store";
import type {
	Campaign,
	CopywriterRequest,
	ResearchResults,
	CampaignContent,
	Post,
	Thread,
} from "../../types";

// Zod schema for LinkedIn post generation
const LinkedInPostSchema = z.object({
	posts: z.array(
		z.object({
			content: z.string(),
			hashtags: z.array(z.string()).optional(),
		}),
	),
});

// Zod schema for Twitter thread generation
const TwitterThreadSchema = z.object({
	threads: z.array(
		z.object({
			tweets: z.array(
				z.object({
					content: z.string(),
				}),
			),
		}),
	),
});

// Types for the generated content
type LinkedInPostsData = z.infer<typeof LinkedInPostSchema>;
type TwitterThreadsData = z.infer<typeof TwitterThreadSchema>;

// Constants
const DEFAULT_LINKEDIN_POSTS_COUNT = 3;
const DEFAULT_TWITTER_THREADS_COUNT = 2;
const DEFAULT_TWEETS_PER_THREAD = 3;

export default async function CopywriterAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	try {
		// Extract request data
		const data = req.data.json as Record<string, unknown>;
		ctx.logger.info(
			"Copywriter: Processing campaign %s on topic: %s",
			data.campaignId,
			data.topic,
		);

		// Validate required fields
		if (!data.campaignId) {
			ctx.logger.error("Missing required field: campaignId");
			return resp.json({
				error: "Missing required field: campaignId",
				status: "error",
			});
		}

		// Validate campaign ID
		const campaignId = data.campaignId as string;
		if (
			!campaignId ||
			typeof campaignId !== "string" ||
			campaignId.trim() === ""
		) {
			ctx.logger.error("Invalid campaign ID: %s", campaignId);
			return resp.json({
				error: "Invalid campaign ID",
				status: "error",
			});
		}

		// Get the campaign from KV store
		const campaign = await getCampaign(ctx, campaignId);

		if (!campaign) {
			return resp.json({
				error: `Campaign not found with ID: ${campaignId}`,
				status: "error",
			});
		}

		// Update campaign status to writing
		await updateCampaignStatus(ctx, campaign.id, "writing");

		let research: ResearchResults;
		const topic = campaign.topic;

		// Determine if we have research data or simple topic/description
		if (data.research) {
			// Use provided research data
			research = data.research as ResearchResults;
		} else if (data.topic) {
			// Create minimal research from topic/description
			const description = data.description || campaign.description || "";

			research = {
				title: data.topic as string,
				description: description as string,
				longFormDescription: description as string,
				tags: [topic.replace(/\s+/g, "").toLowerCase()],
				keyInsights: [(description as string) || `Key points about ${topic}`],
				sources: [],
			};
		} else {
			// Use campaign data as fallback
			research = {
				title: campaign.topic,
				description: campaign.description || "",
				longFormDescription: campaign.description || "",
				tags: [campaign.topic.replace(/\s+/g, "").toLowerCase()],
				keyInsights: [
					campaign.description || `Key points about ${campaign.topic}`,
				],
				sources: [],
			};
		}

		// Generate content
		ctx.logger.info("Generating content for campaign: %s", campaign.id);

		// Generate LinkedIn posts
		const linkedInPosts = await generateLinkedInPosts(
			research,
			topic,
			DEFAULT_LINKEDIN_POSTS_COUNT,
			ctx,
		);

		// Generate Twitter threads
		const twitterThreads = await generateTwitterThreads(
			research,
			topic,
			DEFAULT_TWITTER_THREADS_COUNT,
			DEFAULT_TWEETS_PER_THREAD,
			ctx,
		);

		// Create the campaign content object
		const campaignContent: CampaignContent = {
			linkedInPosts,
			twitterThreads,
		};

		// Create a fresh campaign object with just the essential properties
		const updatedCampaign: Campaign = {
			id: campaign.id,
			topic: campaign.topic,
			description: campaign.description,
			publishDate: campaign.publishDate,
			status: campaign.status || "writing",
			createdAt: campaign.createdAt,
			updatedAt: new Date().toISOString(),
			research: campaign.research,
			content: campaignContent,
		};

		// Save the campaign with content
		const saveSuccess = await saveCampaign(ctx, updatedCampaign);

		if (!saveSuccess) {
			ctx.logger.error("Failed to save campaign with generated content");
			return resp.json({
				error: "Failed to save campaign with generated content",
				status: "error",
			});
		}

		// Hand off to the scheduler agent
		const schedulerPayload = {
			campaignId: updatedCampaign.id,
			publishDate: updatedCampaign.publishDate || null,
		};

		ctx.logger.info("Handing off to scheduler for campaign: %s", campaign.id);
		return resp.handoff({ name: "scheduler" }, { data: schedulerPayload });
	} catch (error) {
		ctx.logger.error("Error in Copywriter Agent: %s", error);
		return resp.json({
			error: "An unexpected error occurred",
			message: error instanceof Error ? error.message : String(error),
			status: "error",
		});
	}
}

/**
 * Generate LinkedIn posts based on research
 */
async function generateLinkedInPosts(
	research: ResearchResults,
	topic: string,
	count: number,
	ctx: AgentContext,
): Promise<Post[]> {
	try {
		// Keeping only one log message for content generation tracking
		ctx.logger.debug("Generating %d LinkedIn posts", count);

		const result = await generateObject({
			model: anthropic("claude-3-7-sonnet-20250219"),
			schema: LinkedInPostSchema,
			system:
				"You are a professional LinkedIn content creator who specializes in creating engaging, viral posts that drive engagement and shares.",
			prompt: `
			Create ${count} unique LinkedIn posts based on the following research about "${topic}":
			
			TITLE: ${research.title}
			
			DESCRIPTION: ${research.description}
			
			LONG FORM DESCRIPTION:
			${research.longFormDescription}
			
			KEY INSIGHTS:
			${research.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n")}
			
			TAGS:
			${research.tags.join(", ")}
			
			Guidelines for LinkedIn posts:
			1. Each post should be 1200-1500 characters (LinkedIn's optimal length)
			2. Include relevant hashtags (3-5) at the end of each post
			3. Focus on providing value and insights rather than being promotional
			4. Use a professional yet conversational tone
			5. Include a clear call-to-action
			6. Each post should cover a different aspect of the topic
			7. Use line breaks effectively for readability
			8. Start with a hook to capture attention

			IMPORTANT: Try not to use latinate words where simple, anglo-saxon based words exist.
			This helps with better understanding.
			
			Format your response as an array of posts, each with content and relevant hashtags.
			`,
		});

		// Convert the generated posts to our Post interface
		const linkedInPostsData: LinkedInPostsData = result.object;

		return linkedInPostsData.posts.map((post, index) => {
			// Add hashtags to content if they exist
			const content =
				post.hashtags && post.hashtags.length > 0
					? `${post.content}\n\n${post.hashtags.map((tag) => `#${tag}`).join(" ")}`
					: post.content;

			return {
				platform: "linkedin",
				content,
				media: [], // No media for now
			};
		});
	} catch (error) {
		ctx.logger.error("Error generating LinkedIn posts: %s", error);
		// Return a fallback post if generation fails
		return [
			{
				platform: "linkedin",
				content: `I've been researching ${topic} recently, and wanted to share some insights with my network.\n\n${research.description}\n\n#${topic.replace(/\s+/g, "")}`,
				media: [],
			},
		];
	}
}

/**
 * Generate Twitter threads based on research
 */
async function generateTwitterThreads(
	research: ResearchResults,
	topic: string,
	threadCount: number,
	tweetsPerThread: number,
	ctx: AgentContext,
): Promise<Thread[]> {
	try {
		// Keeping only one log message for content generation tracking
		ctx.logger.debug("Generating %d Twitter threads", threadCount);

		const result = await generateObject({
			model: anthropic("claude-3-7-sonnet-20250219"),
			schema: TwitterThreadSchema,
			system:
				"You are a professional Twitter content creator who specializes in creating engaging, viral threads that drive engagement and shares.",
			prompt: `
			Create ${threadCount} unique Twitter threads, each with ${tweetsPerThread} tweets, based on the following research about "${topic}":
			
			TITLE: ${research.title}
			
			DESCRIPTION: ${research.description}
			
			LONG FORM DESCRIPTION:
			${research.longFormDescription}
			
			KEY INSIGHTS:
			${research.keyInsights.map((insight, i) => `${i + 1}. ${insight}`).join("\n")}
			
			TAGS:
			${research.tags.join(", ")}
			
			Guidelines for Twitter threads:
			1. Each tweet should be under 280 characters
			2. The first tweet should have a strong hook to capture attention
			3. Each thread should tell a cohesive story or explore a single aspect of the topic
			4. Make each tweet able to stand on its own while contributing to the overall thread
			5. Incorporate relevant hashtags but use them sparingly (1-2 per thread, not every tweet)
			6. End with a call-to-action
			7. Assume the tweets will be numbered automatically (don't include "1/5" type numbering)

			IMPORTANT: Try not to use latinate words where simple, anglo-saxon based words exist.
			This helps with better understanding.
			
			Format your response as an array of threads, each containing an array of tweets with their content.
			`,
		});

		// Convert the generated threads to our Thread interface
		const twitterThreadsData: TwitterThreadsData = result.object;

		return twitterThreadsData.threads.map((thread) => {
			const tweets = thread.tweets.map((tweet) => ({
				platform: "twitter" as const,
				content: tweet.content,
				media: [], // No media for now
			}));

			return {
				tweets,
				scheduledDate: undefined, // To be set by scheduler
			};
		});
	} catch (error) {
		ctx.logger.error("Error generating Twitter threads: %s", error);
		// Return a fallback thread if generation fails
		return [
			{
				tweets: [
					{
						platform: "twitter",
						content: `I've been researching ${topic} recently, and wanted to share some insights with you all in this thread. 👇`,
						media: [],
					},
					{
						platform: "twitter",
						content: research.description,
						media: [],
					},
					{
						platform: "twitter",
						content:
							research.keyInsights[0] ||
							`${topic} is a key area everyone should be thinking about.`,
						media: [],
					},
					{
						platform: "twitter",
						content: `Want to learn more about ${topic}? Follow me for more insights on content marketing and digital strategy.`,
						media: [],
					},
				],
				scheduledDate: undefined,
			},
		];
	}
}
