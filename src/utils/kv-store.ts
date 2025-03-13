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
		if (!id || typeof id !== "string" || id.trim() === "") {
			ctx.logger.error("Invalid campaign ID provided to getCampaign: %s", id);
			return null;
		}

		// Using debug level for routine operations
		ctx.logger.debug("Getting campaign with ID: %s", id);
		const result = await ctx.kv.get(CAMPAIGNS_STORE, id);

		if (!result) {
			ctx.logger.warn("No campaign found with ID: %s", id);
			return null;
		}

		// Access the campaign data from the correct path
		const campaignData = result.data?.json as unknown;

		if (!campaignData) {
			ctx.logger.error("Retrieved data is null for ID: %s", id);
			return null;
		}

		const campaign = campaignData as Campaign;

		if (!campaign || typeof campaign !== "object") {
			ctx.logger.error("Retrieved campaign is not an object for ID: %s", id);
			return null;
		}

		// Ensure the campaign has the required properties
		if (!campaign.id) {
			ctx.logger.error("Retrieved campaign missing ID property for ID: %s", id);
			// Try to recover by setting the ID
			campaign.id = id;
		}

		if (!campaign.topic) {
			ctx.logger.error(
				"Retrieved campaign missing topic property for ID: %s",
				id,
			);
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
	try {
		// Validate the campaign ID
		if (
			!campaign ||
			!campaign.id ||
			typeof campaign.id !== "string" ||
			campaign.id.trim() === ""
		) {
			ctx.logger.error(
				"Invalid campaign ID provided for saving: %s",
				campaign?.id,
			);
			return false;
		}

		// Debug-level log for routine operations
		ctx.logger.debug("Saving campaign: %s", campaign.id);

		// Create a sanitized version of the campaign
		const sanitizedCampaign: Campaign = {
			id: campaign.id,
			topic: campaign.topic,
			description: campaign.description,
			publishDate: campaign.publishDate,
			status: campaign.status,
			createdAt: campaign.createdAt,
			updatedAt: campaign.updatedAt,
		};

		// Add optional properties if they exist
		if (campaign.research) {
			sanitizedCampaign.research = campaign.research;
		}

		if (campaign.content) {
			sanitizedCampaign.content = campaign.content;
		}

		if (campaign.schedulingInfo) {
			sanitizedCampaign.schedulingInfo = campaign.schedulingInfo;
		}
		// Convert to a JSON object that can be safely stored
		const jsonData = JSON.parse(JSON.stringify(sanitizedCampaign));

		// Set the campaign in the KV store
		await ctx.kv.set(CAMPAIGNS_STORE, sanitizedCampaign.id, jsonData);

		// Update the campaign index to include this campaign ID
		await updateCampaignIndex(ctx, sanitizedCampaign.id);

		return true;
	} catch (error) {
		ctx.logger.error("Failed to save campaign %s: %s", campaign?.id, error);
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
		// Validate campaign ID
		if (
			!campaignId ||
			typeof campaignId !== "string" ||
			campaignId.trim() === ""
		) {
			ctx.logger.error("Invalid campaign ID for indexing: %s", campaignId);
			return false;
		}

		// Get the current index
		const result = await ctx.kv.get(CAMPAIGNS_INDEX_STORE, CAMPAIGNS_INDEX_KEY);
		let campaignIds: string[] = [];

		// If we have an existing index, use it
		if (result?.data?.json) {
			const indexDataRaw = result.data.json as unknown;
			const indexData = indexDataRaw as CampaignIndex;

			if (indexData?.campaignIds && Array.isArray(indexData.campaignIds)) {
				// Filter out any null or invalid IDs
				campaignIds = indexData.campaignIds.filter(
					(id: string): id is string =>
						typeof id === "string" && id.trim() !== "",
				);
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
		if (!result?.data?.json) {
			return [];
		}

		// Extract campaign IDs
		const indexData = result.data.json as unknown as CampaignIndex;
		if (
			!indexData?.campaignIds ||
			!Array.isArray(indexData.campaignIds) ||
			indexData.campaignIds.length === 0
		) {
			return [];
		}

		// Filter out any null or invalid IDs
		const campaignIds = indexData.campaignIds.filter(
			(id): id is string => typeof id === "string" && id.trim() !== "",
		);

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
		// Validate the topic
		if (!topic || topic.trim() === "") {
			ctx.logger.warn("Empty topic provided to findCampaignsByTopic");
			return [];
		}

		const allCampaigns = await listCampaigns(ctx);
		const searchTerm = topic.toLowerCase().trim();

		// Improve matching by removing common words and performing exact matching first
		// First check for exact matches (normalized)
		const exactMatches = allCampaigns.filter(
			(campaign) => campaign.topic.toLowerCase().trim() === searchTerm,
		);

		// If we have exact matches, return those
		if (exactMatches.length > 0) {
			return exactMatches;
		}

		// Otherwise, look for partial matches
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
	// Validate topic
	if (!topic || topic.trim() === "") {
		ctx.logger.error("Invalid topic provided for campaign creation");
		throw new Error("Invalid topic provided for campaign creation");
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

	// Log the campaign creation
	ctx.logger.info("Creating campaign: %s for topic: %s", campaignId, topic);

	// Save the campaign to KV store
	const saveResult = await saveCampaign(ctx, campaign);

	if (!saveResult) {
		ctx.logger.error("Failed to save new campaign: %s", campaignId);
		throw new Error(`Failed to save campaign: ${campaignId}`);
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
		return null;
	}

	campaign.status = status;
	campaign.updatedAt = new Date().toISOString();

	ctx.logger.debug("Updating campaign status: %s → %s", campaignId, status);
	await saveCampaign(ctx, campaign);
	return campaign;
}
