import type { AgentContext } from "@agentuity/sdk";
import type { Campaign } from "../types";

// Constants
const CAMPAIGNS_STORE = "campaigns";
const CAMPAIGNS_INDEX_KEY = "campaigns_index"; // Key for the index
const CAMPAIGNS_INDEX_STORE = "campaigns_meta"; // Store for the campaign index

// Define the campaign index structure
interface CampaignIndex {
	campaignIds: string[];
}

/**
 * Get a campaign by ID
 */
export async function getCampaign(
	ctx: AgentContext,
	id: string,
): Promise<Campaign | null> {
	try {
		const result = await ctx.kv.get(CAMPAIGNS_STORE, id);
		if (!result) return null;
		return result as unknown as Campaign;
	} catch (error) {
		ctx.logger.error("Failed to get campaign %s: %s", id, error);
		return null;
	}
}

/**
 * Save a campaign
 */
export async function saveCampaign(
	ctx: AgentContext,
	campaign: Campaign,
): Promise<boolean> {
	try {
		// Convert campaign to JSON string then parse it to ensure it's a proper JSON object
		const jsonData = JSON.parse(JSON.stringify(campaign)); // weird TS hack
		await ctx.kv.set(CAMPAIGNS_STORE, campaign.id, jsonData);

		// Update the campaign index to include this campaign ID
		await updateCampaignIndex(ctx, campaign.id);

		return true;
	} catch (error) {
		ctx.logger.error("Failed to save campaign %s: %s", campaign.id, error);
		return false;
	}
}

/**
 * Update the campaign index to include a campaign ID
 */
async function updateCampaignIndex(
	ctx: AgentContext,
	campaignId: string,
): Promise<boolean> {
	try {
		// Get the current index
		const result = await ctx.kv.get(CAMPAIGNS_INDEX_STORE, CAMPAIGNS_INDEX_KEY);
		let campaignIds: string[] = [];

		// If we have an existing index, use it
		if (result && typeof result === "object" && "campaignIds" in result) {
			const typedResult = result as { campaignIds: unknown };
			if (Array.isArray(typedResult.campaignIds)) {
				campaignIds = typedResult.campaignIds;
			}
		}

		// Check if campaign ID is already in the index
		if (!campaignIds.includes(campaignId)) {
			// Add the campaign ID to the index
			campaignIds.push(campaignId);
			await ctx.kv.set(CAMPAIGNS_INDEX_STORE, CAMPAIGNS_INDEX_KEY, {
				campaignIds,
			});
		}

		return true;
	} catch (error) {
		ctx.logger.error("Failed to update campaign index: %s", error);
		return false;
	}
}

/**
 * List all campaigns
 */
export async function listCampaigns(ctx: AgentContext): Promise<Campaign[]> {
	try {
		// Get the campaign index
		const result = await ctx.kv.get(CAMPAIGNS_INDEX_STORE, CAMPAIGNS_INDEX_KEY);

		// If there's no index or the index is invalid, return an empty array
		if (!result || typeof result !== "object" || !("campaignIds" in result)) {
			return [];
		}

		// Extract campaign IDs
		const typedResult = result as { campaignIds: unknown };
		if (
			!Array.isArray(typedResult.campaignIds) ||
			typedResult.campaignIds.length === 0
		) {
			return [];
		}

		const campaignIds = typedResult.campaignIds as string[];

		// Fetch all campaigns by ID in parallel
		const campaignPromises = campaignIds.map((id) => getCampaign(ctx, id));
		const campaigns = await Promise.all(campaignPromises);

		// Filter out null results (campaigns that might have been deleted)
		return campaigns.filter(
			(campaign): campaign is Campaign => campaign !== null,
		);
	} catch (error) {
		ctx.logger.error("Failed to list campaigns: %s", error);
		return [];
	}
}

/**
 * Find campaigns by topic (case-insensitive partial match)
 */
export async function findCampaignsByTopic(
	ctx: AgentContext,
	topic: string,
): Promise<Campaign[]> {
	try {
		const allCampaigns = await listCampaigns(ctx);
		const searchTerm = topic.toLowerCase();

		return allCampaigns.filter((campaign) =>
			campaign.topic.toLowerCase().includes(searchTerm),
		);
	} catch (error) {
		ctx.logger.error("Failed to find campaigns by topic %s: %s", topic, error);
		return [];
	}
}

/**
 * Create a new campaign
 */
export async function createCampaign(
	ctx: AgentContext,
	topic: string,
	description?: string,
	publishDate?: string,
): Promise<Campaign> {
	const now = new Date().toISOString();
	const campaign: Campaign = {
		id: `campaign-${Date.now()}`,
		topic,
		description,
		publishDate,
		status: "planning",
		createdAt: now,
		updatedAt: now,
	};

	await saveCampaign(ctx, campaign);
	return campaign;
}

/**
 * Update a campaign's status
 */
export async function updateCampaignStatus(
	ctx: AgentContext,
	campaignId: string,
	status: Campaign["status"],
): Promise<Campaign | null> {
	const campaign = await getCampaign(ctx, campaignId);

	if (!campaign) {
		return null;
	}

	campaign.status = status;
	campaign.updatedAt = new Date().toISOString();

	await saveCampaign(ctx, campaign);
	return campaign;
}
