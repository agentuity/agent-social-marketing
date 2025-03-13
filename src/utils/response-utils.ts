/**
 * Response utility functions for creating standardized API responses
 */

/**
 * Create a standardized error response
 * @param error Error message
 * @returns Error response object
 */
export const errorResponse = (error: string) => ({
	error,
	status: "error",
});

/**
 * Create a standardized success response
 * @param data Response data
 * @returns Success response object
 */
export const successResponse = (data: Record<string, unknown>) => ({
	...data,
	status: "success",
});
