import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject } from "ai";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import {
	getCampaign,
	createCampaign,
	findCampaignsByTopic,
	updateCampaignStatus,
} from "../../utils/kv-store";
import { errorResponse, successResponse } from "../../utils/response-utils";
import type { Campaign, ManagerRequest } from "../../types";

// Define the schema for structured data extraction
const RequestSchema = z.object({
	topic: z.string().min(1, "Topic is required"),
	description: z.string().optional().nullable(),
	publishDate: z.string().optional().nullable(),
	domain: z.string().optional().nullable(),
});

type ExtractedData = z.infer<typeof RequestSchema>;

/**
 * Manager agent for handling content marketing campaign requests
 */
export default async function ManagerAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	// Extract and normalize request data
	const requestData = normalizeRequestData(req);

	// Validate request has a topic
	if (!requestData.topic) {
		ctx.logger.info("Manager: Missing topic in request");
		return resp.json(errorResponse("Missing topic"));
	}

	ctx.logger.info(
		"Manager: Processing request for topic: %s",
		requestData.topic,
	);

	// Extract structured data if we only have a topic
	const request = await enrichRequestData(requestData, ctx);

	// Check for existing campaigns with similar topics
	const existingCampaigns = await findCampaignsByTopic(ctx, request.topic);

	if (existingCampaigns.length > 0) {
		ctx.logger.info(
			"Found %d existing campaigns for topic: %s",
			existingCampaigns.length,
			request.topic,
		);
		return resp.json({
			existingCampaigns: serializeCampaigns(existingCampaigns),
			message: "Found existing campaigns for this topic.",
			status: "existing_found",
		});
	}

	// Create a new campaign
	try {
		// Convert null to undefined for optional parameters
		const description = request.description || undefined;
		const publishDate = request.publishDate || undefined;

		const campaign = await createCampaign(
			ctx,
			request.topic,
			description,
			publishDate,
		);

		if (!campaign?.id) {
			ctx.logger.error(
				"Failed to create campaign for topic: %s",
				request.topic,
			);
			return resp.json(errorResponse("Failed to create campaign"));
		}

		// Get domain - ensure it's a string or null (not undefined) for JSON compatibility
		const source = request.domain || null;

		// Prepare payload for handoff
		const payload = {
			topic: campaign.topic,
			description: campaign.description || null,
			campaignId: campaign.id,
			publishDate: campaign.publishDate || null,
			source,
		};

		ctx.logger.info("Handing off to copywriter for campaign: %s", campaign.id);
		return resp.handoff({ name: "copywriter" }, { data: payload });
	} catch (error) {
		ctx.logger.error("Error creating campaign: %s", error);
		return resp.json(
			errorResponse(
				`Failed to create campaign: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}
}

/**
 * Normalize input data from various request formats
 */
function normalizeRequestData(req: AgentRequest): Partial<ExtractedData> {
	// Initialize variables
	let jsonData: Record<string, unknown> = {};
	let textData = "";

	// Safely parse JSON data from request
	try {
		jsonData = (req.data.json as Record<string, unknown>) || {};
	} catch (jsonError) {
		// If JSON parsing fails, fall back to text
		textData = req.data.text || "";
	}

	// If no text was set from the error handler, get it from req.data.text
	if (!textData) {
		textData = req.data.text || "";
	}

	// Get the topic from either JSON or text
	const topic = ((jsonData.topic as string) || textData).trim();

	return {
		topic,
		description: jsonData.description as string | undefined,
		publishDate: jsonData.publishDate as string | undefined,
		domain: jsonData.domain as string | undefined,
	};
}

/**
 * Enrich request data with AI extraction if needed
 */
async function enrichRequestData(
	data: Partial<ExtractedData>,
	ctx: AgentContext,
): Promise<ExtractedData> {
	// If we already have structured data from JSON, validate and return it
	if (data.topic && (data.description || data.publishDate || data.domain)) {
		try {
			return RequestSchema.parse(data);
		} catch (error) {
			// If validation fails, ensure we at least have a topic
			return { topic: data.topic || "" };
		}
	}

	// Handle freeform text input by extracting structured data
	if (data.topic) {
		try {
			ctx.logger.info("Extracting structured data from freeform text input");

			const result = await generateObject({
				model: groq("llama3-70b-8192"),
				schema: RequestSchema,
				system:
					"You are a helpful assistant that extracts structured information from natural language content marketing requests",
				prompt: `
					Extract structured information from this content marketing request: 
					"${data.topic}"

					Include:
					- Main topic (required) - Extract the main subject matter
					- Description (optional) - A description of what the campaign is about
					- Publish date (optional) - Look for dates like "tomorrow", "next week", etc.
					- Source URL (optional) - Extract any URLs mentioned that could be used for research
					
					For dates, convert relative dates (like "tomorrow") to ISO format dates.
					Keep the entire URL intact when extracting source URLs.
					Only include fields that can be confidently extracted from the text.
				`,
			});

			// Ensure we have a valid topic even if extraction fails
			if (!result.object.topic) {
				result.object.topic = data.topic;
			}

			ctx.logger.debug("Extracted data: %o", result.object);
			return result.object;
		} catch (error) {
			ctx.logger.debug("Error extracting structured data: %s", error);
			// Fall back to just using the text as the topic
			return { topic: data.topic || "" };
		}
	}

	// Ensure we always return a topic
	return { topic: data.topic || "" };
}

/**
 * Convert campaign objects to serializable format
 */
function serializeCampaigns(campaigns: Campaign[]) {
	return campaigns.map((campaign) => ({
		id: campaign.id,
		topic: campaign.topic,
		description: campaign.description || null,
		status: campaign.status,
		createdAt: campaign.createdAt,
		updatedAt: campaign.updatedAt,
	}));
}
