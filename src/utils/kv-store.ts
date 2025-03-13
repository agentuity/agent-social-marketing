import type { AgentContext } from "@agentuity/sdk";
import type { Campaign } from "../types";

// Constants
const CAMPAIGNS_STORE = "campaigns";
const CAMPAIGNS_INDEX_KEY = "campaigns_index";
const CAMPAIGNS_INDEX_STORE = "campaigns_meta";

// Define the campaign index structure
interface CampaignIndex {
	campaignIds: string[];
}

/**
 * Validates a campaign ID
 */
function isValidId(id: unknown): id is string {
	return Boolean(id && typeof id === "string" && id.trim() !== "");
}

/**
 * Safe access to the campaign index
 */
async function getCampaignIndex(ctx: AgentContext): Promise<string[]> {
	const result = await ctx.kv.get(CAMPAIGNS_INDEX_STORE, CAMPAIGNS_INDEX_KEY);

	// Type handling for the JSON data
	const indexData = result?.data?.json as unknown;
	const typedIndex = indexData as CampaignIndex | undefined;

	return typedIndex?.campaignIds?.filter(isValidId) || [];
}

/**
 * Updates the campaign index with a new ID
 */
async function updateCampaignIndex(
	ctx: AgentContext,
	campaignId: string,
): Promise<void> {
	if (!isValidId(campaignId)) {
		ctx.logger.error("Invalid campaign ID for indexing");
		return;
	}

	const campaignIds = await getCampaignIndex(ctx);

	// Only add if not already present
	if (!campaignIds.includes(campaignId)) {
		campaignIds.push(campaignId);
		await ctx.kv.set(CAMPAIGNS_INDEX_STORE, CAMPAIGNS_INDEX_KEY, {
			campaignIds,
		});
		ctx.logger.debug("Added campaign to index: %s", campaignId);
	}
}

/**
 * Get a campaign by ID
 */
export async function getCampaign(
	ctx: AgentContext,
	id: string,
): Promise<Campaign | null> {
	if (!isValidId(id)) {
		ctx.logger.error("Invalid campaign ID provided");
		return null;
	}

	try {
		const result = await ctx.kv.get(CAMPAIGNS_STORE, id);

		// Handle type conversion properly
		const campaignData = result?.data?.json as unknown;
		const campaign = campaignData as Campaign | undefined;

		if (!campaign) {
			ctx.logger.debug("No campaign found with ID: %s", id);
			return null;
		}

		// Ensure ID consistency
		if (!campaign.id) {
			campaign.id = id;
		}

		return campaign;
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
	if (!campaign || !isValidId(campaign.id)) {
		ctx.logger.error("Invalid campaign provided for saving");
		return false;
	}

	try {
		// Convert to JSON-compatible format to ensure compatibility with KV store
		const campaignJson = JSON.parse(JSON.stringify(campaign));

		// Save campaign to KV store
		await ctx.kv.set(CAMPAIGNS_STORE, campaign.id, campaignJson);

		// Update index
		await updateCampaignIndex(ctx, campaign.id);

		ctx.logger.debug("Campaign saved: %s", campaign.id);
		return true;
	} catch (error) {
		ctx.logger.error("Failed to save campaign %s: %s", campaign.id, error);
		return false;
	}
}

/**
 * List all campaigns
 */
export async function listCampaigns(ctx: AgentContext): Promise<Campaign[]> {
	try {
		const campaignIds = await getCampaignIndex(ctx);

		if (campaignIds.length === 0) {
			return [];
		}

		// Fetch all campaigns in parallel
		const campaignPromises = campaignIds.map((id) => getCampaign(ctx, id));
		const campaigns = await Promise.all(campaignPromises);

		// Filter out null results
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
	if (!topic?.trim()) {
		ctx.logger.warn("Empty topic provided to findCampaignsByTopic");
		return [];
	}

	try {
		const allCampaigns = await listCampaigns(ctx);
		const searchTerm = topic.toLowerCase().trim();

		// First check for exact matches
		const exactMatches = allCampaigns.filter(
			(campaign) => campaign.topic.toLowerCase().trim() === searchTerm,
		);

		// Return exact matches if found, otherwise partial matches
		return exactMatches.length > 0
			? exactMatches
			: allCampaigns.filter((campaign) =>
					campaign.topic.toLowerCase().includes(searchTerm),
				);
	} catch (error) {
		ctx.logger.error("Failed to find campaigns by topic: %s", error);
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
	if (!topic?.trim()) {
		ctx.logger.error("Invalid topic provided for campaign creation");
		throw new Error("Invalid topic provided");
	}

	const campaignId = `campaign-${Date.now()}`;
	const now = new Date().toISOString();

	// Create the campaign object
	const campaign: Campaign = {
		id: campaignId,
		topic,
		description,
		publishDate,
		status: "planning",
		createdAt: now,
		updatedAt: now,
	};

	ctx.logger.info("Creating campaign for topic: %s", topic);

	// Save the campaign
	const saved = await saveCampaign(ctx, campaign);
	if (!saved) {
		throw new Error("Failed to save campaign");
	}

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
		ctx.logger.warn("Cannot update status: campaign not found: %s", campaignId);
		return null;
	}

	campaign.status = status;
	campaign.updatedAt = new Date().toISOString();

	ctx.logger.info("Updating campaign status: %s → %s", campaignId, status);
	await saveCampaign(ctx, campaign);
	return campaign;
}
