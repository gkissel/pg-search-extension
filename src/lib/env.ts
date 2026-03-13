import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z
			.url()
			.default("postgresql://postgres:docker@localhost:5432/app"),
		DEBUG_PG_SEARCH_EXTENSION: z.boolean().default(false),
	},
	runtimeEnv: {
		DATABASE_URL: process.env.DATABASE_URL,
		DEBUG_PG_SEARCH_EXTENSION: process.env.DEBUG_PG_SEARCH_EXTENSION,
	},
	emptyStringAsUndefined: true,
});
