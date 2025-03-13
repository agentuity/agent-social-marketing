import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import {
	getCampaign,
	updateCampaignStatus,
	saveCampaign,
} from "../../utils/kv-store";
import { getValidDate } from "../../utils/date-utils";
import { errorResponse, successResponse } from "../../utils/response-utils";
import type {
	Campaign,
	SchedulerRequest,
	Post,
	Thread,
	SchedulingInfo,
} from "../../types";

// Typefully API settings
const TYPEFULLY_API_URL = "https://api.typefully.com/v1";

export default async function SchedulerAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	try {
		// Extract and validate request data
		const { campaignId, publishDate } = req.data
			.json as Partial<SchedulerRequest>;

		ctx.logger.info("Scheduler: Processing campaign %s", campaignId);

		// Validate campaign ID
		if (!campaignId?.trim()) {
			return resp.json(errorResponse("Campaign ID is required"));
		}

		// Get the campaign from KV store
		const campaign = await getCampaign(ctx, campaignId);
		if (!campaign) {
			return resp.json(
				errorResponse(`Campaign not found with ID: ${campaignId}`),
			);
		}

		// Check if we have content to schedule
		if (!campaign.content) {
			return resp.json(errorResponse("Campaign has no content to schedule"));
		}

		// Verify API key is available
		const apiKey = process.env.TYPEFULLY_API_KEY;
		if (!apiKey) {
			return resp.json(
				errorResponse("Missing TYPEFULLY_API_KEY in environment variables"),
			);
		}

		// Update campaign status to scheduling
		await updateCampaignStatus(ctx, campaignId, "scheduling");

		// Get a valid future date for scheduling
		const scheduledDateString = getValidDate(publishDate);
		ctx.logger.info("Scheduling for date: %s", scheduledDateString);

		// Initialize scheduling info
		const schedulingInfo: SchedulingInfo = {
			scheduledPosts: [],
		};

		// Schedule content
		await scheduleContent(
			campaign,
			scheduledDateString,
			schedulingInfo,
			ctx,
			apiKey,
		);

		// Update campaign with scheduling info
		campaign.schedulingInfo = schedulingInfo;
		campaign.updatedAt = new Date().toISOString();

		// Save the campaign with scheduling info
		const saveResult = await saveCampaign(ctx, campaign);
		if (!saveResult) {
			return resp.json(
				errorResponse("Failed to save campaign with scheduling info"),
			);
		}

		// Update campaign status to active
		await updateCampaignStatus(ctx, campaignId, "active");

		// Return the scheduling results
		return resp.json(
			successResponse({
				campaignId,
				scheduledPosts: schedulingInfo.scheduledPosts.length,
				message: `Successfully scheduled ${schedulingInfo.scheduledPosts.length} posts for campaign`,
			}),
		);
	} catch (error) {
		ctx.logger.error("Error in Scheduler Agent: %s", error);
		return resp.json(
			errorResponse(
				error instanceof Error ? error.message : "An unexpected error occurred",
			),
		);
	}
}

/**
 * Schedule content from a campaign
 */
async function scheduleContent(
	campaign: Campaign,
	scheduledDate: string,
	schedulingInfo: SchedulingInfo,
	ctx: AgentContext,
	apiKey: string,
): Promise<void> {
	const { content } = campaign;

	// Schedule LinkedIn posts if they exist
	if (content?.linkedInPosts?.length) {
		ctx.logger.info(
			"Scheduling %d LinkedIn posts",
			content.linkedInPosts.length,
		);

		const linkedInResults = await scheduleLinkedInPosts(
			content.linkedInPosts,
			scheduledDate,
			ctx,
			apiKey,
		);

		schedulingInfo.scheduledPosts.push(...linkedInResults);
	}

	// Schedule Twitter threads if they exist
	if (content?.twitterThreads?.length) {
		ctx.logger.info(
			"Scheduling %d Twitter threads",
			content.twitterThreads.length,
		);

		const twitterResults = await scheduleTwitterThreads(
			content.twitterThreads,
			scheduledDate,
			ctx,
			apiKey,
		);

		schedulingInfo.scheduledPosts.push(...twitterResults);
	}
}

/**
 * Schedule LinkedIn posts
 */
async function scheduleLinkedInPosts(
	posts: Post[],
	scheduledDate: string,
	ctx: AgentContext,
	apiKey: string,
): Promise<SchedulingInfo["scheduledPosts"]> {
	const scheduledPosts: SchedulingInfo["scheduledPosts"] = [];

	try {
		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			if (!post) continue;

			try {
				// Call the Typefully API to create a draft and schedule it
				const typefullyId = await createTypefullyDraft(
					post.content,
					"linkedin",
					scheduledDate,
					apiKey,
					ctx,
				);

				// Add to the scheduled posts
				scheduledPosts.push({
					postId: `linkedin-post-${i}`,
					typefullyId,
					scheduledDate,
					status: "scheduled",
				});

				// Update the post with scheduling information
				post.scheduledDate = scheduledDate;
				post.typefullyId = typefullyId;
			} catch (error) {
				ctx.logger.error("Failed to schedule LinkedIn post: %s", error);

				scheduledPosts.push({
					postId: `linkedin-post-${i}`,
					typefullyId: "",
					scheduledDate,
					status: "failed",
				});
			}
		}
	} catch (error) {
		ctx.logger.error("Error scheduling LinkedIn posts: %s", error);
	}

	return scheduledPosts;
}

/**
 * Schedule Twitter threads
 */
async function scheduleTwitterThreads(
	threads: Thread[],
	scheduledDate: string,
	ctx: AgentContext,
	apiKey: string,
): Promise<SchedulingInfo["scheduledPosts"]> {
	const scheduledPosts: SchedulingInfo["scheduledPosts"] = [];

	try {
		for (let i = 0; i < threads.length; i++) {
			const thread = threads[i];
			if (!thread) continue;

			try {
				// Convert the thread to a string for the API with 4 consecutive newlines to split tweets
				const threadContent = thread.tweets
					.map((tweet) => tweet.content)
					.join("\n\n\n\n");

				// Call the Typefully API to create a draft and schedule it
				const typefullyId = await createTypefullyDraft(
					threadContent,
					"twitter",
					scheduledDate,
					apiKey,
					ctx,
					true, // Enable threadify for Twitter threads
				);

				// Add to the scheduled posts
				scheduledPosts.push({
					postId: `twitter-thread-${i}`,
					typefullyId,
					scheduledDate,
					status: "scheduled",
				});

				// Update the thread with scheduling information
				thread.scheduledDate = scheduledDate;
				thread.typefullyId = typefullyId;
			} catch (error) {
				ctx.logger.error("Failed to schedule Twitter thread: %s", error);

				scheduledPosts.push({
					postId: `twitter-thread-${i}`,
					typefullyId: "",
					scheduledDate,
					status: "failed",
				});
			}
		}
	} catch (error) {
		ctx.logger.error("Error scheduling Twitter threads: %s", error);
	}

	return scheduledPosts;
}

/**
 * Create a draft and schedule it using the Typefully API
 */
async function createTypefullyDraft(
	content: string,
	platform: "twitter" | "linkedin",
	scheduledDate: string,
	apiKey: string,
	ctx: AgentContext,
	threadify = false,
): Promise<string> {
	const response = await fetch(`${TYPEFULLY_API_URL}/drafts/`, {
		method: "POST",
		headers: {
			"X-API-KEY": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			content,
			platform,
			threadify,
			"schedule-date": scheduledDate,
			auto_retweet_enabled: false,
			auto_plug_enabled: false,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to create/schedule draft: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}

	const responseData = (await response.json()) as { id: string };
	ctx.logger.info("Typefully draft created with ID: %s", responseData.id);
	return responseData.id;
}
