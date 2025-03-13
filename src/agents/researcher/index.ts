import type { AgentRequest, AgentResponse, AgentContext } from "@agentuity/sdk";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
	getCampaign,
	updateCampaignStatus,
	saveCampaign,
} from "../../utils/kv-store";
import type { Campaign, ResearcherRequest, ResearchResults } from "../../types";
import FirecrawlApp from "@mendable/firecrawl-js";

// Define the Zod schema for research output
const ResearchSchema = z.object({
	title: z.string(),
	description: z.string(),
	longFormDescription: z.string(),
	tags: z.array(z.string()),
	keyInsights: z.array(z.string()),
	sources: z.array(z.string()),
});

// Define the Zod schema for Firecrawl content extraction
const ContentExtractionSchema = z.object({
	content: z.string().describe("The extracted content from the page"),
	title: z.string().describe("The title of the page").optional(),
	summary: z.string().describe("A summary of the content").optional(),
	sources: z
		.array(z.string())
		.describe("The sources used to create the content")
		.optional(),
});

type ResearchData = z.infer<typeof ResearchSchema>;

// Initialize Firecrawl with API key
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

export default async function ResearcherAgent(
	req: AgentRequest,
	resp: AgentResponse,
	ctx: AgentContext,
) {
	try {
		ctx.logger.info("Content Marketing Researcher Agent started");

		// Extract request data
		const data = req.data.json as Record<string, unknown>;

		// Validate required fields
		if (!data.topic || !data.campaignId || !data.source) {
			return resp.json({
				error:
					"Missing required fields: topic, campaignId, and source URL are required",
				status: "error",
			});
		}

		const request: ResearcherRequest = {
			topic: data.topic as string,
			publishDate: data.publishDate as string | undefined,
			description: data.description as string | undefined,
			source: data.source as string,
			campaignId: data.campaignId as string,
		};

		// Get the campaign from KV store
		const campaign = await getCampaign(ctx, request.campaignId);
		if (!campaign) {
			return resp.json({
				error: `Campaign not found with ID: ${request.campaignId}`,
				status: "error",
			});
		}

		// Update campaign status to researching
		await updateCampaignStatus(ctx, campaign.id, "researching");

		// Perform research
		ctx.logger.info(
			"Researching topic: %s from source: %s",
			request.topic,
			request.source,
		);

		// Research from the provided source URL
		const researchResults = await researchFromSource(
			request.topic,
			request.description || "",
			request.source as string,
			ctx,
		);

		// Update campaign with research results
		campaign.research = researchResults;
		campaign.updatedAt = new Date().toISOString();
		await saveCampaign(ctx, campaign);

		// Hand off to the copywriter agent
		const jsonResearch = {
			title: researchResults.title,
			description: researchResults.description,
			longFormDescription: researchResults.longFormDescription,
			tags: researchResults.tags,
			keyInsights: researchResults.keyInsights,
			sources: researchResults.sources,
		};

		const copywriterPayload = {
			campaignId: campaign.id,
			topic: campaign.topic,
			research: jsonResearch,
		};

		ctx.logger.info("Researcher Agent sending data to Copywriter Agent:", {
			...copywriterPayload,
		});

		return resp.handoff({ name: "copywriter" }, { data: copywriterPayload });
	} catch (error: unknown) {
		ctx.logger.error(
			"Error in Researcher Agent: %s",
			error instanceof Error ? error.message : String(error),
		);
		return resp.json({
			error: "An unexpected error occurred",
			message: error instanceof Error ? error.message : String(error),
			status: "error",
		});
	}
}

/**
 * Research from a specific source URL
 */
async function researchFromSource(
	topic: string,
	description: string,
	sourceUrl: string,
	ctx: AgentContext,
): Promise<ResearchResults> {
	try {
		ctx.logger.info("Researching from source: %s", sourceUrl);

		// Use Firecrawl to scrape the content
		const content = await extractContentWithFirecrawl(sourceUrl, topic, ctx);

		// Use Claude to analyze the content and generate research results
		const researchResults = await analyzeContent(
			topic,
			description,
			content,
			[sourceUrl],
			ctx,
		);

		return researchResults;
	} catch (error: unknown) {
		ctx.logger.error(
			"Error researching from source: %s",
			error instanceof Error ? error.message : String(error),
		);
		// Return a fallback research result if there's an error
		return createFallbackResearch(topic, description, sourceUrl);
	}
}

/**
 * Use Claude to analyze content and generate structured research results
 */
async function analyzeContent(
	topic: string,
	description: string,
	content: string,
	sources: string[],
	ctx: AgentContext,
): Promise<ResearchResults> {
	try {
		const contentSummary =
			content.length > 1000
				? `${content.substring(0, 1000)}... [content truncated for prompt]`
				: content;

		// Use Claude to analyze the content
		const result = await generateObject({
			model: anthropic("claude-3-7-sonnet-20250219"),
			schema: ResearchSchema,
			system:
				"You are a professional content marketing researcher who analyzes content and extracts key insights for social media marketing campaigns.",
			prompt: `
			Analyze the following content about "${topic}"${description ? ` (${description})` : ""} and create a structured research report.

			SOURCE (if applicable):
			${sources.join("\n")}
			
			CONTENT:
			${contentSummary}
			
			Based on this content, create a comprehensive research report with the following:
			
			1. An engaging title for the content marketing campaign
			2. A short description (1-2 sentences)
			3. A detailed long-form description (3-5 paragraphs) that thoroughly explains the topic
			4. 5-10 relevant tags/hashtags (without the # symbol)
			5. 5-8 key insights that would be valuable for a social media audience
			6. The list of sources provided
			
			Focus on extracting the most engaging and shareable insights that would perform well on LinkedIn and Twitter.
			`,
		});

		// Extract the research data from the result
		const researchData: ResearchData = result.object;

		// Ensure sources are included
		return {
			...researchData,
			sources: sources.length > 0 ? sources : researchData.sources,
		};
	} catch (error: unknown) {
		ctx.logger.error(
			"Error analyzing content: %s",
			error instanceof Error ? error.message : String(error),
		);
		return createFallbackResearch(
			topic,
			description,
			sources && sources.length > 0 ? sources[0] : undefined,
		);
	}
}

/**
 * Create a fallback research result when all else fails
 */
function createFallbackResearch(
	topic: string,
	description: string,
	sourceUrl?: string,
): ResearchResults {
	return {
		title: `${topic} Marketing Campaign`,
		description: description || `A content marketing campaign about ${topic}`,
		longFormDescription: `This campaign explores ${topic} in depth. Due to research limitations, this is a placeholder for the full content that would normally be here. The campaign will need additional research to be completed properly.`,
		tags: [
			topic.toLowerCase().replace(/\s+/g, ""),
			"contentmarketing",
			"socialmedia",
		],
		keyInsights: [
			`${topic} is an important topic for our target audience`,
			"Content should be educational and informative",
			"Consider creating both short-form and long-form content",
		],
		sources: sourceUrl ? [sourceUrl] : [],
	};
}

/**
 * Use Firecrawl to extract content from a URL
 */
async function extractContentWithFirecrawl(
	url: string,
	topic: string,
	ctx: AgentContext,
): Promise<string> {
	ctx.logger.info("Extracting content with Firecrawl: %s", url);

	try {
		const prompt = `
You are an investigative content researcher tasked with extracting relevant content about "${topic}".
Extract the main content from this web page, focusing on information related to "${topic}".
Format the content as plain text in a well-structured way.
If there are multiple sections, maintain their structure with headings.
Include any relevant facts, statistics, examples, or insights found on the page.
Exclude navigation elements, advertisements, footers, and other irrelevant page elements.
Provide a brief summary of the content at the beginning if possible.

The content should have the following:

TITLE: [Title of the content]
SUMMARY: [Brief summary of the content]
CONTENT: [Main content of the page]
SOURCES: ${url}
`;

		const result = await firecrawl.extract([url], {
			prompt,
			schema: ContentExtractionSchema,
		});

		if (!result.success) {
			ctx.logger.error(
				"Failed to extract content from %s: %s",
				url,
				result.error,
			);
			throw new Error(`Firecrawl extraction failed: ${result.error}`);
		}

		// Format the extracted content
		let formattedContent = "";

		if (result.data.title) {
			formattedContent += `TITLE: ${result.data.title}\n\n`;
		}

		if (result.data.summary) {
			formattedContent += `SUMMARY: ${result.data.summary}\n\n`;
		}

		if (result.data.sources) {
			formattedContent += `SOURCES: ${result.data.sources.join(", ")}\n\n`;
		}

		formattedContent += `CONTENT:\n${result.data.content}`;

		return formattedContent;
	} catch (error: unknown) {
		const err = error as { statusCode?: number; message?: string };

		if (err.statusCode === 429) {
			ctx.logger.error(
				"Rate limit exceeded for %s. Using fallback content.",
				url,
			);
		} else {
			ctx.logger.error(
				"Error extracting content from %s: %s",
				url,
				err.message || String(error),
			);
		}

		// Fall back to generic content about the topic
		return `Content about "${topic}" could not be extracted from ${url}. Please refer to other sources for information on this topic.`;
	}
}
