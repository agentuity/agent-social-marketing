import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import {
	getCampaign,
	updateCampaignStatus,
	saveCampaign,
} from "../../utils/kv-store";
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
		ctx.logger.info("Content Marketing Scheduler Agent started");

		// Extract request data
		const data = req.data.json as Record<string, unknown>;
		ctx.logger.info("Scheduler Agent received data:", {
			...data,
		});

		// Validate required fields
		if (!data.campaignId) {
			return resp.json({
				error: "Missing required field: campaignId is required",
				status: "error",
			});
		}

		// Get the campaign from KV store
		const campaignId = data.campaignId as string;
		const campaign = await getCampaign(ctx, campaignId);
		if (!campaign) {
			return resp.json({
				error: `Campaign not found with ID: ${campaignId}`,
				status: "error",
			});
		}

		// Check if we have content to schedule
		if (!campaign.content) {
			return resp.json({
				error: "Campaign has no content to schedule",
				status: "error",
			});
		}

		// Check if TYPEFULLY_API_KEY exists in the environment variables
		// Access environment variables through ctx
		const apiKey = process.env.TYPEFULLY_API_KEY;
		if (!apiKey) {
			return resp.json({
				error: "Missing TYPEFULLY_API_KEY in environment variables",
				status: "error",
			});
		}

		// Create a request object with the campaign content
		const request: SchedulerRequest = {
			campaignId,
			content: campaign.content,
			publishDate: data.publishDate as string | undefined,
		};

		// Update campaign status to scheduling
		await updateCampaignStatus(ctx, campaign.id, "scheduling");

		// Calculate the scheduling date
		const schedulingDate = calculateSchedulingDate(request.publishDate);

		// Schedule all the content
		ctx.logger.info("Scheduling content for campaign: %s", campaign.id);

		// Initialize scheduling info
		const schedulingInfo: SchedulingInfo = {
			scheduledPosts: [],
		};

		// Schedule LinkedIn posts
		if (campaign.content.linkedInPosts.length > 0) {
			const linkedInResults = await scheduleLinkedInPosts(
				campaign.content.linkedInPosts,
				schedulingDate,
				ctx,
				apiKey,
			);

			schedulingInfo.scheduledPosts.push(...linkedInResults);
		}

		// Schedule Twitter threads
		if (campaign.content.twitterThreads.length > 0) {
			const twitterResults = await scheduleTwitterThreads(
				campaign.content.twitterThreads,
				schedulingDate,
				ctx,
				apiKey,
			);

			schedulingInfo.scheduledPosts.push(...twitterResults);
		}

		// Update campaign with scheduling info
		campaign.schedulingInfo = schedulingInfo;
		campaign.updatedAt = new Date().toISOString();
		await saveCampaign(ctx, campaign);

		// Update campaign status to active
		await updateCampaignStatus(ctx, campaign.id, "active");

		// Return the scheduling results
		return resp.json({
			campaignId: campaign.id,
			scheduledPosts: schedulingInfo.scheduledPosts.length,
			message: `Successfully scheduled ${schedulingInfo.scheduledPosts.length} posts for campaign`,
			status: "success",
		});
	} catch (error) {
		ctx.logger.error("Error in Scheduler Agent: %s", error);
		return resp.json({
			error: "An unexpected error occurred",
			message: error instanceof Error ? error.message : String(error),
			status: "error",
		});
	}
}

/**
 * Calculate the scheduling date
 */
function calculateSchedulingDate(publishDateStr?: string): Date {
	// Default to publishing one week from now if no date is provided
	return publishDateStr
		? new Date(publishDateStr)
		: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // One week from now
}

/**
 * Schedule LinkedIn posts
 */
async function scheduleLinkedInPosts(
	posts: Post[],
	publishDate: Date,
	ctx: AgentContext,
	apiKey: string,
): Promise<SchedulingInfo["scheduledPosts"]> {
	const scheduledPosts: SchedulingInfo["scheduledPosts"] = [];

	try {
		// For simplicity, schedule all posts on the publish date
		const scheduledDate = publishDate.toISOString();

		for (let i = 0; i < posts.length; i++) {
			const post = posts[i];
			if (!post) continue; // Skip if post is undefined

			ctx.logger.info("Scheduling LinkedIn post for %s", scheduledDate);

			try {
				// Call the Typefully API to create a draft and schedule it
				const typefullyId = await createTypefullyDraft(
					post.content,
					"linkedin", // Specify platform as LinkedIn
					scheduledDate, // Schedule date
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

				// Record the failure
				scheduledPosts.push({
					postId: `linkedin-post-${i}`,
					typefullyId: "",
					scheduledDate,
					status: "failed",
				});
			}
		}

		return scheduledPosts;
	} catch (error) {
		ctx.logger.error("Error scheduling LinkedIn posts: %s", error);
		return scheduledPosts;
	}
}

/**
 * Schedule Twitter threads
 */
async function scheduleTwitterThreads(
	threads: Thread[],
	publishDate: Date,
	ctx: AgentContext,
	apiKey: string,
): Promise<SchedulingInfo["scheduledPosts"]> {
	const scheduledPosts: SchedulingInfo["scheduledPosts"] = [];

	try {
		// For simplicity, schedule all threads on the publish date
		const scheduledDate = publishDate.toISOString();

		for (let i = 0; i < threads.length; i++) {
			const thread = threads[i];
			if (!thread) continue; // Skip if thread is undefined

			ctx.logger.info("Scheduling Twitter thread for %s", scheduledDate);

			try {
				// Convert the thread to a string for the API
				// For Twitter threads, use 4 consecutive newlines to split into tweets
				const threadContent = thread.tweets
					.map((tweet) => tweet.content)
					.join("\n\n\n\n");

				// Call the Typefully API to create a draft and schedule it
				const typefullyId = await createTypefullyDraft(
					threadContent,
					"twitter", // Specify platform as Twitter
					scheduledDate, // Schedule date
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

				// Record the failure
				scheduledPosts.push({
					postId: `twitter-thread-${i}`,
					typefullyId: "",
					scheduledDate,
					status: "failed",
				});
			}
		}

		return scheduledPosts;
	} catch (error) {
		ctx.logger.error("Error scheduling Twitter threads: %s", error);
		return scheduledPosts;
	}
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
	ctx.logger.info(
		"Typefully API: Creating and scheduling draft for %s on %s",
		platform,
		scheduledDate,
	);

	try {
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
				auto_retweet_enabled: false, // Optional: enable if needed
				auto_plug_enabled: false, // Optional: enable if needed
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
			"Typefully draft created and scheduled with ID: %s",
			responseData.id,
		);
		return responseData.id;
	} catch (error) {
		ctx.logger.error("Error creating/scheduling Typefully draft: %s", error);
		throw error;
	}
}
