import { addDays, addWeeks, addMonths, isPast, format } from "date-fns";
import * as dateFns from "date-fns";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseHumanRelative = require("parse-human-relative-time/date-fns")(
	dateFns,
);

/**
 * Parse a date string and ensure it's valid
 * @param dateStr The date string to parse (can be a natural language date or formatted date)
 * @param ensureFuture Whether to ensure the date is in the future (defaults to true)
 * @returns A properly formatted date string for the API (ISO format)
 */
export function getValidDate(dateStr?: string, ensureFuture = true): string {
	// Default to one week from now if no date is provided
	const defaultDate = addDays(new Date(), 7);

	// If no date string is provided, return the default date
	if (!dateStr) {
		return format(defaultDate, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
	}

	try {
		let dateObj: Date;

		try {
			// Try to parse using the natural language parser
			dateObj = parseHumanRelative(dateStr, new Date());
		} catch (parseError) {
			dateObj = new Date(dateStr);
		}

		// Ensure the date is valid
		if (Number.isNaN(dateObj.getTime())) {
			console.warn(`Invalid date: "${dateStr}", using default date`);
			return format(defaultDate, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
		}

		// If we need to ensure the date is in the future and it's in the past, use the default
		if (ensureFuture && isPast(dateObj)) {
			console.warn(
				`Date is in the past: "${dateStr}", using default future date`,
			);
			return format(defaultDate, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
		}

		// Format the date for the API
		return format(dateObj, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
	} catch (error) {
		// If anything goes wrong, return the default date
		console.error(`Error parsing date "${dateStr}": ${error}`);
		return format(defaultDate, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
	}
}

// Keep getValidFutureDate for backward compatibility
export function getValidFutureDate(dateStr?: string): string {
	return getValidDate(dateStr, true);
}
