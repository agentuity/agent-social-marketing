import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { groq } from "@ai-sdk/groq";
import { z } from "zod";
import {
	getCampaign,
	createCampaign,
	findCampaignsByTopic,
	updateCampaignStatus,
} from "../../utils/kv-store";
import type { Campaign, ManagerRequest } from "../../types";

// Define the Zod schema for structured data extraction
const ExtractedDataSchema = z.object({
	topic: z.string(),
	description: z.string().nullable().optional(),
	publishDate: z.string().nullable().optional(),
	domain: z.string().nullable().optional(),
});

// Type for the extracted data
type ExtractedData = z.infer<typeof ExtractedDataSchema>;

export default async function ManagerAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	try {
		// Extract request data
		let dataJson: Record<string, unknown> = {};
		let dataText = "";
		try {
			// Safely parse JSON data from request
			dataJson = (req.data.json as Record<string, unknown>) || {};
		} catch (jsonError) {
			dataText = req.data.text; // Request can come in freeform text
		}

		const rawTopic = (dataJson?.topic as string) || dataText;

		// Check if we have a topic
		if (!rawTopic || rawTopic.trim() === "") {
			return resp.json({
				error: "Missing a topic",
				status: "error",
			});
		}

		// Clean and normalize the topic
		const topic = rawTopic.trim();
		ctx.logger.info("Manager: Processing request for topic: %s", topic);

		const data = {
			topic,
			description: dataJson?.description as string | undefined,
			publishDate: dataJson?.publishDate as string | undefined,
			domain: dataJson?.domain as string | undefined,
		};

		// If we only have a topic as a string, it might be a freeform request
		// Use an LLM to extract structured info
		if (!data.description && !data.publishDate) {
			const structuredData = await extractStructuredData(topic, ctx);
			// Merge the extracted data with the original request
			Object.assign(data, structuredData);
		}

		// Now we have structured data
		const request: ManagerRequest = {
			topic: data.topic,
			description: data.description,
			publishDate: data.publishDate,
			domain: data.domain,
		};

		// Check for existing campaigns with similar topics
		ctx.logger.debug("Checking for existing campaigns: %s", request.topic);
		const existingCampaigns = await findCampaignsByTopic(ctx, request.topic);

		if (existingCampaigns.length > 0) {
			// We found existing campaigns with similar topics
			ctx.logger.info(
				"Found %d existing campaigns for topic: %s",
				existingCampaigns.length,
				request.topic,
			);

			// Convert campaigns to plain objects for JSON serialization
			const serializedCampaigns = existingCampaigns.map((campaign) => {
				return {
					id: campaign.id,
					topic: campaign.topic,
					description: campaign.description || null,
					status: campaign.status,
					createdAt: campaign.createdAt,
					updatedAt: campaign.updatedAt,
				};
			});

			return resp.json({
				existingCampaigns: serializedCampaigns,
				message: "Found existing campaigns for this topic.",
				status: "existing_found",
			});
		}

		// This is a new campaign, let's create it
		try {
			const campaign = await createCampaign(
				ctx,
				request.topic,
				request.description,
				request.publishDate,
			);

			// Double check that campaign was created successfully
			if (!campaign || !campaign.id) {
				ctx.logger.error(
					"Failed to create campaign for topic: %s",
					request.topic,
				);
				return resp.json({
					error: "Failed to create campaign",
					status: "error",
				});
			}

			// Prepare the payload for handoff
			const payload = {
				topic: campaign.topic,
				description: campaign.description || null,
				campaignId: campaign.id,
				publishDate: campaign.publishDate || null,
				source: data.domain || request.domain || null,
			};

			// If there's no source/domain, skip researcher and go directly to copywriter
			if (!payload.source) {
				ctx.logger.info(
					"Skipping research phase for campaign: %s",
					campaign.id,
				);
				return resp.handoff({ name: "copywriter" }, { data: payload });
			}

			// If we have a source/domain, hand off to the researcher agent
			ctx.logger.info(
				"Handing off to researcher for campaign: %s",
				campaign.id,
			);
			return resp.handoff({ name: "researcher" }, { data: payload });
		} catch (error) {
			ctx.logger.error("Error creating campaign: %s", error);
			return resp.json({
				error: `Failed to create campaign: ${error instanceof Error ? error.message : String(error)}`,
				status: "error",
			});
		}
	} catch (error) {
		ctx.logger.error("Error in Manager Agent: %s", error);
		return resp.json({
			error: "An unexpected error occurred",
			message: error instanceof Error ? error.message : String(error),
			status: "error",
		});
	}
}

/**
 * Extract structured data from a freeform natural language request
 */
async function extractStructuredData(text: string, ctx: AgentContext) {
	try {
		ctx.logger.debug("Extracting structured data from request");

		const result = await generateObject({
			model: groq("llama3-70b-8192"),
			schema: ExtractedDataSchema,
			system:
				"You are a helpful assistant that extracts structured information from natural language content marketing requests.",
			prompt: `
			Extract structured information from this content marketing request. 
			The request is: "${text}"
			
			Extract the following information:
			- Main topic (required)
			- Description of the campaign (optional)
			- Publish date for the campaign (optional)
			- Source url (optional) Please keep the entire URL intact, not just the TLD

			Only include fields that can be confidently extracted from the text.
			`,
		});

		// Extract the data from the result
		const extractedData: ExtractedData = result.object;

		// Ensure the topic is not null or empty
		if (!extractedData.topic || extractedData.topic.trim() === "") {
			extractedData.topic = text.trim();
		}

		return {
			topic: extractedData.topic || text,
			description: extractedData.description || undefined,
			publishDate: extractedData.publishDate || undefined,
			domain: extractedData.domain || undefined,
		};
	} catch (error) {
		ctx.logger.error("Error extracting structured data: %s", error);
		// Fall back to just using the text as the topic
		return { topic: text };
	}
}
