import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import {
	getCampaign,
	updateCampaignStatus,
	saveCampaign,
} from "../../utils/kv-store";
import { getValidDate, incrementDateByDays } from "../../utils/date-utils";
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
		ctx.logger.info("Initial scheduling date: %s", scheduledDateString);

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
	let dayIncrement = 0;

	// Schedule LinkedIn posts if they exist
	if (content?.linkedInPosts?.length) {
		ctx.logger.info(
			"Scheduling %d LinkedIn posts with incremented dates",
			content.linkedInPosts.length,
		);

		// Generate a date for each LinkedIn post
		const linkedInDates: string[] = [];
		for (let i = 0; i < content.linkedInPosts.length; i++) {
			const postDate = incrementDateByDays(scheduledDate, dayIncrement);
			linkedInDates.push(postDate);
			dayIncrement++;
		}

		const linkedInResults = await scheduleLinkedInPosts(
			content.linkedInPosts,
			linkedInDates,
			ctx,
			apiKey,
		);

		schedulingInfo.scheduledPosts.push(...linkedInResults);
	}

	// Schedule Twitter threads if they exist
	if (content?.twitterThreads?.length) {
		ctx.logger.info(
			"Scheduling %d Twitter threads with incremented dates",
			content.twitterThreads.length,
		);

		// Generate a date for each Twitter thread
		const twitterDates: string[] = [];
		for (let i = 0; i < content.twitterThreads.length; i++) {
			const threadDate = incrementDateByDays(scheduledDate, dayIncrement);
			twitterDates.push(threadDate);
			dayIncrement++;
		}

		const twitterResults = await scheduleTwitterThreads(
			content.twitterThreads,
			twitterDates,
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
	scheduledDates: string[],
	ctx: AgentContext,
	apiKey: string,
): Promise<SchedulingInfo["scheduledPosts"]> {
	const scheduledPosts: SchedulingInfo["scheduledPosts"] = [];

	try {
		// Sanity check - ensure we have dates to work with
		if (scheduledDates.length === 0) {
			ctx.logger.error("No scheduled dates available for LinkedIn posts");
			return scheduledPosts;
		}

		// Process each post
		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			if (!post) continue;

			// Determine the date for this post
			const dateIndex = Math.min(i, scheduledDates.length - 1);
			const postDate = scheduledDates[dateIndex];

			if (dateIndex !== i) {
				ctx.logger.warn("Using fallback date for LinkedIn post %d", i);
			}

			try {
				// Ensure the post has content before proceeding
				if (!post.content) {
					ctx.logger.error("LinkedIn post %d has no content", i);
					continue;
				}

				// Call the Typefully API to create a draft and schedule it
				const typefullyId = await createTypefullyDraft(
					post.content,
					"linkedin",
					apiKey,
					ctx,
					postDate,
				);

				// Add to the scheduled posts
				scheduledPosts.push({
					postId: `linkedin-post-${i}`,
					typefullyId,
					scheduledDate: postDate || getValidDate("tomorrow"),
					status: "scheduled",
				});

				// Update the post with scheduling information
				post.scheduledDate = postDate || getValidDate("tomorrow");
				post.typefullyId = typefullyId;
			} catch (error) {
				ctx.logger.error("Failed to schedule LinkedIn post: %s", error);

				scheduledPosts.push({
					postId: `linkedin-post-${i}`,
					typefullyId: "",
					scheduledDate: postDate || getValidDate("tomorrow"),
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
	scheduledDates: string[],
	ctx: AgentContext,
	apiKey: string,
): Promise<SchedulingInfo["scheduledPosts"]> {
	const scheduledPosts: SchedulingInfo["scheduledPosts"] = [];

	try {
		// Sanity check - ensure we have dates to work with
		if (scheduledDates.length === 0) {
			ctx.logger.error("No scheduled dates available for Twitter threads");
			return scheduledPosts;
		}

		// Process each thread
		for (let i = 0; i < threads.length; i++) {
			const thread = threads[i];
			if (!thread) continue;

			// Determine the date for this thread
			const dateIndex = Math.min(i, scheduledDates.length - 1);
			const postDate = scheduledDates[dateIndex];

			if (dateIndex !== i) {
				ctx.logger.warn("Using fallback date for Twitter thread %d", i);
			}

			try {
				// Ensure the thread has tweets before proceeding
				if (!thread.tweets?.length) {
					ctx.logger.error("Twitter thread %d has no tweets", i);
					continue;
				}

				// Convert the thread to a string for the API with 4 consecutive newlines to split tweets
				const threadContent = thread.tweets
					.map((tweet) => tweet.content)
					.join("\n\n\n\n");

				// Call the Typefully API to create a draft and schedule it
				const typefullyId = await createTypefullyDraft(
					threadContent,
					"twitter",
					apiKey,
					ctx,
					postDate,
					true, // Enable threadify for Twitter threads
				);

				// Add to the scheduled posts
				scheduledPosts.push({
					postId: `twitter-thread-${i}`,
					typefullyId,
					scheduledDate: postDate || getValidDate("tomorrow"),
					status: "scheduled",
				});

				// Update the thread with scheduling information
				thread.scheduledDate = postDate || getValidDate("tomorrow");
				thread.typefullyId = typefullyId;
			} catch (error) {
				ctx.logger.error("Failed to schedule Twitter thread: %s", error);

				scheduledPosts.push({
					postId: `twitter-thread-${i}`,
					typefullyId: "",
					scheduledDate: postDate || getValidDate("tomorrow"),
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
	apiKey: string,
	ctx: AgentContext,
	scheduledDate?: string,
	threadify = false,
): Promise<string> {
	// If no date is provided, set a default date one day in the future
	const finalDate = scheduledDate || getValidDate("tomorrow");

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
			"schedule-date": finalDate,
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
	ctx.logger.info(
		"Typefully draft created with ID: %s for date: %s",
		responseData.id,
		finalDate,
	);
	return responseData.id;
}
